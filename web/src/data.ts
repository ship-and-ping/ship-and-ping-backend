import type { SupabaseClient } from "@supabase/supabase-js";

import { loadMonitor, type Monitor } from "./monitor-data";
import type { DeepFeature, Definitions, FirstResult } from "./deep";
import { resultKinds } from "./deep";

interface AppRow {
  url?: string | null;
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
  account(): Promise<{ email: string; joined: string; method: string; hasPassword?: boolean }>;
  withdraw(origin: string): Promise<"done" | "failed" | "limited" | "unknown" | "unauthorized">;
  checkAccount(): Promise<"exists" | "deleted" | "unknown">;
  appKeys(id: string): Promise<KeySummary[]>;
  editApp(id: string, name: string, url: string): Promise<void>;
  removeApp(id: string): Promise<void>;
  revokeKey(app: string, key: string): Promise<void>;
  deepFeatures(app: string): Promise<DeepFeature[]>;
  saveDeep(app: string, fields: Definitions, request: string): Promise<DeepFeature>;
  deleteDeep(app: string, feature: string): Promise<void>;
  deepCounts(app: string, feature: string): Promise<number[]>;
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
  listen(fn: (id: string | null, recovery?: boolean) => void): () => void;
  login(email?: string): Promise<void>;
  passwordLogin(email: string, password: string): Promise<void>;
  signup(email: string, password: string): Promise<void>;
  requestReset(email: string): Promise<void>;
  reauthenticate(): Promise<void>;
  updatePassword(password: string, nonce?: string): Promise<void>;
  logout(): Promise<void>;
  firstVisit(): Promise<boolean>;
  apps(): Promise<AppSummary[]>;
  create(name: string, url: string): Promise<string>;
  issue(id: string, kind: "pub" | "srv"): Promise<string>;
  snapshot(id: string): Promise<Snapshot>;
  save(id: string, labels: Label[]): Promise<Pick<Label, "method" | "route">[]>;
}
export interface KeySummary {
  id: string;
  kind: "pub" | "srv";
  prefix: string;
  expires_at: string | null;
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
  const columns = "id,name,url,created_at,first_record_at";
  let withdrawalToken: string | undefined;
  // A fast Auth redirect can finish before React mounts the route listener.
  let initialRecovery: string | undefined;
  const earlyListener = globalThis.location?.pathname === "/reset-password"
    ? client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") initialRecovery = session?.user.id;
        if (!session) initialRecovery = undefined;
      }).data.subscription : undefined;
  return {
    async account() {
      const { data: { user } } = await client.auth.getUser();
      if (!user?.email) throw Error("로그인이 필요해요");
      return { email: user.email, joined: user.created_at,
        hasPassword: user.user_metadata.ship_ping_password_set === true,
        method: [
          ...(user.app_metadata.provider === "google" ? ["Google"] : []),
          ...(user.user_metadata.ship_ping_password_set === true ? ["이메일과 비밀번호"] : []),
          "메일 링크",
        ].join(", ") };
    },
    async withdraw(origin) {
      const { data } = await client.auth.getSession();
      if (!data.session) return "unauthorized";
      withdrawalToken = data.session.access_token;
      try {
        const response = await fetch(origin + "/v1/account/delete", {
          method:"POST", headers:{Authorization:"Bearer " + withdrawalToken, "Content-Type":"application/json"},
          body:"{}", signal:AbortSignal.timeout(30000),
        });
        if (response.status === 401) {
          const refreshed = await client.auth.refreshSession();
          if (refreshed.data.user) return "failed";
          if (refreshed.error?.code === "user_not_found") return "done";
          const {error} = await client.auth.getUser(withdrawalToken);
          if (error?.code === "user_not_found") return "done";
          const invalidSession = ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired"];
          return invalidSession.includes(refreshed.error?.code ?? "") ? "unauthorized" : "unknown";
        }
        if (response.status === 429) return "limited";
        if ([502,504].includes(response.status)) return "unknown";
        if (!response.ok) return "failed";
        return (await response.json()).deleted === true ? "done" : "unknown";
      } catch { return "unknown"; }
    },
    async checkAccount() {
      const session = await client.auth.refreshSession();
      if (session.data.user) return "exists";
      if (!withdrawalToken) return "unknown";
      const {error} = await client.auth.getUser(withdrawalToken);
      return error?.code === "user_not_found" ? "deleted" : "unknown";
    },
    async appKeys(id) {
      return value(await client.from("app_key_list").select("id,kind,prefix,expires_at")
        .eq("app_id",id).is("revoked_at",null).or("expires_at.is.null,expires_at.gt." + new Date().toISOString()));
    },
    async editApp(id,name,url) {
      value(await client.from("apps").update({name,url:url || null}).eq("id",id).select("id").single());
    },
    async removeApp(id) {
      value(await client.from("apps").delete().eq("id",id).select("id").single());
    },
    async revokeKey(app,key) {
      const result = await client.rpc("revoke_app_key",{p_app:app,p_key:key});
      if (result.error) throw result.error;
    },
    async deepFeatures(app) {
      return value(await client.from("features").select("id,feature_key,create_request_id,name,start:start_definition,success:success_definition")
        .eq("app_id", app).eq("kind","deep").order("created_at"));
    },
    async saveDeep(app, fields, request) {
      return value(await client.rpc("save_deep_feature", {p_app:app,p_feature:null,p_request_id:request,p_name:fields.name,p_start:fields.start,p_success:fields.success})
        .select("id,feature_key,name,start:start_definition,success:success_definition").single<DeepFeature>());
    },
    async deleteDeep(app, feature) {
      const { error } = await client.rpc("delete_deep_feature", { p_app: app, p_feature: feature });
      if (error) throw error;
    },
    async deepCounts(app, feature) {
      return Promise.all(resultKinds.map(async ([status]) => {
        const { count, error } = await client.from("attempts").select("attempt_id", { count: "exact", head: true })
          .eq("app_id", app).eq("feature_id", feature).eq("status", status);
        if (error || count == null) throw error ?? Error("결과 집계 실패");
        return count;
      }));
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
      const { data } = client.auth.onAuthStateChange((event, session) =>
        fn(session?.user.id ?? null, event === "PASSWORD_RECOVERY"),
      );
      earlyListener?.unsubscribe();
      if (initialRecovery) {
        fn(initialRecovery, true);
        initialRecovery = undefined;
      }
      return () => data.subscription.unsubscribe();
    },
    async passwordLogin(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signup(email, password) {
      const { error } = await client.auth.signUp({ email, password, options: {
        emailRedirectTo: location.origin + "/login", data: { ship_ping_password_set: true },
      } });
      if (error && error.code !== "user_already_exists" && error.code !== "email_exists") throw error;
    },
    async requestReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + "/reset-password",
      });
      if (error && error.code !== "user_not_found") throw error;
    },
    async reauthenticate() {
      const { error } = await client.auth.reauthenticate();
      if (error) throw error;
    },
    async updatePassword(password, nonce) {
      const { error } = await client.auth.updateUser({ password, nonce, data: { ship_ping_password_set: true } });
      if (error) throw error;
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
