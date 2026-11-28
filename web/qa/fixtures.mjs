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
  const waiting = ["waiting","prompt","masked"].includes(state);
  const problem = ["failure","slow","unconfirmed","resolved"].includes(state);
  const app = { id: "demo", name: "모임모아", first_record_at: waiting ? null : at, created_at: at };
  const feature = { id: "apply", name: "모임 신청", kind: "auto", method: "POST",
    route: "/events/:id", hidden: false, name_source: "confirmed", baselines: null, slow_threshold_ms: 5000 };
  const metric = { total: 20, failures: 6, baseline: 1100, p50: 3400, unconfirmed: 3 };
  const incident = { id: "example", feature_id: "apply", kind: state === "resolved" ? "failure" : state,
    status: state === "resolved" ? "resolved" : "open", opened_at: at, opened_version: "1.0",
    closed_at: state === "resolved" ? now : null, resolved_version: state === "resolved" ? "1.1" : null,
    metric_at_open: metric, metric_worst: metric, notifications: [] };
  const matchCode = "07";
  let loginStatus = ["expired","denied"].includes(state) ? state : "pending";
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin === "https://ingest.ship-and-ping.invalid" && url.pathname.startsWith("/v1/login-requests")) {
      if (url.pathname === "/v1/login-requests") {
        loginStatus = ["expired","denied"].includes(state) ? state : "pending";
        return route.fulfill({json:{request_id:"qa-request",poll_secret:"fixture-only",match_code:matchCode,expires_at:"2026-11-25T09:20:00Z"}});
      }
      if (route.request().headers()["x-poll-secret"] && route.request().method() === "GET")
        return route.fulfill({json:{status:loginStatus}});
      if (loginStatus !== "pending")
        return route.fulfill({json:{status:loginStatus === "expired" ? "expired" : "used"}});
      if (url.pathname.endsWith("/approve")) {
        const {action, match_code} = route.request().postDataJSON();
        switch (action) {
          case "approve": loginStatus = match_code === matchCode ? "approved" : "mismatch"; break;
          case "deny": loginStatus = "denied"; break;
          case "local": loginStatus = "used"; break;
          default: throw Error("Unknown QA login action: " + action);
        }
        return route.fulfill({json:{status:loginStatus}});
      }
      return route.fulfill({json:{status:"pending",created_at:now,client_info:{browser:"Edge",place:"KR"}}});
    }
    if (url.href === "https://ingest.ship-and-ping.invalid/v1/account/delete") {
      if (state === "deleting") return;
      if (state === "failed") return route.fulfill({status:500,json:{deleted:false}});
      return route.fulfill({json:{deleted:true}});
    }
    if (url.href === "https://ingest.ship-and-ping.invalid/v1/slack/install" && state === "unconfigured")
      return route.fulfill({status:503,json:{error:"슬랙 연결이 아직 준비되지 않았어요."}});
    if (url.origin !== "https://example.supabase.co") return route.abort();
    if (state === "reauth" && url.pathname === "/auth/v1/user" && route.request().method() === "PUT")
      return route.fulfill({status:403,json:{error_code:"reauthentication_needed",message:"Reauthentication needed"}});
    if (url.pathname.startsWith("/auth/v1/")) return route.fulfill({ json: user });
    if (!url.pathname.startsWith("/rest/v1/")) return route.abort();
    if (state === "loading") return;
    if (state === "error") return route.fulfill({ status: 400, json: { message: "QA offline" } });
    const name = url.pathname.split("/").pop();
    if (name === "set_notification_email" && state === "email-saving") return;
    if (name === "issue_key") return route.fulfill({json:"sp_" + route.request().postDataJSON().kind + "_" + "0".repeat(64)});
    const single = route.request().headers().accept?.includes("vnd.pgrst.object");
    const rows = {
      apps: single ? app : state === "empty" ? [] : [app],
      features: waiting || url.searchParams.get("kind") === "eq.deep" ? [] : [feature],
      app_versions: waiting ? [] : [{ version: "1.0", first_seen_at: at, last_seen_at: at }],
      incidents: problem ? [incident] : [],
      stats_5m: waiting ? [] : [{ feature_id: "apply", version: "1.0", bucket: at, total: 20,
        failures: state === "failure" ? 6 : 0, hist: [0,0,0,0,14] }],
      feature_map_suggestions: [], error_samples: [], attempts: [], app_key_list: [], demo_insights: [],
      notification_settings: { email: true, connected: false, broken: false, channel: null, push:true, subscribed:false },
      list_push_devices: [],
      server_series: waiting ? [] : [{slot:0, peaks:{process_cpu_pct:28, mem_used_pct:62, gc_pause_ms:13}}],
      incident_verification: { version: null, consecutive_successes: 0 },
      incident_prompt_context: { slow_start: state === "slow" ? at : null, usual_rpm: 1, incident_rpm: 4,
        client_errors: 0, server_errors: state === "failure" ? 6 : 0 },
    };
    if (!Object.hasOwn(rows, name)) throw Error("Missing QA fixture: " + name);
    if (name === "stats_5m" && ["many","few","cluster"].includes(state)) {
      const hours = state === "few" ? [2, 9, 18] : Array.from({ length: 24 }, (_, i) => i);
      rows.stats_5m = hours.map(hour => {
        const total = state === "few" ? 1 : 8 + (hour * 7) % 17;
        const failures = state === "cluster" && hour >= 3 && hour <= 5 ? 10 - 2 * (hour - 3) : 0;
        const hist = Array(16).fill(0);
        hist[state === "few" ? 1 : (hour % 4) + 2] = total;
        return { feature_id: "apply", version: "1.0", total, failures, hist,
          bucket: new Date(Date.parse(now) - hour * 3600000 - 300000).toISOString() };
      });
    }
    return route.fulfill({ json: rows[name], headers: { "content-range": "*/" + Number(problem && state !== "resolved") } });
  });
}
