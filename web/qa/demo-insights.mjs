import {mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {createServer} from "vite";
import {mockPage} from "./fixtures.mjs";

const output = new URL("../../docs/design/qa/demo-insights/", import.meta.url);
const origin = "http://127.0.0.1:4188";
const service = "https://example.supabase.co";
const end = Date.parse("2026-11-27T08:00:00Z");
const stamp = hours => new Date(end - hours * 3600000).toISOString();
const server = await createServer({
  server:{host:"127.0.0.1", port:4188, strictPort:true, hmr:false},
  define:{
    "import.meta.env.VITE_SUPABASE_URL":JSON.stringify(service),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL":JSON.stringify("https://ingest.ship-and-ping.invalid"),
  },
});

async function fixture(page, stage) {
  await mockPage(page,"normal",true,origin);
  const feature = {id:"search",name:"상품 검색",kind:"auto",method:"GET",route:"/products/search",
    slow_threshold_ms:5000,hidden:false,baselines:{sample_count:90,p50_ms:200,p95_ms:500}};
  const versions = stage === "before" ? ["1.0"] : stage === "load" ? ["1.1","1.0"] : ["1.2","1.1","1.0"];
  const stats = Array.from({length:24}, (_,i) => {
    const age = 23 - i;
    const slow = stage !== "before" && age < 5 && (age !== 0 || stage === "load");
    const hist = Array(16).fill(0);
    hist[slow ? 7 : i % 3 === 0 ? 2 : 3] = slow ? 20 : 24;
    hist[8] = slow ? 5 : 1;
    const failures = Number(slow);
    hist[9] = failures;
    const version = stage === "fixed" && age === 0 ? "1.2" : stage !== "before" && age < 5 ? "1.1" : "1.0";
    return {feature_id:"search",version,bucket:stamp(age + 1/12),total:25+failures,failures,hist};
  });
  const app = {id:"demo", name:"트루바",first_record_at:stamp(96),created_at:stamp(100)};
  const incident = {id:"slow",feature_id:"search",kind:"slow",status:stage === "fixed" ? "resolved" : "open",
    opened_version:"1.1",opened_at:stamp(4),closed_at:stage === "fixed" ? stamp(0.1) : null,
    resolved_version:stage === "fixed" ? "1.2" : null,notifications:[],
    metric_at_open:{p50:1500,baseline_p50:200,baseline_p95:500,total:25,window:10},metric_worst:null};
  await page.route(service + "/rest/v1/**", route => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    const rows = {
      apps:route.request().headers().accept?.includes("vnd.pgrst.object") ? app : [app],
      features:[feature], incidents:stage === "before" ? [] : [incident],stats_5m:stats,
      app_versions:versions.map(version => ({version,first_seen_at:stamp({"1.0":96,"1.1":5,"1.2":0.25}[version]),last_seen_at:stamp(0)})),
      demo_insights:[{feature_id:"search",fast:stage === "load" ? 0 : 24,measured:25,failures:Number(stage === "load"),
        previous_n:versions.length > 1 ? 50 : 0,current_n:25,previous_ms:stage === "fixed" ? 1500 : 300,
        current_ms:stage === "load" ? 1500 : 300}],
    };
    return Object.hasOwn(rows,name) ? route.fulfill({json:rows[name]}) : route.fallback();
  });
}

let browser;
try {
  await mkdir(output,{recursive:true});
  await server.listen();
  browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
  for (const stage of ["before","load","fixed"]) for (const width of [1440,390]) for (const colorScheme of ["light","dark"]) {
    const page = await browser.newPage({viewport:{width,height:width === 390 ? 844 : 900},colorScheme});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.setFixedTime(new Date(end));
    await fixture(page,stage);
    for (const screen of ["home","detail"]) {
      await page.goto(origin+"/apps/demo"+(screen === "detail" ? "/features/search" : ""));
      await page.getByText(/최근 1시간 성공 요청의/).waitFor();
      if (stage !== "before") await page.getByText(stage === "load" ? /5배 느려졌어요/ : /5배 빨라졌어요/).waitFor();
      if (screen === "detail") {
        if (width === 390) {
          await page.getByText("그래프와 표 보기",{exact:true}).focus();
          await page.keyboard.press("Enter");
        }
        const slider = page.getByRole("slider",{name:"걸린 시간"});
        if (await page.locator("rect.usual-band").evaluate(el => el.getBBox().height <= 0)) throw Error("Missing range band");
        await slider.focus();
        await page.keyboard.press("End");
        if ((await slider.getAttribute("aria-valuetext")).includes("평소 범위 초과") !== (stage === "load")) throw Error("Wrong range announcement");
        await page.keyboard.press("Tab");
        await page.locator("h1").focus();
      }
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0,0); });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("Horizontal overflow");
      await page.screenshot({path:fileURLToPath(new URL([stage,screen,width,colorScheme].join("-")+".png",output)),fullPage:true});
    }
    if (errors.length) throw Error(errors.join("\n"));
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
