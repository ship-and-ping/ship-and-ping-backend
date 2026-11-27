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
test("playback of all 1830 frames and representative stills",async({page})=>{
  await run(cli,["lint","composition"],{env:localEnv,shell:win});
  await page.goto(pathToFileURL(resolve("composition/index.html")).href);
  await page.evaluate(()=>document.fonts.ready);
  const bounds=await page.evaluate(()=>{
    const timeline=window.__timelines.main;
    const subjects=[[1.7,"#hook"],[3.7,"#lost"],[5.3,"#say"],[6.9,"#unsure"],[8.7,"#promise"],[11.5,"#connect"],[16.1,"#alert"],[20.4,"#prompt"],[25,"#resolve"],[29,"#end"],[29,"#url"]];
    return subjects.map(([t,selector])=>{
      timeline.seek(t);
      const range=document.createRange();range.selectNodeContents(document.querySelector(selector));
      const b=range.getBoundingClientRect();return {selector,left:b.left,top:b.top,right:b.right,bottom:b.bottom};
    });
  });
  for(const b of bounds){expect(b.left,b.selector).toBeGreaterThanOrEqual(60);expect(b.right,b.selector).toBeLessThanOrEqual(940);expect(b.top,b.selector).toBeGreaterThanOrEqual(250);expect(b.bottom,b.selector).toBeLessThanOrEqual(1500);}
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
  expect(ffprobe.streams[0]).toMatchObject({codec_name:"h264",width:1080,height:1920,r_frame_rate:"60/1",nb_frames:"1830"});
  const pts=JSON.parse(execFileSync("ffprobe",["-v","error","-select_streams","v:0","-show_frames",
    "-show_entries","frame=best_effort_timestamp_time","-of","json",file],{encoding:"utf8"})).frames;
  expect(pts.length).toBe(1830);
  expect(pts.every((frame,i)=>Math.abs(Number(frame.best_effort_timestamp_time)-i/60)<0.00001)).toBe(true);
  const scan=spawnSync("ffmpeg",["-hide_banner","-nostats","-xerror","-i",file,"-vf","blackdetect=d=0.016:pix_th=0.05","-f","null","-"],{encoding:"utf8"});
  expect(scan.status).toBe(0);
  expect(scan.stderr).not.toContain("black_start:");
  const times=[1.53,5.37,8.46,11.0,16.57,21.74,25.89,29.33];
  for(const [i,at] of times.entries()){
    await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-ss",String(at),"-i",file,"-frames:v","1","-update","1","frames/0"+(i+1)+".png"]);
  }
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-framerate","1","-i","frames/%02d.png","-vf","scale=270:480,tile=4x2","-frames:v","1","-update","1","qa/contact.png"]);
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-i",file,"-vf","select=not(mod(n\\,60)),scale=216:384,tile=8x4",
    "-frames:v","1","-update","1","qa/timeline.png"]);
  const camera=await measureCamera(page);
  const stability=measureHolds(file);
  await writeFile("qa/stability.json",JSON.stringify({camera,stability},null,2));
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
  expect(playback.duration).toBeCloseTo(30.5,1);
  expect(playback.total).toBe(1830);
  console.log(JSON.stringify(playback));
  await writeFile("qa/playback.json",JSON.stringify({playback,streams:ffprobe.streams},null,2));
});


test("proof representative frames before encoding",async({page})=>{
  await assemble();
  await page.setViewportSize({width:1080,height:1920});
  await page.goto(pathToFileURL(resolve("composition/index.html")).href);
  await page.evaluate(()=>document.fonts.ready);
  for(const [i,time] of [1.53,5.37,8.46,11,16.57,21.74,25.89,29.33].entries()){
    await page.evaluate(async t=>{
      const video=document.querySelector("video");
      if(t>=10.4&&t<27.3){
        const ready=new Promise(r=>video.addEventListener("seeked",r,{once:true}));
        video.currentTime=t-10.4;await ready;
      }
      window.__timelines.main.seek(t);
    },time);
    await page.screenshot({path:"qa/proof"+i+".png"});
  }
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-start_number","0","-i","qa/proof%d.png","-vf","scale=270:480,tile=4x2","-frames:v","1","-update","1","qa/proof.png"]);
});
