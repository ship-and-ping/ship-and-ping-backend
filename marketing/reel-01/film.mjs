import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, prepareDirs } from "./capture-utils.mjs";

export async function assemble() {
  await prepareDirs();
  const shots=["connect","paste","arrival","alert","copy","preview","update","resolved"];
  // Keep the key-issuing and paste shots in their checked, narrow crops.
  // For the alert and timeline, show the surrounding real app in the window.
  const wide = {alert:[1664,840,572,196],update:[1320,668,620,516],resolved:[1320,668,620,766]};
  for (const [shot,[w,h,x,y]] of Object.entries(wide)) {
    await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-i","raw/"+shot+".mp4","-vf",
      "crop="+w+":"+h+":"+x+":"+y+",scale=872:440:flags=lanczos,setsar=1","-an","-c:v","libx264","-threads","3","-crf","15","-pix_fmt","yuv420p","capture/"+shot+"-wide.mp4"]);
  }
  await writeFile("capture/shots.txt",shots.map(s=>"file '"+s+(wide[s]?"-wide":"")+".mp4'").join("\n")+"\n");
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-f","concat","-safe","1","-i","capture/shots.txt",
    "-c","copy","-an","-movflags","+faststart","composition/desktop.mp4"]);
  for (const [shot,area] of [["alert","822:292:16:77"],["preview","834:346:14:42"],["resolved","840:180:16:211"],["paste","854:416:8:10"]]) {
    await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-ss",shot==="paste"?"0":"0.5","-i","capture/"+shot+".mp4","-vf","crop="+area,
      "-frames:v","1","-update","1","composition/"+shot+".png"]);
  }
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
