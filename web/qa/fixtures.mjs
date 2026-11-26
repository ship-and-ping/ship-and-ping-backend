const at = "2026-11-25T09:00:00Z";
export const now = "2026-11-25T09:10:00Z";
export const exampleEmail = "demo@example.invalid";
const user = { id: "qa-member", email:exampleEmail, created_at:at, app_metadata:{provider:"email"}, user_metadata: { ship_ping_visited: true, ship_ping_password_set: true } };
export async function mockPage(page, state, member, origin) {
  if (member) await page.addInitScript(user => {
    localStorage.setItem("sb-example-auth-token", JSON.stringify({
      user, access_token: "qa-local-only", refresh_token: "qa-local-only",
      expires_at: 2100000000, token_type: "bearer",
    }));
  }, user);
  const waiting = state === "waiting";
  const problem = ["failure","slow","unconfirmed","resolved"].includes(state);
  const app = { id: "demo", name: "모임모아", first_record_at: waiting ? null : at, created_at: at };
  const feature = { id: "apply", name: "모임 신청", kind: "auto", method: "POST",
    route: "/events/:id", hidden: false, name_source: "confirmed", baselines: null, slow_threshold_ms: 5000 };
  const metric = { total: 20, failures: 6, baseline: 1100, p50: 3400, unconfirmed: 3 };
  const incident = { id: "example", feature_id: "apply", kind: state === "resolved" ? "failure" : state,
    status: state === "resolved" ? "resolved" : "open", opened_at: at, opened_version: "1.0",
    closed_at: state === "resolved" ? now : null, resolved_version: state === "resolved" ? "1.1" : null,
    metric_at_open: metric, metric_worst: metric, notifications: [] };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.href === "https://ingest.ship-and-ping.invalid/v1/account/delete") {
      if (state === "deleting") return;
      if (state === "failed") return route.fulfill({status:500,json:{deleted:false}});
      return route.fulfill({json:{deleted:true}});
    }
    if (url.origin !== "https://example.supabase.co") return route.abort();
    if (state === "reauth" && url.pathname === "/auth/v1/user" && route.request().method() === "PUT")
      return route.fulfill({status:403,json:{error_code:"reauthentication_needed",message:"Reauthentication needed"}});
    if (url.pathname.startsWith("/auth/v1/")) return route.fulfill({ json: user });
    if (!url.pathname.startsWith("/rest/v1/")) return route.abort();
    if (state === "loading") return;
    if (state === "error") return route.fulfill({ status: 400, json: { message: "QA offline" } });
    const name = url.pathname.split("/").pop();
    const single = route.request().headers().accept?.includes("vnd.pgrst.object");
    const rows = {
      apps: single ? app : state === "empty" ? [] : [app],
      features: waiting || url.searchParams.get("kind") === "eq.deep" ? [] : [feature],
      app_versions: waiting ? [] : [{ version: "1.0", first_seen_at: at, last_seen_at: at }],
      incidents: problem ? [incident] : [],
      stats_5m: waiting ? [] : [{ feature_id: "apply", version: "1.0", bucket: at, total: 20,
        failures: state === "failure" ? 6 : 0, hist: [0,0,0,0,14] }],
      feature_map_suggestions: [], error_samples: [], attempts: [], app_key_list: [],
      notification_settings: { email: true, connected: false, broken: false, channel: null },
      incident_verification: { version: null, consecutive_successes: 0 },
    };
    if (!Object.hasOwn(rows, name)) throw Error("Missing QA fixture: " + name);
    return route.fulfill({ json: rows[name], headers: { "content-range": "*/" + Number(problem && state !== "resolved") } });
  });
}
