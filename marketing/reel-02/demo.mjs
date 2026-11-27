import { mockPage } from "../../web/qa/fixtures.mjs";

export const origin = "http://127.0.0.1:4192";
const overnight = "2026-11-25T14:47:00Z";
const incidentAt = "2026-11-25T21:58:00Z";
const update = "2026-11-25T22:08:00Z";
const closed = "2026-11-25T22:14:00Z";
const names = ["신청하기", "로그인", "분석"];
const features = names.map((name, i) => ({
  id: ["apply", "login", "analyze"][i], name, kind: "auto", method: "POST",
  route: ["/apply", "/login", "/analyze"][i], hidden: false, name_source: "confirmed",
  baselines: { p50_ms: 1100, sample_count: 42 }, slow_threshold_ms: 5000
}));

export async function mountDemo(page, phase) {
  await mockPage(page, "slow", true, origin);
  await page.clock.setFixedTime(new Date(closed));
  await page.route("https://example.supabase.co/rest/v1/**", async route => {
    const url = new URL(route.request().url());
    const resolved = phase.value === "resolved";
    const metric = { baseline: 1100, p50: 3400, total: 24, failures: 0 };
    const app = { id: "demo", name: "모임모아", url: null, created_at: overnight, first_record_at: overnight };
    const issue = { id: "sample", feature_id: "analyze", kind: "slow", status: resolved ? "resolved" : "open",
      opened_at: incidentAt, opened_version: "1.0", closed_at: resolved ? closed : null,
      resolved_version: resolved ? "1.1" : null, metric_at_open: metric, metric_worst: metric, notifications: [] };
    const rows = {
      apps: route.request().headers().accept?.includes("vnd.pgrst.object") ? app : [app],
      features: url.searchParams.get("kind") === "eq.deep" ? [] : features,
      incidents: phase.value === "healthy" ? [] : [issue],
      app_versions: [...(resolved ? [{ version:"1.1", first_seen_at:update, last_seen_at:closed }] : []),
        { version:"1.0", first_seen_at:overnight, last_seen_at:overnight }],
      stats_5m: features.map((f,i) => ({ feature_id:f.id, version:"1.0", bucket:overnight,
        total:30-i*3, failures:0, hist:[0,0,30-i*3] })),
      incident_verification: { version:resolved ? "1.1" : null, consecutive_successes:resolved ? 5 : 0,
        latest_duration_ms:resolved ? 1100 : null, latest_success:resolved ? true : null }
    };
    const table = url.pathname.split("/").at(-1);
    if (!Object.hasOwn(rows, table)) return route.fallback();
    await route.fulfill({ json:rows[table], headers:{"content-range":"*/1"} });
  });
}
