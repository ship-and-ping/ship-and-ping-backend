import type { SupabaseClient } from "@supabase/supabase-js";

import { loadMonitor, type Monitor } from "./monitor-data";

interface AppRow {
  id: string;
  name: string;
  created_at: string;
  first_record_at: string | null;
}
export interface AppSummary extends AppRow {
  issues: number;
  last: string | null;
}
export interface Label {
  id: string | null;
  method: string;
  route: string;
  name: string;
  hidden: boolean;
}
export interface Snapshot {
  app: AppRow;
  labels: Label[];
}
export interface Gateway {
  monitor(app: string, feature?: string, issue?: string): Promise<Monitor>;
  threshold(app: string, feature: string, ms: number): Promise<void>;
  dismiss(app: string, issue: string): Promise<void>;
  session(): Promise<string | null>;
  listen(fn: (id: string | null) => void): () => void;
  login(email?: string): Promise<void>;
  logout(): Promise<void>;
  firstVisit(): Promise<boolean>;
  apps(): Promise<AppSummary[]>;
  create(name: string, url: string): Promise<string>;
  issue(id: string, kind: "pub" | "srv"): Promise<string>;
  snapshot(id: string): Promise<Snapshot>;
  save(id: string, labels: Label[]): Promise<Pick<Label, "method" | "route">[]>;
}

function value<T>(result: { data: T | null; error: unknown }): NonNullable<T> {
  if (result.error || result.data == null)
    throw result.error ?? new Error("데이터가 없어요");
  return result.data;
}
export function gateway(client: SupabaseClient): Gateway {
  const columns = "id,name,created_at,first_record_at";
  return {
    monitor: (app, feature, issue) => loadMonitor(client, app, feature, issue),
    async threshold(app, feature, ms) {
      value(
        await client
          .from("features")
          .update({ slow_threshold_ms: ms })
          .eq("app_id", app)
          .eq("id", feature)
          .select("id")
          .single(),
      );
    },
    async dismiss(app, issue) {
      const { error } = await client.rpc("dismiss_incident", {
        p_app_id: app,
        p_incident_id: issue,
      });
      if (error) throw error;
    },
    async session() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session?.user.id ?? null;
    },
    listen(fn) {
      const { data } = client.auth.onAuthStateChange((_event, session) =>
        fn(session?.user.id ?? null),
      );
      return () => data.subscription.unsubscribe();
    },
    async login(email) {
      const redirectTo = location.origin + "/login";
      const result = email
        ? await client.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: redirectTo },
          })
        : await client.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
          });
      if (result.error) throw result.error;
    },
    async logout() {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
    async firstVisit() {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) throw error ?? new Error("로그인이 필요해요");
      if (data.user.user_metadata.ship_ping_visited === true) return false;
      const updated = await client.auth.updateUser({
        data: { ship_ping_visited: true },
      });
      if (updated.error) throw updated.error;
      return true;
    },
    async apps() {
      const apps = value(
        await client.from("apps").select(columns).order("created_at"),
      );
      return Promise.all(
        apps.map(async (app) => {
          const [issues, versions] = await Promise.all([
            client
              .from("incidents")
              .select("id", { count: "exact", head: true })
              .eq("app_id", app.id)
              .eq("status", "open"),
            client
              .from("app_versions")
              .select("last_seen_at")
              .eq("app_id", app.id)
              .order("last_seen_at", { ascending: false })
              .limit(1),
          ]);
          if (issues.error) throw issues.error;
          return {
            ...app,
            issues: issues.count ?? 0,
            last: value(versions)[0]?.last_seen_at ?? app.first_record_at,
          };
        }),
      );
    },
    async create(name, url) {
      return value(
        await client
          .from("apps")
          .insert({ name, url: url || null })
          .select("id")
          .single<{ id: string }>(),
      ).id;
    },
    async issue(id, kind) {
      const key = value(await client.rpc("issue_key", { app_id: id, kind }));
      if (
        typeof key !== "string" ||
        !new RegExp("^sp_" + kind + "_[0-9a-f]{64}$").test(key)
      )
        throw new Error("키 발급 오류");
      return key;
    },
    async snapshot(id) {
      const [appResult, featuresResult, suggestionsResult] = await Promise.all([
        client.from("apps").select(columns).eq("id", id).single(),
        client
          .from("features")
          .select("id,method,route,name,hidden,name_source")
          .eq("app_id", id)
          .eq("kind", "auto")
          .order("created_at"),
        client
          .from("feature_map_suggestions")
          .select("method,route,name")
          .eq("app_id", id)
          .eq("applied", false)
          .order("received_at"),
      ]);
      const suggestions = new Map(
        value(suggestionsResult).map((s) => [s.method + " " + s.route, s]),
      );
      const labels: Label[] = value(featuresResult).map((f) => {
        const key = f.method + " " + f.route;
        const proposed = suggestions.get(key);
        suggestions.delete(key);
        const name =
          f.method === "*"
            ? "기타"
            : f.name_source === "confirmed" && f.name !== "이름 없는 기능"
              ? f.name
              : (proposed?.name ?? "");
        return {
          id: f.id,
          method: f.method,
          route: f.route,
          hidden: f.hidden,
          name,
        };
      });
      for (const s of suggestions.values())
        labels.push({ ...s, id: null, hidden: false });
      return { app: value(appResult), labels };
    },
    async save(id, labels) {
      const result = await client.rpc("confirm_feature_names", {
        p_app_id: id,
        p_items: labels.map(({ method, route, name, hidden }) => ({
          method,
          route,
          name,
          hidden,
        })),
      });
      return value(result);
    },
  };
}
