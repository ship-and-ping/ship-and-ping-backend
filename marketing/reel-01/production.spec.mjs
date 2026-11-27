import {test,expect} from "playwright/test";
import {execFileSync,spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {existsSync} from "node:fs";
import {writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {assemble} from "./film.mjs";
import {run} from "./capture-utils.mjs";
import {measureHolds,measureCamera} from "./stability.mjs";

const file=resolve("final/ship-and-ping-reel-01.mp4");
const win=process.platform==="win32";
const cli=win?"node_modules\\.bin\\hyperframes.cmd":"./node_modules/.bin/hyperframes";
const localEnv={...process.env,HYPERFRAMES_NO_TELEMETRY:"1",DO_NOT_TRACK:"1",HYPERFRAMES_NO_UPDATE_CHECK:"1",
  HYPERFRAMES_CACHE_DIR:resolve(".cache/hyperframes"),HYPERFRAMES_FONT_CACHE_DIR:resolve(".cache/fonts"),
  HYPERFRAMES_EXTRACT_CACHE_DIR:resolve(".cache/extract")};
test("render final portrait master",async()=>{
  await assemble();
  const chrome = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome","/usr/bin/google-chrome","/usr/bin/chromium"
  ].find(existsSync);
  if(!chrome)throw Error("Install or locate an existing Chrome browser.");
  const env={...localEnv,HYPERFRAMES_BROWSER_PATH:chrome};
  await run(cli,
    ["render","composition","--strict","--output","final/ship-and-ping-reel-01.mp4","--fps","60","--quality","high","--video-frame-format","png","--workers","2"],
    {env,shell:win});
});
test("playback of all 2424 frames and representative stills",async({page})=>{
  await run(cli,["lint","composition"],{env:localEnv,shell:win});
  await page.goto(pathToFileURL(resolve("composition/index.html")).href);
  await page.evaluate(()=>document.fonts.ready);
  const bounds=await page.evaluate(()=>{
    const timeline=window.__timelines.main;
    const subjects=[[1.7,"#hook"],[3.7,"#lost"],[5.3,"#say"],[6.9,"#unsure"],[8.7,"#promise"],[11.5,"#connect"],[21.8,"#alert"],[28.5,"#prompt"],[35.5,"#resolve"],[39,"#end"],[39,"#url"]];
    return subjects.map(([t,selector])=>{
      timeline.seek(t);
      const range=document.createRange();range.selectNodeContents(document.querySelector(selector));
      const b=range.getBoundingClientRect();return {selector,left:b.left,top:b.top,right:b.right,bottom:b.bottom};
    });
  });
  for(const b of bounds){expect(b.left,b.selector).toBeGreaterThanOrEqual(60);expect(b.right,b.selector).toBeLessThanOrEqual(940);expect(b.top,b.selector).toBeGreaterThanOrEqual(250);expect(b.bottom,b.selector).toBeLessThanOrEqual(1500);}
  const cards=await page.evaluate(()=>{
    return [[21.5,"#lift"],[28.67,"#sheet"],[30.2,"#inbox"],[35.5,"#verified"]].map(([time,id])=>{
      window.__timelines.main.seek(time);
      const {left,right,top,bottom}=document.querySelector(id).getBoundingClientRect();
      return {id,left,right,top,bottom};
    });
  });
  for(const card of cards){
    expect(card.left,card.id).toBeGreaterThanOrEqual(60);
    expect(card.right,card.id).toBeLessThanOrEqual(940);
    expect(card.bottom,card.id).toBeLessThanOrEqual(1500);
    expect(card.top,card.id).toBeGreaterThanOrEqual(250);
  }
  // The fold starts with the entire sheet in view, including its far right edge.
  const earlyFold=await page.locator("#sheet").evaluate(sheet=>{
    window.__timelines.main.seek(30);
    return getComputedStyle(sheet).clipPath;
  });
  const rightEdge=earlyFold.match(/^polygon\([^,]+,\s*([\d.]+)%/);
  expect(Number(rightEdge?.[1]),"Width of the sheet at the start of folding (%)").toBeGreaterThan(95);
  const separated=await page.evaluate(()=>{
    for(let frame=300;frame<450;frame++){
      window.__timelines.main.seek(frame/60);
      const first=document.querySelector("#bubble").getBoundingClientRect();
      const second=document.querySelector("#echo").getBoundingClientRect();
      if(first.top<second.bottom && second.top<first.bottom && first.left<second.right && second.left<first.right)return false;
    }
    return true;
  });
  expect(separated,"The settled complaint bubbles must remain legible").toBe(true);
  const ffprobe=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",file],{encoding:"utf8"}));
  expect(ffprobe.streams.length).toBe(1);
  expect(ffprobe.streams[0]).toMatchObject({codec_name:"h264",width:1080,height:1920,r_frame_rate:"60/1",nb_frames:"2424"});
  const pts=JSON.parse(execFileSync("ffprobe",["-v","error","-select_streams","v:0","-show_frames",
    "-show_entries","frame=best_effort_timestamp_time","-of","json",file],{encoding:"utf8"})).frames;
  expect(pts.length).toBe(2424);
  expect(pts.every((frame,i)=>Math.abs(Number(frame.best_effort_timestamp_time)-i/60)<0.00001)).toBe(true);
  const scan=spawnSync("ffmpeg",["-hide_banner","-nostats","-xerror","-i",file,"-vf","blackdetect=d=0.016:pix_th=0.05","-f","null","-"],{encoding:"utf8"});
  expect(scan.status).toBe(0);
  expect(scan.stderr).not.toContain("black_start:");
  const times=[1.53,5.37,8.35,12.8,21.7,28.67,35.78,39.23];
  for(const [i,at] of times.entries()){
    await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-ss",String(at),"-i",file,"-frames:v","1","-update","1","frames/0"+(i+1)+".png"]);
  }
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-framerate","1","-i","frames/%02d.png","-vf","scale=270:480,tile=4x2","-frames:v","1","-update","1","qa/contact.png"]);
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-i",file,"-vf","select=not(mod(n\\,60)),scale=216:384,drawtext=fontfile=composition/NotoSansKR-VF.ttf:text='%{n}s':fontsize=15:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=3:x=7:y=360,tile=7x6",
    "-frames:v","1","-update","1","qa/timeline.png"]);
  // Count the dark ink in each line of the enlarged recording on the encoded frame.
  const inkHeights=[1108,1166,1227,1287].map(y=>{
    const scan=spawnSync("ffmpeg",["-hide_banner","-nostats","-ss","28.67","-i",file,
      "-vf","crop=556:52:358:"+y+",format=gray,negate,bbox=min_val=140",
      "-frames:v","1","-f","null","-"],{encoding:"utf8"});
    expect(scan.status).toBe(0);
    const height=Number(scan.stderr.match(/\bw:\d+ h:(\d+) crop=/)?.[1]);
    expect(height,"Visible prompt ink at y="+y).toBeGreaterThanOrEqual(32);
    return height;
  });
  console.log("Prompt ink heights",inkHeights);
  const camera=await measureCamera(page);
  const stability=measureHolds(file);
  await writeFile("qa/stability.json",JSON.stringify({camera,stability,inkHeights},null,2));
  for(const move of camera)expect(move.reversals).toBe(0);
  for(const shot of stability)expect(shot.maxShift,shot.shot).toBe(0);
  await writeFile("qa/playback.html",'<meta charset="utf-8"><style>*{margin:0;background:#261b40}video{display:block;height:100vh}</style><video preload="auto" muted playsinline src="../final/ship-and-ping-reel-01.mp4"></video>');
  await page.goto(pathToFileURL(resolve("qa/playback.html")).href);
  const video=page.locator("video");
  const playback=await video.evaluate(async el=>{
    if(el.readyState<3) await new Promise(resolve=>el.addEventListener("canplay",resolve,{once:true}));
    const ended=new Promise((res,rej)=>{el.onended=res;el.onerror=()=>rej(Error("Video decode failed"));});
    const first=performance.now(); await el.play();await ended;
    const quality=el.getVideoPlaybackQuality();
    return {duration:el.duration,ended:el.ended,elapsed:(performance.now()-first)/1000,
      total:quality.totalVideoFrames,dropped:quality.droppedVideoFrames};
  });
  expect(playback.ended).toBe(true);
  expect(playback.duration).toBeCloseTo(40.4,1);
  expect(playback.total).toBe(2424);
  console.log(JSON.stringify(playback));
  await writeFile("qa/playback.json",JSON.stringify({playback,streams:ffprobe.streams},null,2));
});


test("proof representative frames before encoding",async({page})=>{
  await assemble();
  await page.setViewportSize({width:1080,height:1920});
  await page.goto(pathToFileURL(resolve("composition/index.html")).href);
  await page.evaluate(()=>document.fonts.ready);
  for(const [i,time] of [1.53,5.37,8.35,12.8,21.7,28.67,35.78,39.23].entries()){
    await page.evaluate(async t=>{
      const video=document.querySelector("video");
      if(t>=8&&t<37.2){
        const ready=new Promise(r=>video.addEventListener("seeked",r,{once:true}));
        video.currentTime=t-8;await ready;
      }
      window.__timelines.main.seek(t);
    },time);
    await page.screenshot({path:"qa/proof"+i+".png"});
  }
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-start_number","0","-i","qa/proof%d.png","-vf","scale=270:480,tile=4x2","-frames:v","1","-update","1","qa/proof.png"]);
});

test("playback layout during the four demonstrations", async ({page})=>{
  await page.goto(pathToFileURL(resolve("composition/index.html")).href);
  await page.evaluate(()=>document.fonts.ready);
  const layout=await page.evaluate(()=>{
    const actor=document.querySelector("#actor");
    const shapes=[...document.querySelectorAll("#pose .sheep path,#pose .sheep circle,#pose .sheep ellipse")];
    const appWindow=document.querySelector("#window");
    const holds=[[20.66,23.52,"#lift"],[28.05,29.95,"#sheet"],[34.85,36.84,"#verified"]];
    const result={frames:0,minScale:1,right:0,bottom:0,windowGap:Infinity,cardGap:Infinity};
    for(let i=624;i<2232;i++){
      const t=i/60;
      window.__timelines.main.seek(t);
      const rects=shapes.map(shape=>shape.getBoundingClientRect());
      const sheep={top:Math.min(...rects.map(r=>r.top)),right:Math.max(...rects.map(r=>r.right)),bottom:Math.max(...rects.map(r=>r.bottom))};
      result.frames++;
      result.minScale=Math.min(result.minScale,gsap.getProperty(actor,"scaleX"));
      result.right=Math.max(result.right,sheep.right);
      result.bottom=Math.max(result.bottom,sheep.bottom);
      const gap=sheep.top-appWindow.getBoundingClientRect().bottom;
      if(gap<result.windowGap){result.windowGap=gap;result.windowTime=t;}
      for(const [start,end,id] of holds){
        if(t<start || t>=end)continue;
        const card=document.querySelector(id).getBoundingClientRect();
        const side=card.left-sheep.right;
        if(side<result.cardGap){result.cardGap=side;result.cardTime=t;}
      }
    }
    return result;
  });
  console.log("Demo layout",JSON.stringify(layout));
  expect(layout.minScale).toBeGreaterThanOrEqual(.60);
  expect(layout.right).toBeLessThanOrEqual(940);
  expect(layout.bottom).toBeLessThanOrEqual(1500);
  expect(layout.windowGap).toBeGreaterThanOrEqual(0);
  expect(layout.cardGap).toBeGreaterThanOrEqual(0);
});
