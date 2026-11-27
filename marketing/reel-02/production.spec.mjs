import { test, expect } from "playwright/test";
import { createServer } from "vite";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mountDemo, origin } from "./demo.mjs";

const comp = "composition";
const video = "final/ship-and-ping-reel-02.mp4";
const source = resolve("../../web");
const brand = "../../docs/design/brand/";
const font = ["C:/Windows/Fonts/NotoSansKR-VF.ttf","assets/NotoSansKR-VF.ttf","/usr/share/fonts/truetype/noto/NotoSansKR-VF.ttf"].find(existsSync);
const stills = [2.9,8.8,12.6,18.3,24.76,28.4];
const ff = args => execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-y",...args],{stdio:"inherit"});
const outer = loc => loc.evaluate(el => el.outerHTML);
const stageUrl = pathToFileURL(resolve(comp,"index.html")).href;

test("compose actual React elements and preview the six scenes", async ({page}) => {
  for(const dir of [comp,".cache","frames","qa","final"]) await mkdir(dir,{recursive:true});
  const aliases = ["react","react-dom","react-router-dom","@supabase/supabase-js"];
  const app = await createServer({
    configFile:false,root:source,envDir:false,cacheDir:resolve(".cache/vite"),
    resolve:{alias:Object.fromEntries(aliases.map(name=>[name,resolve("node_modules",name)]))},
    esbuild:{jsx:"automatic"},
    define:{
      "import.meta.env.VITE_SUPABASE_URL":JSON.stringify("https://example.supabase.co"),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":JSON.stringify("sb_publishable_demo_only"),
      "import.meta.env.VITE_INGEST_URL":JSON.stringify("https://ingest.ship-and-ping.invalid")
    },
    server:{host:"127.0.0.1",port:4192,strictPort:true,hmr:false,fs:{allow:[source,resolve("node_modules"),resolve(".cache")]}}
  });
  let bits;
  try {
    await app.listen();
    const phase = {value:"healthy"};
    await mountDemo(page,phase);
    await page.goto(origin+"/apps/demo");
    const home = page.locator(".monitor .hero-card");
    await expect(home).toContainText("모두 괜찮아요");
    const healthy = await outer(home);
    const homeHeading = await outer(page.locator(".monitor > h1"));
    const cards = page.locator("#features .app-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.locator("h3")).toHaveText(["신청하기","로그인","분석"]);
    const rows = (await cards.evaluateAll(items=>items.map(el=>{
      const excerpt = el.cloneNode(true);
      const badge = excerpt.querySelector(".feature-status");
      while (badge.nextSibling) badge.nextSibling.remove();
      return excerpt.outerHTML;
    })))
      .map(html=>'<div class="row-crop">'+html+'</div>').join("");
    phase.value = "problem";
    await page.reload();
    await expect(home.locator("h2")).toHaveText("분석이 느려졌어요");
    const problem = await outer(home);
    const alertText = await home.locator("h2").innerText();
    await page.goto(origin+"/apps/demo/issues/sample");
    const button = page.getByRole("button",{name:"AI에 보낼 내용 복사",exact:true});
    const copy = await outer(button);
    await button.click();
    const copied = await outer(page.getByRole("button",{name:"복사했어요",exact:true}));
    phase.value = "resolved";
    await page.reload();
    const historyTitle = await outer(page.getByRole("heading",{name:"지금까지 흐름"}));
    const eventRows = page.locator(".timeline li").filter({hasText:/새 버전 감지|해결됐어요/});
    await expect(eventRows).toHaveCount(2);
    const events = (await eventRows.evaluateAll(items=>items.map(el=>el.outerHTML))).join("");
    bits = {homeHeading,healthy,rows,problem,alertText,copy,copied,historyTitle,events};
  } finally { await page.close(); await app.close(); }
  let html = (await readFile("stage.html","utf8")).replace(/\{\{(\w+)\}\}/g,(_,name)=>{
    if(!bits[name]) throw Error("Unknown UI extract "+name);
    return bits[name];
  });

  for(const path of ["stage.css","motion.js","../../web/src/styles/app.css","../../web/src/styles/tokens.css",
    brand+"sheep.svg","node_modules/hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js"]){
    await copyFile(path,comp+"/"+path.split("/").at(-1));
  }
  // The renderer packages the brand font locally, so OS fallbacks are unnecessary.
  const tokens = await readFile(comp+"/tokens.css","utf8");
  await writeFile(comp+"/tokens.css",tokens.replace(/--sp-font:[^;]+;/,'--sp-font: "Noto Sans KR", sans-serif;'));
  const sheets = await Promise.all(["tokens.css","app.css","stage.css"].map(name=>readFile(comp+"/"+name,"utf8")));
  const css = '@font-face{font-family:ReelNoto;src:url("NotoSansKR-VF.ttf") format("truetype");font-weight:100 900;font-display:block}\n' +
    sheets.map(sheet=>sheet.trim().replace(/@font-face\s*\{[^}]+\}/g,"").replaceAll('"Noto Sans KR"',"ReelNoto")).join("\n");
  const sheep = (await readFile(brand+"sheep.svg","utf8")).replace(/ id=/g," data-part=");
  html = html.replace(/<img([^>]*?)src="sheep.svg">/g,(_,attributes)=>sheep.replace("<svg ","<svg "+attributes+" "));
  const motion = await readFile("motion.js","utf8");
  html = html.replace(/<link rel="stylesheet"[^>]*>/g,"").replace("</head>",()=>"<style>"+css+"</style></head>")
    .replace('<script src="motion.js"></script>',()=>"<script>"+motion+"</script>");
  await writeFile(comp+"/index.html",html);
  if(!font) throw Error("Noto Sans KR variable TTF is required.");
  await copyFile(font,comp+"/NotoSansKR-VF.ttf");
  await copyFile(brand+"ship-and-ping-wordmark.png",comp+"/wordmark.png");
  ff(["-i",comp+"/wordmark.png","-vf","format=rgba,colorkey=0x26163b:0.17:0.025", "-frames:v","1",comp+"/wordmark-cut.png"]);
});

test("compose six stills in a clean browser", async ({page})=>{
  await page.goto(stageUrl);
  await page.evaluate(()=>document.fonts.ready);
  for(const [i,t] of stills.entries()){
    await page.evaluate(t=>{window.__timelines.main.seek(t);},t);
    await page.screenshot({path:".cache/preview-"+(i+1)+".png"});
  }
  ff(["-framerate","1","-start_number","1","-i",".cache/preview-%d.png","-vf","scale=270:480,tile=3x2","-frames:v","1",".cache/preview.jpg"]);
});

test("encode 1800 video frames in the local HyperFrames renderer",async()=>{
  const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","/usr/bin/google-chrome","/usr/bin/chromium"].find(existsSync);
  if(!chrome)throw Error("An installed Chrome browser is required.");
  const env = {...process.env, HF_DEBUG_RENDER:"1", HF_STATIC_DEDUP:"false", HYPERFRAMES_NO_TELEMETRY:"1", DO_NOT_TRACK:"1",
    HYPERFRAMES_NO_UPDATE_CHECK:"1",HYPERFRAMES_BROWSER_PATH:chrome,HYPERFRAMES_CACHE_DIR:resolve(".cache/hyperframes"),
    HYPERFRAMES_FONT_CACHE_DIR:resolve(".cache/fonts"),HYPERFRAMES_EXTRACT_CACHE_DIR:resolve(".cache/extract")};
  const isWindows = process.platform==="win32";
  const child = spawn(isWindows?"node_modules\\.bin\\hyperframes.cmd":"node_modules/.bin/hyperframes",
    ["render",comp,"--strict","--output",video,"--fps","60","--quality","high","--video-frame-format","png","--workers","1"],
    {env,shell:isWindows,stdio:"inherit"});
  await new Promise((ok,fail)=>{child.once("error",fail);child.once("close",code=>code===0?ok():fail(Error("HyperFrames exited "+code)));});
});

test("inspect the final master, holds and safe area",async({page})=>{
  const meta=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",video],{encoding:"utf8"}));
  expect(meta.streams).toHaveLength(1);
  expect(meta.streams[0]).toMatchObject({codec_name:"h264",width:1080,height:1920,r_frame_rate:"60/1",nb_frames:"1800"});
  expect(Number(meta.format.duration)).toBe(30);
  for(const [i,t] of stills.entries()) ff(["-ss",String(t),"-i",video,"-frames:v","1","frames/0"+(i+1)+".png"]);
  ff(["-i",video,"-vf","select=not(mod(n\\,60)),scale=216:384,tile=6x5:padding=3:color=0x42394b","-frames:v","1","qa/timeline.png"]);
  await page.goto(stageUrl);
  await page.evaluate(()=>document.fonts.ready);
  const scripts = ["앱 켜 두고 자도 괜찮을까?","자는 동안 쉽앤핑이 지켜봐요","문제가 생기면 쉬운 말로",
    "일어나면 알림이 와 있어요","고쳐졌는지까지 확인해요","앱은 쉽앤핑이 지켜볼게요"];
  expect(await page.locator("#film .title").allTextContents()).toEqual(scripts);
  const failures = await page.evaluate(()=>{
    const fails = [];
    const selectors = ".title b, .night-time, .app-home h2, .row-crop h3, .feature-status, .alert-card h2, .clock, .notification p, .action button, .history li strong, .address";
    for(let frame=0;frame<1800;frame++){
      window.__timelines.main.seek(frame/60);
      const visibleScenes = [...document.querySelectorAll(".scene")].filter(el=>{
        const style = getComputedStyle(el);
        return style.visibility!=="hidden" && Number(style.opacity)>.01;
      });
      if(visibleScenes.length>1) return [{frame,sceneOverlap:visibleScenes.map(el=>el.id)}];
      for(const node of document.querySelectorAll(selectors)){
        let opacity=1;
        for(let parent=node;parent;parent=parent.parentElement){
          const style=getComputedStyle(parent);
          if(style.visibility==="hidden"){opacity=0;break;}
          opacity*=Number(style.opacity);
        }
        if(opacity<.5) continue;
        const range=document.createRange();
        range.selectNodeContents(node);
        const rect=range.getBoundingClientRect();
        if(rect.left<0 || rect.right>940 || rect.top<250 || rect.bottom>1500){
          fails.push({frame,text:node.textContent,extent:[rect.left,rect.top,rect.right,rect.bottom]});
          if(fails.length>=5)return fails;
        }
      }
    }
    return fails;
  });
  expect(failures).toEqual([]);
  const checks=[
    [2.9,"#night",".lid"],[8.8,"#watch","#features"],[12.6,"#problem",".alert-card"],
    [18.3,"#morning",".phone"],[21.85,"#fix",".original button"],[24.76,"#fix",".history li:last-child strong"],
    [28.4,"#close",".lockup"],[28.4,"#close",".address"]
  ];
  for(const [t,scene,subject] of checks){
    await page.evaluate(t=>{window.__timelines.main.seek(t);},t);
    for(const el of [page.locator(scene+" .title"),page.locator(subject)]){
      const b=await el.boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(250);
      expect(b.x+b.width).toBeLessThanOrEqual(940);expect(b.y+b.height).toBeLessThanOrEqual(1500);
    }
  }
  console.log(JSON.stringify({duration:meta.format.duration,bytes:meta.format.size,frames:meta.streams[0].nb_frames}));
});
