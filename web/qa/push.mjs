import { mkdir,readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockPage } from "./fixtures.mjs";

const origin = "http://127.0.0.1:4193";
const output = new URL("../../docs/design/qa/T49/",import.meta.url);
const endpoint = "https://web.push.apple.com/fixture";
const server = await createServer({ server:{host:"127.0.0.1",port:4193,strictPort:true},define:{
  "import.meta.env.VITE_SUPABASE_URL":JSON.stringify("https://example.supabase.co"),
  "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":JSON.stringify("sb_publishable_qa_local_only"),
  "import.meta.env.VITE_INGEST_URL":JSON.stringify("https://ingest.ship-and-ping.invalid"),
}});
await mkdir(output,{recursive:true});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
  for (const home of [false,true]) {
    const page = await browser.newPage({viewport:{width:390,height:844},locale:"ko-KR",
      userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari/604.1"});
    await mockPage(page,"normal",true,origin);
    await page.addInitScript(({home,endpoint}) => {
      Object.defineProperty(navigator,"standalone",{value:home});
      const reg = {pushManager:{getSubscription:async () => home ? {endpoint} : null}};
      Object.defineProperty(navigator,"serviceWorker",{value:{register:async () => reg,getRegistration:async () => reg}});
      Object.defineProperty(window,"Notification",{value:{permission:home?"granted":"default"}});
    },{home,endpoint});
    await page.route("**/rest/v1/push_subscriptions?**",r => r.fulfill({json:home?[{id:"one",user_agent:"iPhone",created_at:"2026-11-27",endpoint}]:[]}));
    await page.route("**/rpc/notification_settings",r => r.fulfill({json:{push:true,subscribed:home,email:true,connected:false,broken:false,channel:null}}));
    await page.goto(origin+"/apps/demo/notifications");
    await (home ? page.getByRole("button",{name:"시험 푸시 보내기"}) : page.getByText(/iOS·iPadOS 16.4/)).waitFor();
    await page.screenshot({path:fileURLToPath(new URL(home?"push-enabled-390.png":"ios-install-390.png",output))});
    if (home) {
      // Capture the worker's showNotification arguments inside a clearly marked preview.
      let notice;
      const source = await readFile(new URL("../public/sw.js",import.meta.url),"utf8");
      const events = {};
      runInNewContext(source,{URL,self:{location:{origin},addEventListener:(name,fn)=>{events[name]=fn;},
        registration:{showNotification:(title,options)=>{notice={title,...options};}}}});
      events.push({data:{json:()=>({title:"[쉽앤핑] 트루바 · 장소 목록 보기가 느려졌어요",body:"평소 약 0.2초 → 지금 약 1.4초"})},waitUntil(){}});
      await page.evaluate(notice => {
        const preview = document.createElement("section");
        preview.className = "panel";
        for (const [tag,text] of [["small","푸시 알림 예시"],["strong",notice.title],["p",notice.body]]) {
          const element = document.createElement(tag);
          element.textContent = text;
          preview.append(element);
        }
        document.querySelector(".push-channel").before(preview);
      },notice);
      await page.screenshot({path:fileURLToPath(new URL("notification-example-390.png",output))});
    }
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
