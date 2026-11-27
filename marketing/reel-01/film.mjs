import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, prepareDirs } from "./capture-utils.mjs";

export async function assemble() {
  await prepareDirs();
  const shots=["connect","paste","arrival","alert","copy","preview","update","resolved"];
  await writeFile("capture/shots.txt",shots.map(s=>"file '"+s+".mp4'").join("\n")+"\n");
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-f","concat","-safe","1","-i","capture/shots.txt",
    "-c","copy","-an","-movflags","+faststart","composition/desktop.mp4"]);
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
