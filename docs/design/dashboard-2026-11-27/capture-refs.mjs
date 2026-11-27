import {mkdir,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const {chromium}=createRequire(new URL("../../../web/package.json",import.meta.url))("playwright");
const dir=fileURLToPath(new URL("./refs/",import.meta.url));
await mkdir(dir,{recursive:true});
const sources=[
  ["plausible","https://plausible.io/plausible.io"],
  ["toss","https://toss.im"],
  ["toss-app","https://toss.im/tossfeed/article/toss-darkmode"],
  ["posthog","https://posthog.com/"],
  ["posthog-product","https://posthog.com/product-analytics"]
];
const browser=await chromium.launch({channel:"msedge"});
async function capture([id,url],width){
  const page=await browser.newPage({viewport:{width,height:width===390?844:900},locale:"ko-KR",colorScheme:"light",deviceScaleFactor:1});
  try{
    const response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:45000});
    if(!response?.ok())throw Error(id+" HTTP "+response?.status());
    if(id==="plausible"){
      await page.getByText("Unique visitors",{exact:true}).first().waitFor();
      await page.waitForFunction(()=>[...document.querySelectorAll("svg path")].some(el=>
        el.getBoundingClientRect().width>200&&getComputedStyle(el).strokeWidth==="2px"&&getComputedStyle(el).stroke!=="none"));
    }
    if(id==="posthog-product")await page.getByRole("heading",{level:1}).last().waitFor({timeout:30000});
    await page.waitForTimeout(3000);
    if(id==="toss-app"){
      const anchor=page.locator('img[src*="17c4f21c"]').first();
      await anchor.scrollIntoViewIfNeeded();
      await anchor.evaluate(el=>el.scrollIntoView({block:"center"}));
      await page.waitForFunction(()=>[...document.images].some(i=>i.src.includes("17c4f21c")&&i.complete&&i.naturalWidth>0));
    }
    await page.screenshot({path:join(dir,id+"-"+width+".png"),timeout:25000});
    const sampled=await page.evaluate(()=>{
      const visible=el=>{const r=el.getBoundingClientRect();return r.width>8&&r.height>8&&r.x<innerWidth&&r.right>0&&r.top<innerHeight&&r.bottom>0&&getComputedStyle(el).visibility!=="hidden";};
      const sample=el=>{
        const s=getComputedStyle(el),r=el.getBoundingClientRect();
        return {tag:el.tagName.toLowerCase(),label:(el.getAttribute("alt")||el.innerText||"").trim().replace(/\s+/g," ").slice(0,28),x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),font:s.fontSize,line:s.lineHeight,weight:s.fontWeight,padding:s.padding,gap:s.gap,radius:s.borderRadius,shadow:s.boxShadow};
      };
      const nodes=[...document.querySelectorAll("body *")].filter(visible);
      const strokes=[...document.querySelectorAll("svg line,svg path")].filter(e=>{const box=e.getBoundingClientRect();return box.width>60&&box.y>0&&box.y<innerHeight;});
      return {lines:strokes.slice(0,15).map(e=>({tag:e.tagName,y:e.getBoundingClientRect().y,stroke:getComputedStyle(e).stroke,weight:getComputedStyle(e).strokeWidth,dash:getComputedStyle(e).strokeDasharray})),headings:nodes.filter(e=>e.matches("h1,h2,h3")).slice(0,5).map(sample),
        text:nodes.filter(e=>e.childElementCount===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)>=18).slice(0,12).map(sample),
        panels:nodes.filter(e=>e.clientWidth>75&&e.clientHeight>30&&parseFloat(getComputedStyle(e).borderRadius)>1).slice(0,15).map(sample),
        images:nodes.filter(e=>e.matches("img,video,canvas")).slice(0,10).map(sample)};
    });
    return {id,url:page.url(),width,sampled};
  }finally{await page.close();}
}
try{
  const selected=process.argv.slice(2);
  const results=await Promise.allSettled(sources.filter(([id])=>!selected.length||selected.includes(id)).map(async source=>{
    for(const width of [1440,390]){
      const result=await capture(source,width);
      await writeFile(join(dir,source[0]+"-"+width+".json"),JSON.stringify(result,null,2)+"\n");
      console.log(source[0],width,"captured");
    }
  }));
  for(const r of results)if(r.status==="rejected"){console.error(r.reason.message);process.exitCode=1;}
}finally{await browser.close();}
