import { mkdir, writeFile } from "node:fs/promises";
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
];
const profiles = [
  [1440,"light",1,false], [1280,"dark",1,false], [390,"light",1,false], [390,"dark",2,true],
];
const server = await createServer({server:{host:"127.0.0.1",port:4179,strictPort:true,hmr:false},
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid") }});
let browser;
try {
  await server.listen();
  browser = process.platform === "win32" ? await chromium.launch({channel:"msedge"}) : await webkit.launch();
  const origin = "http://127.0.0.1:4179";
  const entries = [];
  for (const [width,colorScheme,scale,reduced] of profiles) {
    for (const [index,[title,path,state,ready]] of cases.entries()) {
      const page = await browser.newPage({ viewport:{width,height:width===390?844:900}, colorScheme,
        reducedMotion: reduced ? "reduce" : "no-preference", locale:"ko-KR",timezoneId:"Asia/Seoul", serviceWorkers:"block" });
      try {
        await page.clock.setFixedTime(new Date(now));
        await mockPage(page,state,path.startsWith("/apps"),origin);
        await page.goto(origin+path,{waitUntil:"domcontentloaded"});
        await page.locator(ready).first().waitFor({timeout:12000});
        if (scale===2) await page.addStyleTag({content:"html { font-size: 200% !important }"});
        await page.evaluate(()=>window.scrollTo(0,0));
        const overflow = await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
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
  await writeFile(resolve(dir,"results.json"),JSON.stringify(entries,null,2)+"\n");
  console.log(entries.length+" screenshots in "+dir);
  if (phase === "after" && entries.some(entry=>entry.issues.length || entry.overflow > 1))
    throw Error("Review overflow or axe findings in results.json");
} finally { await browser?.close(); await server.close(); }

async function tabTo(page,target) {
  await target.waitFor();
  for (let n=0;n<80;n++) {
    if (await target.evaluate(el=>el===document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw Error("Keyboard could not reach "+target);
}
