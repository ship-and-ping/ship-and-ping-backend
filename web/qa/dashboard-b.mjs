import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockPage } from "./fixtures.mjs";
import "../../docs/design/dashboard-2026-11-27/fixture.js";

const phase = process.argv[2];
if (!["before", "after"].includes(phase)) throw Error("Choose before or after");
const output = new URL("../../docs/design/qa/dashboard-b/" + phase + "/", import.meta.url);
await mkdir(output, {recursive:true});
const {snapshotEnd, featureNames, records} = globalThis.dashboardFixture;
const origin = "http://127.0.0.1:4186";
const service = "https://example.supabase.co";
const server = await createServer({
  server:{host:"127.0.0.1", port:4186, strictPort:true, hmr:false},
  define:{
    "import.meta.env.VITE_SUPABASE_URL":JSON.stringify(service),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL":JSON.stringify("https://ingest.ship-and-ping.invalid"),
  },
});

async function fixture(page, state) {
  await mockPage(page, state === "empty" ? "waiting" : state === "healthy" ? "normal" : "failure", true, origin);
  const empty = state === "empty";
  await page.route(service + "/rest/v1/**", async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split("/").pop();
    const at = new Date(snapshotEnd - 225 * 60000).toISOString();
    const app = {id:"demo", name:"트루바", created_at:at, first_record_at:empty ? null : at};
    const metric = {total:50, failures:30};
    const tables = {
      apps:route.request().headers().accept?.includes("vnd.pgrst.object") ? app : [app],
      features:empty ? [] : Object.entries(featureNames).map(([id,name]) => ({
        id,name,kind:"auto",method:"GET",route:"/"+id,hidden:false,baselines:null,slow_threshold_ms:5000,
      })),
      incidents:empty || state === "healthy" ? [] : [{id:"example",feature_id:"other",kind:"failure",status:"open",
        opened_at:at, closed_at:null, opened_version:"1.0",resolved_version:null,notifications:[],metric_at_open:metric,metric_worst:metric}],
      stats_5m:empty ? [] : records.filter(r => (!url.searchParams.has("feature_id") || url.searchParams.get("feature_id") === "eq."+r.feature)
        && r.at >= Date.parse(url.searchParams.get("bucket")?.slice(4) ?? "1970-01-01")).map(r => {
        const hist = Array(16).fill(0);
        if (r.seconds !== null) hist[{0.5:4,0.75:5,1:6,5:10}[r.seconds]] = r.success;
        const failures = state === "healthy" ? 0 : r.fail;
        return {feature_id:r.feature,version:"1.0",bucket:new Date(r.at).toISOString(),total:r.success+failures,failures,hist};
      }),
    };
    if (!Object.hasOwn(tables,name)) return route.fallback();
    return route.fulfill({json:tables[name], headers:{"content-range":"*/"+Number(!empty && state !== "healthy")}});
  });
}
const screens = [
  ["home","/apps/demo","problem"], ["healthy","/apps/demo","healthy"], ["empty","/apps/demo","empty"],
  ["feature","/apps/demo/features/other","problem"], ["issue","/apps/demo/issues/example","problem"],
  ["alerts","/apps/demo/notifications","problem"],
];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
  for (const width of [1440,390]) for (const colorScheme of ["light","dark"]) {
    for (const [screen,path,state] of screens) {
      const page = await browser.newPage({viewport:{width,height:width === 390 ? 844 : 900},colorScheme,
        locale:"ko-KR", timezoneId:"Asia/Seoul", reducedMotion:"reduce",serviceWorkers:"block"});
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.clock.setFixedTime(new Date(snapshotEnd));
      await fixture(page,state);
      await page.goto(origin+path);
      await page.locator(screen === "alerts" ? "[role=switch]" : ".monitor h1").waitFor();
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0,0); });
      async function capture(name) {
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Overflow: "+name);
        await page.screenshot({path:fileURLToPath(new URL(name+"-"+width+"-"+colorScheme+".png",output))});
      }
      await capture(screen);
      if (phase === "after") {
        const axe = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
        await page.addScriptTag({path:axe});
        const failures = await page.evaluate(async () => (await window.axe.run(document, {
          runOnly:["wcag2a","wcag2aa","wcag21aa"],
        })).violations.map(v => [v.id,v.nodes.map(n => n.target)]));
        if (failures.length) throw Error(screen+" "+width+" "+colorScheme+" "+JSON.stringify(failures));
        if (screen === "home") {
          if (await page.getByRole("link",{name:"문제 보기",exact:true}).count() !== 1)
            throw Error("Expected one visible action to open the incident");
        }
        if (screen === "issue") {
          await page.context().grantPermissions(["clipboard-read","clipboard-write"],{origin});
          const copy = page.getByRole("button",{name:/요청문 복사/}).last();
          await copy.focus();
          await page.keyboard.press("Enter");
          await page.getByRole("button",{name:"복사했어요"}).waitFor();
          const clipboard = await page.evaluate(() => navigator.clipboard.readText());
          if (clipboard.replaceAll("\r\n","\n") !== await page.locator("pre").first().textContent())
            throw Error("Clipboard differs from the preview");
        }
      }
      if (screen === "feature" && width === 390 && phase === "after") {
        const toggle = page.getByText("그래프와 표 보기",{exact:true});
        if (await page.getByRole("slider").count()) throw Error("Mobile charts should start folded");
        await toggle.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("slider").first().focus();
        await page.keyboard.press("End");
        await page.keyboard.press("Escape");
        await page.locator(".usage-panel").evaluate(el => el.scrollIntoView());
        await capture("expanded");
      }
      if (errors.length) throw Error(errors.join("\n"));
      await page.close();
    }
  }
  if (phase === "after") {
    for (const width of [1440,390]) {
      const page = await browser.newPage({viewport:{width:3*width+96,height:width===390?980:1040}});
      await page.goto(new URL("../index.html",output).href);
      await page.selectOption("#width",String(width));
      await page.addStyleTag({content:"body{max-width:none}.panels{gap:16px}.panels img{width:100%;height:"+(width===390?844:900)+"px;object-fit:cover;object-position:top}"});
      await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth));
      await page.locator(".panels").screenshot({path:fileURLToPath(new URL("../comparison-"+width+".png",output))});
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
