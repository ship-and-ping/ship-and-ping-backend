import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const directory = new URL("../../docs/design/qa/demo-insights/",import.meta.url);
const browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
try {
  for (const width of [1440,390]) for (const theme of ["light","dark"]) for (const screen of ["home","detail"]) {
    const desktop = width === 1440;
    const column = desktop ? 1088 : 358;
    const page = await browser.newPage({viewport:{width:3*column+64,height:1500},colorScheme:theme});
    const suffix = "-"+width+"-"+theme+".png";
    const files = ["refs/stat"+suffix,"refs/series"+suffix,"fixed-"+screen+suffix,"panels/hover-"+screen+suffix];
    const images = await Promise.all(files.map(async path => "data:image/png;base64,"+(await readFile(new URL(path,directory))).toString("base64")));
    await page.setContent('<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding:16px}h2{font-size:20px;margin:0 0 12px}canvas{width:100%;height:auto;display:block;margin-bottom:8px}</style><main><section><h2>Grafana 공개 데모</h2></section><section><h2>T48 '+(screen === "home" ? "앱 홈" : "기능 상세")+'</h2></section><section><h2>T48b 공유 십자선</h2></section></main>');
    await page.evaluate(async ({images,desktop,screen}) => {
      const sources = await Promise.all(images.map(async src => {const img = new Image(); img.src=src; await img.decode(); return img;}));
      const columns = document.querySelectorAll("section");
      function crop(source,column,x,y,w,h) {
        const canvas = document.createElement("canvas");
        canvas.width=w; canvas.height=h;
        canvas.getContext("2d").drawImage(sources[source],x,y,w,h,0,0,w,h);
        columns[column].append(canvas);
      }
      // Crops refer to the committed Edge captures. Keep the full originals next to the comparison.
      if (desktop) {
        crop(0,0,341,488,756,258);
        crop(1,0,341,387,1012,258);
        crop(2,1,176,screen === "detail" ? 578 : 155,1088,screen === "detail" ? 545 : 745);
      } else {
        crop(0,0,21,350,338,144);
        crop(1,0,21,293,348,258);
        crop(2,1,16,screen === "detail" ? 668 : 125,358,screen === "detail" ? 1010 : 1020);
      }
      crop(3,2,0,0,sources[3].width,sources[3].height);
    },{images,desktop,screen});
    await page.locator("main").screenshot({path:fileURLToPath(new URL("comparison-"+screen+suffix,directory))});
    await page.close();
  }
} finally { await browser.close(); }
