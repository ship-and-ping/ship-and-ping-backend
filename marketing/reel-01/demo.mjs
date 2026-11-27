import { mockPage, now } from "../../web/qa/fixtures.mjs";

export const origin = "http://127.0.0.1:4191";
export async function prepareDemo(page, phase) {
  await page.clock.setFixedTime(new Date(now));
  await mockPage(page, "slow", true, origin);
  // Only demo responses change. All app components, routes and controls come from web/src.
  await page.route("https://example.supabase.co/rest/v1/**", async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop();
    const waiting = phase.value === "waiting";
    const resolved = phase.value === "resolved";
    const updated = resolved || phase.value === "updated";
    const at = "2026-11-25T09:00:00Z", update = "2026-11-25T09:07:00Z";
    const app = {id:"demo",name:"예제 웹앱",url:null,created_at:at,first_record_at: waiting ? null : at};
    const feature = {id:"apply",name:"분석",kind:"auto",method:"POST",route:"/analyze",
      hidden:false,name_source:"confirmed",baselines:{p50_ms:1100,sample_count:42},slow_threshold_ms:5000};
    const metric = {baseline:1100,p50:3400,total:24,failures:0};
    const rows = {
      apps: route.request().headers().accept?.includes("vnd.pgrst.object") ? app : [app],
      features: waiting || url.searchParams.get("kind") === "eq.deep" ? [] : [feature],
      incidents: waiting || phase.value === "arrived" ? [] : [{id:"example",feature_id:"apply",
        kind:"slow",status:resolved ? "resolved":"open",opened_at:at,opened_version:"1.0",
        closed_at:resolved ? now:null,resolved_version:resolved ? "1.1":null,
        metric_at_open:metric,metric_worst:metric,notifications:[]}],
      app_versions: waiting ? [] : [...(updated ? [{version:"1.1",first_seen_at:update,last_seen_at:now}]:[]),
        {version:"1.0",first_seen_at:at,last_seen_at:at}],
      incident_verification: {version:updated ? "1.1":null,consecutive_successes:0,latest_duration_ms:null,latest_success:null},
      stats_5m: waiting ? [] : [{feature_id:"apply",version:"1.0",bucket:at,total:24,failures:0,hist:[0,0,0,0,24]},
        ...(resolved ? [{feature_id:"apply",version:"1.1",bucket:update,total:5,failures:0,hist:[0,0,5]}]:[])]
    };
    if (!Object.hasOwn(rows,table)) return route.fallback();
    return route.fulfill({json:rows[table],headers:{"content-range":"*/1"}});
  });
}
