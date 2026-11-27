import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export function run(command, args, options = {}) {
  const child = spawn(command,args,{stdio:["ignore","inherit","inherit"],windowsHide:true,...options});
  return once(child,"exit").then(([code])=>{if(code !== 0) throw Error(command+" exited "+code);});
}
export async function take(page, name, frames, camera, action = async () => {}) {
  const width = 1440, height = 900;
  const {x,y,w,h} = camera;
  const left = Math.max(0,Math.min(width-w,x)), top = Math.max(0,Math.min(height-h,y));
  // Every source frame is captured at native 2× DPR, including focus and control state.
  const args = ["-hide_banner","-loglevel","error","-y","-f","image2pipe","-framerate","30",
    "-vcodec","mjpeg","-i","pipe:0","-an","-c:v","libx264","-threads","3","-preset","ultrafast","-crf","13",
    "-pix_fmt","yuv420p",resolve("raw",name+".mp4")];
  const child = spawn("ffmpeg",args,{stdio:["pipe","ignore","inherit"],windowsHide:true});
  const done = once(child,"exit");
  try {
    for (let i=0;i<frames;i++) {
      await action(i);
      const data = await page.screenshot({type:"jpeg",quality:96,scale:"device",caret:"initial"});
      if (!child.stdin.write(data)) await once(child.stdin,"drain");
    }
  } finally { child.stdin.end(); }
  if ((await done)[0] !== 0) throw Error("Source recording failed: "+name);
  const dimensions = execFileSync("ffprobe",["-v","error","-select_streams","v:0","-show_entries","stream=width,height","-of","csv=p=0",resolve("raw",name+".mp4")],{encoding:"utf8"}).trim();
  if (!dimensions.startsWith("2880,1800")) throw Error("Expected 1440 × 900 at 2×, got "+dimensions);
  // Lock the framing once per take on the 4:2:0 chroma grid, before scaling.
  const even = n => 2 * Math.round(n / 2);
  const vf = "crop="+even(2*w)+":"+even(2*h)+":"+even(2*left)+":"+even(2*top)
    +",scale=872:440:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos"
    +",pad=872:440:(ow-iw)/2:(oh-ih)/2:color="+(camera.matte || "white")+",setsar=1";
  await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-i",resolve("raw",name+".mp4"),"-vf",vf,
    "-an","-c:v","libx264","-threads","3","-preset","fast","-crf","15","-pix_fmt","yuv420p",resolve("capture",name+".mp4")]);
  console.log(name, frames+" frames", Math.round(left),Math.round(top),w,h);
}
export async function prepareDirs() {
  for (const folder of ["raw","capture","composition","final","frames","qa"]) await mkdir(folder,{recursive:true});
}
export async function cameraFor(locator, width, offsetX, offsetY, height=width*440/872, matte="white") {
  const rect = await locator.boundingBox();
  if(!rect) throw Error("Missing camera subject "+locator);
  return {x:rect.x+offsetX,y:rect.y+offsetY,w:width,h:height,matte};
}
