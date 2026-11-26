import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import { mockPage, now } from "./fixtures.mjs";

const phase = process.argv[2] ?? "after";
const require = createRequire(import.meta.url);
if (!["before", "after"].includes(phase)) throw Error("Use before or after");
const dir = resolve("../docs/design/qa", phase);
await mkdir(dir, { recursive: true });
const cases = [
  ["소개","/","normal",".intro"], ["로그인","/login","normal","input"],
  ["내 앱","/apps","normal",".app-card"], ["빈 앱 목록","/apps","empty",".hero-card"],
  ["앱 등록","/apps/new","normal","#app-name"], ["연결 대기","/apps/demo/connect","waiting",".hero-card"],
  ["앱 홈","/apps/demo","normal",".monitor"], ["첫 기록 대기","/apps/demo","waiting",".monitor"],
  ["문제 있는 홈","/apps/demo","failure",".monitor"], ["기능 상세","/apps/demo/features/apply","normal",".monitor"],
  ...["failure","slow","unconfirmed","resolved"].map(state => ["문제 상세","/apps/demo/issues/example",state,".monitor"]),
  ["깊게 보기","/apps/demo/features/deep/new","normal","#deep-name"],
  ["알림 설정","/apps/demo/notifications","normal","[role=switch]"],
  ["알림 목록 불러오기","/apps/notifications","loading","main h1"],
  ["알림 목록 오류","/apps/notifications","error","[role=alert]"],
  ["기록 로딩","/apps/demo","loading",".monitor-loading"], ["기록 오류","/apps/demo","error","[role=alert]"],
  ["앱 설정","/apps/demo/settings","normal",".settings-sections"], ["내 계정","/account","normal",".sp-kv"],
];
const profiles = [
  [1440,"light",1,false], [1280,"dark",1,false], [390,"light",1,false], [390,"dark",2,true],
];
const selected = process.argv.slice(3);
if (selected.some(id => !cases[Number(id)] || String(Number(id)) !== id)) throw Error("Unknown screen index");
const server = await createServer({server:{host:"127.0.0.1",port:4179,strictPort:true,hmr:false},
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid") }});
let browser;
try {
  await server.listen();
  browser = process.platform === "win32" ? await chromium.launch({channel:"msedge"})
    : existsSync(webkit.executablePath()) ? await webkit.launch() : await chromium.launch({channel:"chrome"});
  const origin = "http://127.0.0.1:4179";
  const entries = [];
  for (const [width,colorScheme,scale,reduced] of profiles) {
    for (const [index,[title,path,state,ready]] of cases.entries()) {
      if (selected.length && !selected.includes(String(index))) continue;
      const page = await browser.newPage({ viewport:{width,height:width===390?844:900}, colorScheme,
        reducedMotion: reduced ? "reduce" : "no-preference", locale:"ko-KR",timezoneId:"Asia/Seoul", serviceWorkers:"block" });
      try {
        await page.clock.setFixedTime(new Date(now));
        await mockPage(page,state,path.startsWith("/apps") || path==="/account",origin);
        await page.goto(origin+path,{waitUntil:"domcontentloaded"});
        await page.locator(ready).first().waitFor({timeout:12000});
        if (scale===2) await page.addStyleTag({content:"html { font-size: 200% !important }"});
        await page.evaluate(()=>window.scrollTo(0,0));
        if (phase === "after" && path === "/") {
          const example = page.getByRole("region", {name:"예시 화면", exact:true});
          await example.getByRole("button", {name:"문제 상세", exact:true}).click();
          await example.getByRole("heading", {name:"모임 신청 20건 중 6건 실패"}).waitFor();
          await example.getByRole("button", {name:"앱 홈", exact:true}).click();
          await page.evaluate(()=>window.scrollTo(0,0));
        }
        if (phase === "after" && path.endsWith("/issues/example") && state === "failure") {
          await page.getByRole("heading", {name:"모임 신청 20건 중 6건 실패"}).waitFor();
          const title = page.getByRole("heading", {level:1,name:"모임 신청 · 실패 문제 상세"});
          if (!await title.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle === "none"))
            throw Error("Issue heading focus");
          if (!await page.getByRole("button", {name:"문제 아님으로 닫기"}).evaluate(el => el.classList.contains("secondary")))
            throw Error("Dismiss action hierarchy");
        }
        const overflow = await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
        if (phase === "after" && width === 390 && scale === 1) {
          const endings = await page.evaluate(shortKoreanEndings);
          if (endings.length) console.warn("Short last lines", index, endings);
        }
        const issues = [];
        if (phase === "after") {
          await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
          const violations = await page.evaluate(async () => (await window.axe.run(document, {
            runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]},
          })).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
          issues.push(...violations);
        }
        if (phase === "after" && reduced && await page.evaluate(()=>document.getAnimations().length))
          throw Error("Reduced-motion animation on "+path);
        const file = String(index).padStart(2,"0")+"-"+state+"-"+width+"-"+colorScheme+".jpg";
        await page.screenshot({path:resolve(dir,file),type:"jpeg",quality:80,fullPage:true,animations:"disabled"});
        entries.push({title,state,width,colorScheme,scale,reduced,file,overflow,issues});
        if (overflow>1) console.warn("Overflow",file,overflow);
        if (phase === "after" && state === "failure" && path === "/apps/demo") {
          const link = page.locator("#issues a").first();
          await tabTo(page,link);
          await page.keyboard.press("Enter");
          const copy = page.getByRole("button",{name:"AI에 보낼 내용 복사",exact:true});
          await tabTo(page,copy);
          await page.keyboard.press("Enter");
          await page.getByRole("button",{name:"복사했어요",exact:true}).waitFor();
        }
      } finally { await page.close(); }
    }
  }
  if (phase === "after" && (!selected.length || selected.includes("0"))) {
    const motionDir = resolve(dir, "../motion");
    const page = await browser.newPage({viewport:{width: 980, height: 720},
      recordVideo:{dir:motionDir,size:{width: 800,height: 588}}, reducedMotion:"no-preference",
      locale:"ko-KR",timezoneId:"Asia/Seoul",serviceWorkers:"block"});
    const video = page.video();
    try {
      await mockPage(page, "normal", false, origin);
      await page.goto(origin);
      await page.locator(".intro h1").waitFor();
      await page.waitForTimeout(850);
      for (const selector of [".review-story", ".answers", ".product-example", ".alert-examples", ".section-heading[data-mood]"]) {
        await page.locator(selector).evaluate(el => el.scrollIntoView({behavior:"smooth",block:"center"}));
        await page.waitForTimeout(1100);
        if (selector === ".product-example") {
          await page.getByRole("button",{name:"문제 상세",exact:true}).click();
          await page.waitForTimeout(650);
        }
      }
    } finally { await page.close(); }
    await video.saveAs(resolve(motionDir, "landing.webm"));
    await video.delete();
  }
  const resultsPath = resolve(dir,"results.json");
  const results = selected.length
    ? [...JSON.parse(await readFile(resultsPath,"utf8")).filter(old => !entries.some(entry => entry.file === old.file)), ...entries]
    : entries;
  await writeFile(resultsPath,JSON.stringify(results,null,2)+"\n");
  console.log(entries.length+" screenshots in "+dir);
  if (phase === "after" && entries.some(entry=>entry.issues.length || entry.overflow > 1))
    throw Error("Review overflow or axe findings in results.json");
} finally { await browser?.close(); await server.close(); }

// Inspect rendered lines, including text split across inline markup.
function shortKoreanEndings() {
  const findings = [];
  for (const el of document.querySelectorAll("main :is(h1,h2,h3,p,small,label,button,summary,dd,blockquote)")) {
    if (!el.checkVisibility() || el.childElementCount && el.querySelector("input,button,p")) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const lines = new Map();
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.length; i++) {
        range.setStart(node,i);
        range.setEnd(node,i+1);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const top = Math.round(rect.bottom);
        lines.set(top,(lines.get(top) ?? "") + node.data[i]);
      }
    }
    const last = [...lines.values()].at(-1)?.trim() ?? "";
    if (lines.size > 1 && /^[가-힣]{1,2}[.!?]?$/.test(last)) findings.push(el.textContent.trim());
  }
  return findings;
}

async function tabTo(page,target) {
  await target.waitFor();
  for (let n=0;n<80;n++) {
    if (await target.evaluate(el=>el===document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw Error("Keyboard could not reach "+target);
}
