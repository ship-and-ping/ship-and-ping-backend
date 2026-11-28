import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { mockPage } from "./fixtures.mjs";
import { recordFlow } from "./install-recording.mjs";

const before = process.argv.includes("--before");
const origin = "http://127.0.0.1:4196";
const directory = new URL("../../docs/design/qa/install-onboarding/", import.meta.url);
const path = name => fileURLToPath(new URL(name, directory));
const targets = [
  ["iphone", 390, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"],
  ["android", 390, "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/123 Mobile Safari/537.36"],
  ["pc", 1440, "Mozilla/5.0 (Windows NT 10.0) Chrome/123 Safari/537.36"],
];
const server = await createServer({server:{host:"127.0.0.1",port:4196,strictPort:true},define:{
  "import.meta.env.VITE_VAPID_PUBLIC_KEY":JSON.stringify("BA"),
  "import.meta.env.VITE_SUPABASE_URL":JSON.stringify("https://example.supabase.co"),
  "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":JSON.stringify("sb_publishable_qa_local_only"),
  "import.meta.env.VITE_INGEST_URL":JSON.stringify("https://ingest.ship-and-ping.invalid"),
}});
await mkdir(directory, {recursive:true});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
  for (const [device,width,userAgent] of targets) {
    for (const theme of ["light","dark"]) {
      const page = await browser.newPage({viewport:{width,height:844},userAgent,locale:"ko-KR",colorScheme:theme,reducedMotion:"reduce"});
      await mockPage(page,"normal",before,origin);
      await page.goto(origin + (before ? "/apps/demo/notifications" : "/install"));
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      if (before) await page.locator(".push-channel").scrollIntoViewIfNeeded();
      else {
        await page.getByRole("heading",{level:1}).waitFor();
        if (device === "android") await page.evaluate(() => {
          const event = Object.assign(new Event("beforeinstallprompt"),{prompt:async()=>{},userChoice:Promise.resolve({outcome:"accepted"})});
          window.dispatchEvent(event);
        });
      }
      await page.screenshot({path:path((before ? "before" : "after") + "-" + device + "-" + theme + ".png"),fullPage:!before});
      if (!before && device === "iphone") {
        await page.evaluate(() => {document.documentElement.style.fontSize="200%"});
        if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw Error("200% horizontal overflow");
      }
      await page.close();
    }
  }
  if (!before) {
    const mail = await readFile(new URL("../../worker/src/notify/install.html", import.meta.url),"utf8");
    await recordFlow(browser,origin,directory,targets[0][2],mail);
    for (const theme of ["light","dark"]) {
      const page = await browser.newPage({viewport:{width:390,height:844},colorScheme:theme});
      await page.setContent(mail.replaceAll("{{install_url}}", "https://example.invalid/install"));
      await page.screenshot({path:path("mail-" + theme + ".png")});
      await page.close();
    }
    const rows = targets.map(([device]) => ["light","dark"].map(theme =>
      '<section><h2>'+device+' · '+theme+'</h2><div>'+["before","after"].map((phase,i) =>
        '<figure><figcaption>'+["기존 알림 설정","설치 안내"][i]+'</figcaption><a href="'+phase+'-'+device+'-'+theme+'.png"><img src="'+phase+'-'+device+'-'+theme+'.png" alt="'+device+' '+theme+' '+phase+'"></a></figure>').join("")+'</div></section>').join("")).join("");
    await writeFile(path("index.html"), '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>쉽앤핑 설치 온보딩 검수</title><style>body{font:1rem system-ui;max-width:64rem;margin:auto;padding:1rem;color-scheme:light dark}section div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}figure{margin:0}img,video{max-width:100%}video{max-height:80vh}</style><h1>휴대폰 알림 설치 온보딩</h1><p>Edge에서 기기와 테마를 모의한 화면이에요. 이미지를 누르면 원본을 볼 수 있어요.</p><video controls src="flow.webm"></video>'+rows+'<h2>설치 안내 메일</h2><img src="mail-light.png" alt="밝은 메일"><img src="mail-dark.png" alt="어두운 메일"></html>');
  }
} finally {
  await browser?.close();
  await server.close();
}
