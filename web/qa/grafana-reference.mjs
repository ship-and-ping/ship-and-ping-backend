import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const output = new URL("../../docs/design/qa/demo-insights/refs/", import.meta.url);
await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
try {
  for (const [kind, path] of [["series","000000016/time-series-graphs"],["stat","Zb3f4veGk/stats"]]) {
    for (const width of [1440,390]) for (const theme of ["dark","light"]) {
      const page = await browser.newPage({viewport:{width,height:width === 390 ? 844 : 900},colorScheme:theme});
      await page.goto("https://play.grafana.org/d/" + path + "?theme=" + theme, {waitUntil:"domcontentloaded",timeout:90000});
      const surface = page.locator(kind === "series" ? '[data-testid="timeseries-panel-1"]' : '[data-testid^="stat-panel-"]').first();
      await surface.waitFor({timeout:90000});
      await surface.evaluate(el => el.scrollIntoView({block:"center"}));
      if (kind === "series") {
        const chart = surface.locator(".u-over").first();
        await chart.waitFor({timeout:60000});
        await chart.hover();
      } else {
        await surface.getByText(/\d/).first().waitFor();
      }
      await page.evaluate(() => document.fonts.ready);
      console.log(kind,width,theme,await surface.evaluate(el => {
        const title = el.querySelector("h2,h3");
        const header = title?.parentElement;
        const plot = el.querySelector(".u-over");
        const axis = el.querySelector(".u-axis");
        const cursor = el.querySelector(".u-cursor-x");
        const tip = document.querySelector('[role="tooltip"], [data-testid*="VizTooltip"], [data-testid*="tooltip" i]');
        const box = element => element && [element.clientWidth,element.clientHeight];
        const grid = Array.from(document.querySelectorAll(".react-grid-item")).slice(0,3).map(el => {
          const {x,y,width,height} = el.getBoundingClientRect();
          return [x,y,width,height];
        });
        const ancestors = [];
        for(let node=title; node && ancestors.length<8; node=node.parentElement) {
          const s=getComputedStyle(node);
          ancestors.push([node.tagName,node.clientHeight,s.borderRadius,s.fontSize,s.backgroundColor]);
        }
        return {ancestors,header:box(header),plot:box(plot),axis:box(axis),
          cursor:cursor && getComputedStyle(cursor).borderLeft,tooltip:box(tip),grid,
          axes:[...el.querySelectorAll(".u-axis")].map(box),cursorStyle:cursor && [getComputedStyle(cursor).width,getComputedStyle(cursor).borderRight,getComputedStyle(cursor).backgroundImage]};
      }));
      await page.screenshot({path:fileURLToPath(new URL(kind+"-"+width+"-"+theme+".png",output))});
      await page.close();
    }
  }
} finally {
  await browser.close();
}
