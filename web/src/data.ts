import type { SupabaseClient } from "@supabase/supabase-js";

import { loadMonitor, type Monitor } from "./monitor-data";
import type { DeepFeature, Definitions, FirstResult } from "./deep";

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
  deepFeatures(app: string): Promise<DeepFeature[]>;
  saveDeep(app: string, fields: Definitions): Promise<DeepFeature>;
  firstResult(app: string, feature: string): Promise<FirstResult | null>;
  settings(app: string): Promise<AlertSettings>;
  emailSetting(app: string, enabled: boolean): Promise<void>;
  disconnectSlack(app: string): Promise<void>;
  testSlack(app: string): Promise<boolean>;
  slack(
    path: "install" | "callback",
    origin: string,
    params: Record<string, string>,
  ): Promise<{ url?: string; state?: string; app?: string }>;
  monitor(app: string, feature?: string, issue?: string): Promise<Monitor>;
  threshold(app: string, feature: string, ms: number): Promise<void>;
  dismiss(issue: string): Promise<void>;
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
export interface AlertSettings {
  email: boolean;
  channel: string | null;
  connected: boolean;
  broken: boolean;
}

function value<T>(result: { data: T | null; error: unknown }): NonNullable<T> {
  if (result.error || result.data == null)
    throw result.error ?? new Error("데이터가 없어요");
  return result.data;
}
export function gateway(client: SupabaseClient): Gateway {
  const columns = "id,name,created_at,first_record_at";
  return {
    async deepFeatures(app) {
      return value(await client.from("features").select("id,feature_key,name,start:start_definition,success:success_definition")
        .eq("app_id", app).eq("kind","deep").order("created_at"));
    },
    async saveDeep(app, fields) {
      return value(await client.rpc("save_deep_feature", {p_app:app,p_feature:null,p_name:fields.name,p_start:fields.start,p_success:fields.success})
        .select("id,feature_key,name,start:start_definition,success:success_definition").single<DeepFeature>());
    },
    async firstResult(app, feature) {
      const result = await client.from("attempts").select("status,duration_ms")
        .eq("app_id",app).eq("feature_id",feature).not("ended_at","is",null)
        .order("result_received_at").order("attempt_id").limit(1).maybeSingle<FirstResult>();
      if (result.error) throw result.error;
      return result.data;
    },
    async settings(app) {
      return value(await client.rpc("notification_settings", { app }));
    },
    async emailSetting(app, enabled) {
      const { error } = await client.rpc("set_notification_email", {
        app,
        enabled,
      });
      if (error) throw error;
    },
    async disconnectSlack(app) {
      const { error } = await client.rpc("disconnect_slack", { app });
      if (error) throw error;
    },
    async testSlack(app) {
      return value(await client.rpc("queue_test_notification", { app }));
    },
    async slack(path, origin, params) {
      const { data } = await client.auth.getSession();
      if (!data.session) throw new Error("로그인이 필요해요.");
      const response = await fetch(origin + "/v1/slack/" + path, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + data.session.access_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      return payload;
    },
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
    async dismiss(issue) {
      const { error } = await client.rpc("dismiss_incident", {
        incident_id: issue,
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
