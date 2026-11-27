import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const {chromium}=createRequire(new URL("../../../web/package.json",import.meta.url))("playwright");
const browser=await chromium.launch({channel:"msedge"});
try{
  for(const [option,ref,label,title] of [
    ["a","plausible","Plausible · 공개 데모","A · 앱 사용 흐름"],
    ["b","toss-app","토스피드 · 공개 송금 화면","B · 상태 요약"],
    ["c","posthog-product","PostHog · 제품 분석","C · 양의 관찰 기록"]
  ]){
    for(const width of [1440,390]){
      const height=width===390?844:900;
      const page=await browser.newPage({viewport:{width:width*2+36,height:height+85},deviceScaleFactor:1});
      await page.goto(new URL("./index.html",import.meta.url).href);
      const panels=[
        {title:label,src:"refs/"+ref+"-"+width+".png"},
        {title,src:"option-"+option+"/home-"+width+"-light.png"}
      ];
      await page.evaluate(({panels,width,height})=>{
        document.body.replaceChildren();
        document.body.style.cssText="background:#f1eef6;display:flex;padding:12px;gap:12px";
        for(const panel of panels){
          const box=document.createElement("section");
          const head=document.createElement("h2");head.style.cssText="height:48px;font:700 20px/48px Malgun Gothic,sans-serif";head.textContent=panel.title+" · "+width+"px";
          const image=document.createElement("img");image.src=panel.src;image.alt=panel.title;
          image.style.cssText="display:block;object-fit:cover;object-position:top;width:"+width+"px;height:"+height+"px";
          box.append(head,image);document.body.append(box);
        }
      },{panels,width,height});
      await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
      await page.screenshot({path:fileURLToPath(new URL("./option-"+option+"/reference-"+width+".png",import.meta.url))});
      await page.close();
    }
  }
}finally{await browser.close();}
