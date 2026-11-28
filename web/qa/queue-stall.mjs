import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockPage, now } from "./fixtures.mjs";

const stage = process.argv[2];
if (!["before", "after"].includes(stage)) throw Error("Expected before or after");
const output = new URL("../../docs/design/qa/T59/", import.meta.url);
const origin = "http://127.0.0.1:4159";
const service = "https://example.supabase.co";
const server = await createServer({
  server: {host:"127.0.0.1", port:4159, strictPort:true, hmr:false},
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(service),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_qa_local_only"),
  },
});
let browser;
try {
  await mkdir(output, {recursive:true});
  await server.listen();
  browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
  const page = await browser.newPage({viewport:{width:1280,height:900},locale:"ko-KR"});
  page.setDefaultTimeout(15000);
  await page.clock.setFixedTime(new Date(now));
  await mockPage(page,"failure",true,origin);
  for (const [rpc, json] of Object.entries({
    server_series:[], incident_server_context:{peaks:{system_cpu_pct:96,steal_pct:73}},
  })) await page.route("**/rpc/" + rpc, route => route.fulfill({json}));
  const metric = {total:504,failures:124,queue_ms:433,queue_pct:77,interruptions:124};
  await page.route("**/rest/v1/incidents?**", route => route.fulfill({json:[{
    id:"example",feature_id:"apply",kind:"failure",status:"open",opened_at:now,
    opened_version:"3e66a68",metric_at_open:metric,metric_worst:metric,notifications:[],
  }]}));
  await page.goto(origin + "/apps/demo/issues/example");
  const panel = page.getByRole("region",{name:"문제 상태"});
  await panel.waitFor();
  if (stage === "after") await panel.getByText(/처리 전 대기 평균/).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path:fileURLToPath(new URL(stage + ".png", output))});
} finally {
  await browser?.close();
  await server.close();
}
