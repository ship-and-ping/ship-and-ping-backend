import {mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {chromium} from "playwright";
import {createServer} from "vite";
import {mockPage} from "./fixtures.mjs";

const output = new URL("../../docs/design/qa/demo-insights/panels/", import.meta.url);
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
    const success_durations = slow ? {1400:20,2000:5} : {[i % 3 === 0 ? 200 : 300]:24,2000:1};
    return {feature_id:"search",version,bucket:stamp(age + 1/12),total:25+failures,failures,hist,success_durations};
  });
  const app = {id:"demo", name:"트루바",first_record_at:stamp(96),created_at:stamp(100)};
  const incident = {id:"slow",feature_id:"search",kind:"slow",status:stage === "fixed" ? "resolved" : "open",
    opened_version:"1.1",opened_at:stamp(4),closed_at:stage === "fixed" ? stamp(0.1) : null,
    resolved_version:stage === "fixed" ? "1.2" : null,notifications:[],
    metric_at_open:{p50:1400,baseline_p50:200,baseline_p95:500,total:25,window:10},metric_worst:null};
  await page.route(service + "/rest/v1/**", route => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    const rows = {
      apps:route.request().headers().accept?.includes("vnd.pgrst.object") ? app : [app],
      features:[feature], incidents:stage === "before" ? [] : [incident],stats_5m:stats,
      app_versions:versions.map(version => ({version,first_seen_at:stamp({"1.0":96,"1.1":5,"1.2":0.25}[version]),last_seen_at:stamp(0)})),
      demo_insights:[{feature_id:"search",fast:stage === "load" ? 0 : 24,measured:25,failures:Number(stage === "load"),
        previous_n:versions.length > 1 ? 50 : 0,current_n:25,previous_ms:stage === "fixed" ? 1400 : 300,
        current_ms:stage === "load" ? 1400 : 300}],
    };
    return Object.hasOwn(rows,name) ? route.fulfill({json:rows[name]}) : route.fallback();
  });
}

async function checkRefreshWindows(browser) {
  const context = await browser.newContext();
  try {
    await context.clock.install({time:new Date(end)});
    await context.clock.pauseAt(new Date(end + 1000));
    const windows = [];
    const reads = [0,0];
    for (const index of [0,1]) {
      const page = await context.newPage();
      windows.push(page);
      await fixture(page,"fixed");
      page.on("request",request => { if (request.url().includes("/rpc/demo_insights")) reads[index]++; });
      await page.goto(origin+"/apps/demo");
      await page.getByText(/최근 1시간 성공 요청의/).waitFor();
      if (await page.evaluate(() => document.visibilityState) !== "visible") throw Error("Expected two visible monitors");
    }
    const [leader,follower] = windows;
    async function refresh(action,page) {
      await Promise.all([page.waitForResponse(r => r.url().includes("/rpc/demo_insights")),action()]);
      await page.locator(".refresh-button:not([disabled])").waitFor();
    }
    await refresh(() => context.clock.fastForward(60000),leader);
    await refresh(() => follower.getByRole("button",{name:"새로고침",exact:true}).click(),follower);
    if (reads.join() !== "2,2") throw Error("Duplicate automatic refresh or delayed manual refresh: "+reads);
    await leader.close();
    await follower.waitForFunction(async () => (await navigator.locks.query()).held.some(l =>
      l.name === "ship-and-ping:monitor:demo"));
    await refresh(() => context.clock.fastForward(60000),follower);
    if (reads.join() !== "2,3") throw Error("Automatic refresh did not move to the remaining window: "+reads);
  } finally { await context.close(); }
}

let browser;
try {
  await mkdir(output,{recursive:true});
  await server.listen();
  browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
  await checkRefreshWindows(browser);
  const widths = process.argv.includes("--mobile") ? [390] : [1440,390];
  for (const stage of ["before","load","fixed"]) for (const width of widths) for (const colorScheme of ["light","dark"]) {
    const page = await browser.newPage({viewport:{width,height:width === 390 ? 844 : 900},colorScheme,
      hasTouch:width === 390,reducedMotion:width === 390 ? "reduce" : "no-preference"});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.setFixedTime(new Date(end));
    await fixture(page,stage);
    for (const screen of ["home","detail"]) {
      await page.goto(origin+"/apps/demo"+(screen === "detail" ? "/features/search" : ""));
      await page.getByText(/최근 1시간 성공 요청의/).waitFor();
      if (stage !== "before") await page.getByText(stage === "load" ? /4.7배 느려졌어요/ : /4.7배 빨라졌어요/).waitFor();
      if (screen === "detail") {
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
      if (stage === "fixed") {
        if (width === 390) {
          for (const help of await page.locator(".stat-panel .panel-help button").all()) {
            await help.focus();
            const box = await page.locator(".panel-help [role=tooltip]").boundingBox();
            if (!box || box.x < 0 || box.x+box.width > width) throw Error("Stat help outside viewport");
            if (screen === "home" && await help.getAttribute("aria-label") === "사용 건수 설명") {
              await page.locator(".stat-grid").screenshot({
                path:fileURLToPath(new URL("help-home-390-"+colorScheme+".png",output))});
            }
            await help.press("Escape");
          }
        }
        await page.addScriptTag({path:createRequire(import.meta.url).resolve("axe-core/axe.min.js")});
        const violations = await page.evaluate(async () => (await window.axe.run(document,{runOnly:["wcag2a","wcag2aa","wcag21aa"]})).violations.map(v => [v.id,v.nodes.map(n => n.target)]));
        if (violations.length) throw Error(JSON.stringify(violations));
        const plot = page.getByRole("slider",{name:"걸린 시간"});
        await plot.scrollIntoViewIfNeeded();
        await plot.hover({position:{x:Math.floor((await plot.boundingBox()).width*.8),y:45}});
        await page.locator(".flow-tip").waitFor();
        if (await page.locator(".flow-selection").count() !== 2) throw Error("Missing linked cursor");
        // Pin the same bucket so positioning a full-board capture keeps the pointer result.
        await plot.click({position:{x:Math.floor((await plot.boundingBox()).width*.8),y:45}});
        await page.locator(".metrics-board").screenshot({style:".dashboard-dock { visibility:hidden }",
          path:fileURLToPath(new URL(["hover",screen,width,colorScheme].join("-")+".png",output))});
        if (width === 390) {
          const tip = await page.locator(".flow-tip").boundingBox();
          for (const label of await page.locator(".flow-key, .flow-x, .flow-marks").all()) {
            const box = await label.boundingBox();
            if (tip.y < box.y+box.height && box.y < tip.y+tip.height && tip.x < box.x+box.width && box.x < tip.x+tip.width)
              throw Error("Selected values cover chart, legend or time axis");
          }
          await plot.evaluate(el => el.scrollIntoView({block:"center"}));
          const box = await plot.boundingBox();
          const point = slot => [{x:Math.round(box.x+box.width*(slot-.5)/24),y:Math.round(box.y+box.height/2)}];
          const session = await page.context().newCDPSession(page);
          await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:point(3)});
          await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:point(21)});
          await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
          await session.detach();
          const peer = page.getByRole("slider",{name:"사용과 실패"});
          if (await peer.getAttribute("aria-valuenow") !== "21") throw Error("Touch drag did not synchronize");
          const duration = await page.locator(".flow-selection").first().evaluate(el => getComputedStyle(el).transitionDuration);
          if (duration !== "0s") throw Error("Crosshair should move immediately with reduced motion");
          await page.keyboard.press("Escape");
          if (await page.locator(".flow-tip").count()) throw Error("Escape did not dismiss touch selection");
        }
      }
    }
    if (errors.length) throw Error(errors.join("\n"));
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
