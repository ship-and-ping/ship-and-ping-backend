import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, prepareDirs } from "./capture-utils.mjs";

export async function assemble() {
  await prepareDirs();
  // Each segment keeps the recording's native cadence. Only an already visible
  // frame is repeated. In particular, keep the short-lived copy confirmations.
  const cuts = [
    // source, first frame, exclusive last frame, length at 30 fps, pad at start
    ["connect", 0, 22, 117, true], ["connect", 22, 24, 57],
    ["paste", 10, 14, 54], ["arrival", 0, 48, 54],
    ["alert", 0, 123, 192],
    ["copy", 0, 24, 60, true], ["copy", 24, 26, 60],
    ["preview", 0, 67, 84], ["update", 0, 49, 90],
    ["resolved", 0, 71, 108],
  ];
  // Keep the key-issuing and paste shots in their checked, narrow crops.
  // For the alert and timeline, show the surrounding real app in the window.
  const wide = {alert:[1664,840,572,196],update:[1320,668,620,516],resolved:[1320,668,620,766]};
  for (const [shot,[w,h,x,y]] of Object.entries(wide)) {
    await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-i","raw/"+shot+".mp4","-vf",
      "crop="+w+":"+h+":"+x+":"+y+",scale=872:440:flags=lanczos,setsar=1","-an","-c:v","libx264","-threads","3","-crf","15","-pix_fmt","yuv420p","capture/"+shot+"-wide.mp4"]);
  }
  const parts = [];
  for (const [shot, first, end, length, padStart] of cuts) {
    const input = "capture/" + shot + (wide[shot] ? "-wide" : "") + ".mp4";
    const index = parts.length;
    const side = padStart ? "start" : "stop";
    const filter = `trim=start_frame=${first}:end_frame=${end},setpts=PTS-STARTPTS,` +
      `tpad=${side}_mode=clone:${side}=${length - (end - first)}`;
    await run("ffmpeg", ["-hide_banner","-loglevel","error","-y","-i",input,"-vf",filter,
      "-an","-c:v","libx264","-threads","3","-crf","15","-pix_fmt","yuv420p","capture/edit-"+index+".mp4"]);
    // Tell the concat demuxer exact source-frame durations.
    parts.push("file 'edit-"+index+".mp4'\nduration "+(length/30).toFixed(6));
  }
  await writeFile("capture/shots.txt",parts.join("\n")+"\n");
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-f","concat","-safe","1","-i","capture/shots.txt",
    "-c","copy","-an","-movflags","+faststart","composition/desktop.mp4"]);
  for (const [shot,area] of [["alert","604:280:26:79"],["resolved","460:170:26:213"],["paste","854:416:8:10"]]) {
    await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-ss",shot==="paste"?"0":"0.5","-i","capture/"+shot+".mp4","-vf","crop="+area,
      "-frames:v","1","-update","1","composition/"+shot+".png"]);
  }
  // Use the stationary, high-density recording of the real mobile preview.
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-ss","0.2","-i","raw/preview-mobile.mp4",
    "-frames:v","1","-update","1","composition/preview.png"]);
  const svg=(await readFile("../../docs/design/brand/sheep.svg","utf8"))
    .replace(/ id="/g,' class="').replace(/<!--[\s\S]*?-->/g,"").replace(/>\s+</g,"><");
  const template=await readFile("film.html","utf8"), motion=await readFile("motion.js","utf8");
  await writeFile("composition/index.html",template.replaceAll("SHEEP",()=>svg).replace("ANIMATION",()=>motion));
  await copyFile("../../docs/design/brand/ship-and-ping-wordmark.png","composition/wordmark.png");
  await copyFile("node_modules/hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js","composition/gsap.min.js");
  const font=["C:/Windows/Fonts/NotoSansKR-VF.ttf",join(homedir(),"Library/Fonts/NotoSansKR-VF.ttf"),
    "/usr/share/fonts/truetype/noto/NotoSansKR-VF.ttf","assets/NotoSansKR-VF.ttf"].find(existsSync);
  if(!font)throw Error("Provide the Noto Sans KR variable TTF in assets/NotoSansKR-VF.ttf.");
  await copyFile(font,"composition/NotoSansKR-VF.ttf");
}
