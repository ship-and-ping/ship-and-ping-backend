import {test,expect} from "playwright/test";
import {execFileSync,spawnSync} from "node:child_process";
import {resolve} from "node:path";
import {existsSync} from "node:fs";
import {writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {assemble} from "./film.mjs";
import {run} from "./capture-utils.mjs";

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
    ["render","composition","--strict","--output","final/ship-and-ping-reel-01.mp4","--fps","30","--quality","high","--video-frame-format","png","--workers","2"],
    {env,shell:win});
});
test("playback of all 915 frames and representative stills",async({page})=>{
  await run(cli,["lint","composition"],{env:localEnv,shell:win});
  await page.goto(pathToFileURL(resolve("composition/index.html")).href);
  const bounds=await page.evaluate(()=>{
    const timeline=window.__timelines.main;
    const subjects=[[1.7,"#intro h1"],[3.7,"#pain1"],[5.3,"#pain2"],[6.9,"#pain3"],[8.7,"#promise h2"],
      [11.5,"#hc"],[16.1,"#ha"],[20.4,"#hp"],[25,"#hr"],[29,"#end h2"],[29,".url"]];
    return subjects.map(([t,selector])=>{
      timeline.seek(t);
      const range=document.createRange();range.selectNodeContents(document.querySelector(selector));
      const b=range.getBoundingClientRect();return {selector,left:b.left,top:b.top,right:b.right,bottom:b.bottom};
    });
  });
  for(const b of bounds){expect(b.right,b.selector).toBeLessThanOrEqual(940);expect(b.top,b.selector).toBeGreaterThanOrEqual(250);expect(b.bottom,b.selector).toBeLessThanOrEqual(1500);}
  const ffprobe=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",file],{encoding:"utf8"}));
  expect(ffprobe.streams.length).toBe(1);
  expect(ffprobe.streams[0]).toMatchObject({codec_name:"h264",width:1080,height:1920,r_frame_rate:"30/1",nb_frames:"915"});
  const pts=JSON.parse(execFileSync("ffprobe",["-v","error","-select_streams","v:0","-show_frames",
    "-show_entries","frame=best_effort_timestamp_time","-of","json",file],{encoding:"utf8"})).frames;
  expect(pts.length).toBe(915);
  expect(pts.every((frame,i)=>Math.abs(Number(frame.best_effort_timestamp_time)-i/30)<0.00001)).toBe(true);
  const scan=spawnSync("ffmpeg",["-hide_banner","-nostats","-xerror","-i",file,"-vf","blackdetect=d=0.032:pix_th=0.05","-f","null","-"],{encoding:"utf8"});
  expect(scan.status).toBe(0);
  expect(scan.stderr).not.toContain("black_start:");
  const times=[1.7,6.85,8.35,10.96,16.5,19.63,25.43,29.1];
  for(const [i,at] of times.entries()){
    await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-ss",String(at),"-i",file,"-frames:v","1","-update","1","frames/0"+(i+1)+".png"]);
  }
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-framerate","1","-i","frames/%02d.png","-vf","scale=270:480,tile=4x2","-frames:v","1","-update","1","qa/contact.png"]);
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-i",file,"-vf","fps=1,scale=160:284,tile=8x4",
    "-frames:v","1","-update","1","qa/sequence.png"]);
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
  console.log(JSON.stringify(playback));
  await writeFile("qa/playback.json",JSON.stringify({playback,streams:ffprobe.streams},null,2));
});
