import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockPage } from "./fixtures.mjs";

const stage = process.argv[2];
assert.ok(["before", "after"].includes(stage));
const output = new URL("../../docs/design/qa/crosshair/", import.meta.url);
const origin = "http://127.0.0.1:4197";
const service = "https://example.supabase.co";
const now = Date.parse("2026-11-28T06:00:00Z");
const server = await createServer({
  server: { host: "127.0.0.1", port: 4197, strictPort: true, hmr: false },
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(service),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid") },
});
let browser;
async function checkWidth(page, state) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth
    ? {width:document.documentElement.scrollWidth, elements:[...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 0.5)
      .map(el => [el.tagName,el.className?.baseVal ?? el.className,Math.round(el.getBoundingClientRect().right)]).slice(-12)
    } : null);
  assert.equal(overflow,null,state+" "+JSON.stringify(overflow));
}
try {
  await mkdir(output, {recursive:true});
  await server.listen();
  browser = await chromium.launch({channel:"msedge"});
  for (const width of [1440, 390]) for (const colorScheme of ["light","dark"]) {
    const page = await browser.newPage({viewport:{width, height:width === 390 ? 844 : 900},
      colorScheme, hasTouch:width === 390, reducedMotion:colorScheme === "dark" ? "reduce" : "no-preference"});
    await page.clock.setFixedTime(new Date(now));
    await mockPage(page,"normal",true,origin);
    await page.route(service+"/rest/v1/features**", route => route.fulfill({json:[{
      id:"apply", name:"모임 신청", kind:"auto", method:"POST", route:"/events/:id", hidden:false,
      slow_threshold_ms:5000, baselines:{sample_count:90,p50_ms:200,p95_ms:500},
    }]}));
    const stats = [0,1,2,5,8,9,10,11,12,13,14,18,19,20,21,22,23].map(i => {
      const total = 12 + i * 7 % 17;
      const failures = Number(i === 2 || i === 11);
      const slow = i % 7;
      return {feature_id:"apply",version:"1.0",bucket:new Date(now-(23.5-i)*3600000).toISOString(),
        total,failures,hist:[0,0,total-failures-slow,0,0,slow],success_durations:{[100+i%4*100]:total-failures-slow,750:slow}};
    });
    await page.route(service+"/rest/v1/stats_5m**",route => route.fulfill({json:stats}));
    await page.goto(origin+"/apps/demo");
    const board = page.locator(".metrics-board");
    const slider = board.getByRole("slider",{name:"사용 건수"});
    await slider.waitFor();
    await page.evaluate(async () => { await document.fonts.ready; });
    await board.evaluate(el => el.scrollIntoView({block:"start"}));
    const box = await slider.boundingBox();
    const plots = board.locator(".flow-plots");
    const beforeHover = await plots.boundingBox();
    const reads = [];
    page.on("request",request => { if (request.url().startsWith(service)) reads.push(request.url()); });
    await slider.hover({position:{x:Math.floor(box.width*12.5/24),y:Math.floor(box.height/2)}});
    await board.locator(".stat-panel .flow-tip").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await page.screenshot({path:fileURLToPath(new URL([stage,width,colorScheme].join("-")+".png",output))});
    if (stage === "after") {
      assert.equal(await board.locator(".flow-selection").count(),6);
      assert.equal(await slider.getAttribute("aria-valuenow"),"13");
      const tip = await board.getByRole("tooltip").boundingBox();
      const card = await board.locator(".stat-panel").first().boundingBox();
      assert.equal((await plots.boundingBox()).y,beforeHover.y,"Hover moved the charts");
      assert.ok(tip.x >= 0 && tip.x + tip.width <= width);
      if (width === 390) {
        const cards = await board.locator(".stat-panel").all();
        for (const panel of cards) {
          const bounds = await panel.boundingBox();
          assert.ok(tip.y >= bounds.y + bounds.height);
        }
        assert.ok(tip.y + tip.height <= beforeHover.y);
      } else {
        assert.ok(tip.x >= card.x && tip.x + tip.width <= card.x + card.width);
        assert.ok(tip.y + tip.height <= card.y + card.height);
      }
      for (const line of await board.locator(".flow-selection").all())
        assert.equal(await line.evaluate(el => getComputedStyle(el).transitionDuration),"0s");
      if (width === 390) {
        const touch = await page.context().newCDPSession(page);
        const at = slot => [{x:Math.round(box.x+box.width*(slot-.5)/24), y:Math.round(box.y+box.height/2)}];
        await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:at(6)});
        await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:at(16)});
        await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
        assert.match(await board.getByRole("tooltip").textContent(),/기록 없음/);
        assert.equal(await board.getByRole("slider",{name:"걸린 시간"}).getAttribute("aria-valuenow"),"16");
        await touch.detach();
      }
      assert.deepEqual(reads,[]);
      if (width === 390) {
        await page.goto(origin+"/apps/demo/features/apply");
        await slider.waitFor();
        await page.addStyleTag({content:"html {font-size:200%}"});
        await checkWidth(page,"feature detail 200%");
        for (const name of ["사용 건수","사용과 실패","걸린 시간"]) {
          await board.getByRole("slider",{name}).focus();
          await checkWidth(page,name+" 200%");
        }
        await page.getByRole("button",{name:"7일"}).click();
        await slider.waitFor();
        const top = () => plots.evaluate(el => el.getBoundingClientRect().top + scrollY);
        const weekTop = await top();
        await slider.focus();
        await slider.press("End");
        const weekTip = await board.getByRole("tooltip").boundingBox();
        const lastCard = await board.locator(".stat-panel").last().boundingBox();
        assert.ok(weekTip.y >= lastCard.y + lastCard.height,"Weekly tooltip covers another card");
        assert.equal(await top(),weekTop,"Weekly selection moved the charts");
        await checkWidth(page,"weekly selection 200%");
        if (colorScheme === "dark") await board.locator(".stat-grid").screenshot({
          path:fileURLToPath(new URL("week-390-text200.png",output)),
        });
      }
    }
    await page.close();
  }
  if (stage === "after") {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await mockPage(page,"waiting",true,origin);
    await page.goto(origin+"/apps/demo");
    const waiting = page.getByRole("region",{name:"앱 상태 요약"});
    await waiting.waitFor();
    const paragraph = await waiting.locator("p").boundingBox();
    const badge = await waiting.locator(".status-badge").boundingBox();
    const title = await waiting.locator("h2").boundingBox();
    assert.ok(paragraph.y >= title.y + title.height);
    assert.ok(Math.abs(paragraph.x - badge.x) <= 1);
    assert.ok(paragraph.width > (await waiting.boundingBox()).width * 0.7);
    await waiting.screenshot({path:fileURLToPath(new URL("waiting-390.png",output))});
    await page.unrouteAll();
    await page.goto(new URL("index.html",output).href);
    const loaded = await page.locator("main img").evaluateAll(images => images.filter(img => img.naturalWidth > 0).length);
    assert.equal(loaded,12);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
