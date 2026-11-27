import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import "./fixture.js";
import {mockPage} from "../../../web/qa/fixtures.mjs";

const dir=fileURLToPath(new URL(".",import.meta.url));
const web=resolve(dir,"../../../web");
const require=createRequire(join(web,"package.json"));
const { chromium }=require("playwright");
const { createServer }=await import(pathToFileURL(require.resolve("vite")).href);
const {records,snapshotEnd,featureNames}=globalThis.dashboardFixture;
const origin="http://127.0.0.1:4186";
const server=await createServer({root:web,server:{host:"127.0.0.1",port:4186,strictPort:true,hmr:false},
  define:{"import.meta.env.VITE_SUPABASE_URL":JSON.stringify("https://example.supabase.co"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY":JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL":JSON.stringify("https://ingest.ship-and-ping.invalid")}});
const local=(path)=>pathToFileURL(join(dir,path)).href;
async function baseline(page) {
  await page.clock.setFixedTime(new Date(snapshotEnd));
  await mockPage(page,"failure",true,origin);
  await page.route("file://**/*",route=>route.continue());
  await page.route("https://example.supabase.co/rest/v1/**",async route=>{
    const url=new URL(route.request().url());
    const name=url.pathname.split("/").pop();
    const incident={id:"incident",feature_id:"other",kind:"failure",status:"open",opened_version:"1.0",opened_at:"2026-11-27T05:20:00Z",closed_at:null,metric_at_open:{total:50,failures:30},notifications:[]};
    const data={
      apps:route.request().headers().accept?.includes("vnd.pgrst.object")?{id:"demo",name:"트루바"}:[{id:"demo",name:"트루바"}],
      features:Object.entries(featureNames).map(([id,name])=>({id,name,kind:"auto",method:"GET",route:null,hidden:false,slow_threshold_ms:5000,baselines:null})),
      incidents:[incident],app_versions:[{version:"1.0",first_seen_at:"2026-11-21T00:00:00Z",last_seen_at:"2026-11-27T08:10:00Z"}],
      stats_5m:records.filter(r=>name==="stats_5m"&&(!url.searchParams.has("feature_id")||url.searchParams.get("feature_id")==="eq."+r.feature)&&r.at>=Date.parse(url.searchParams.get("bucket").slice(4))).map(r=>{
        const bounds=[0.05,0.1,0.2,0.3,0.5,0.75,1,1.5,2,3,5,7.5,10,20,30,Infinity];
        return {feature_id:r.feature,version:"1.0",bucket:new Date(r.at).toISOString(),total:r.success+r.fail,failures:r.fail,hist:bounds.map(v=>v===r.seconds?r.success:0)};
      })
    };
    return Object.hasOwn(data,name)?route.fulfill({json:data[name],headers:{"content-range":"*/1"}}):route.fallback();
  });
}
function contrast(a,b) {
  const l=hex=>{const full=hex.length===4?hex.replace(/[0-9a-f]/gi,v=>v+v):hex;
    const rgb=full.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
  const values=[l(a),l(b)].sort((x,y)=>y-x);return (values[0]+0.05)/(values[1]+0.05);
}
let browser;
try {
  await mkdir(join(dir,"before"),{recursive:true});
  await server.listen();
  browser=await chromium.launch({channel:"msedge"});
  for(const width of [1440,390])for(const theme of ["light","dark"]){
    const page=await browser.newPage({viewport:{width,height:width===390?844:900},colorScheme:theme,locale:"ko-KR",timezoneId:"Asia/Seoul",reducedMotion:"reduce"});
    page.setDefaultTimeout(10000);
    try {
      await baseline(page);
      for(const screen of ["home","feature","issue","alerts"]){
        const file=screen+"-"+width+"-"+theme+".png";
        const routes={home:"",feature:"/features/other",issue:"/issues/incident",alerts:"/notifications"};
        await page.goto(origin+"/apps/demo"+routes[screen]);
        await page.locator({feature:".chart-period",home:"#features",issue:".timeline",alerts:'[role="switch"]'}[screen]).first().waitFor();
        await page.getByRole("heading",{name:{feature:"기타",home:"트루바",issue:"기타 · 실패 문제 상세",alerts:"알림 설정"}[screen],exact:true,level:1}).waitFor();
        if(screen==="feature")await page.getByText(/72건 중 30건 실패/).waitFor();
        await page.screenshot({path:join(dir,"before",file),fullPage:width!==390,animations:"disabled"});
        if(width===390&&screen==="feature")await page.screenshot({path:join(dir,"before","expanded-390-"+theme+".png"),fullPage:true});
        for(const option of ["a","b","c"]){
          const base=local("option-"+option+"/index.html");
          await page.goto(base+"?screen="+screen+"&theme="+theme);
          await page.locator(".page-title").waitFor();
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          assert.equal(await page.locator("img").evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)),true);
          await page.screenshot({path:join(dir,"option-"+option,file),fullPage:width!==390});
          if(screen==="alerts"){
            assert.deepEqual(await page.locator(".channel h2").allTextContents(),["앱 푸시","메일","슬랙"]);
            await page.getByRole("link",{name:"예시 알림 열기"}).click();
            await page.locator(".hero .copy").waitFor();
          }
          if(screen==="issue"||screen==="alerts"){
            await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{window.copiedRequest=value;}}}));
            await page.locator(width===390?".dock .copy":".hero .copy").click();
            assert.match(await page.evaluate(()=>window.copiedRequest),/14:15~14:20에 30건/);
          }
          if(screen==="feature"){
            if(width===390){
              assert.equal(await page.locator(".fold").getAttribute("open"),null);
              await page.locator(".fold>summary").click();
              await page.evaluate(()=>window.scrollTo(0,0));
              // A tall viewport shows the whole graph without placing the fixed action across a label.
              await page.setViewportSize({width,height:await page.evaluate(()=>document.documentElement.scrollHeight)});
              await page.screenshot({path:join(dir,"option-"+option,"expanded-"+width+"-"+theme+".png"),fullPage:true});
              await page.setViewportSize({width,height:844});
            }
            const bar=page.getByRole("slider",{name:"사용과 실패 시간 구간"});
            await bar.focus();await page.keyboard.press("End");
            for(let i=0;i<3;i++)await page.keyboard.press("ArrowLeft");
            await page.getByRole("tooltip").filter({hasText:"11/27 14:00–15:00 · 성공 20건 · 실패 30건"}).waitFor();
            assert.equal(await page.locator('[data-chart=count] .grid').count(),5);
            assert.equal(await page.locator('[data-chart=time] circle').count(),6);
            await page.keyboard.press("Escape");assert.equal(await page.getByRole("tooltip").count(),0);
            await page.getByText("표로 보기",{exact:true}).click();assert.equal(await page.locator("tbody tr").count(),24);
            await page.getByRole("link",{name:"7일",exact:true}).click();
            await page.locator(".seg a[aria-current]").filter({hasText:"7일"}).waitFor({state:"attached"});
            assert.equal(await page.locator("tbody tr").count(),7);
            assert.ok(await page.locator(".fold").evaluate(el=>el.open));
            await page.getByRole("link",{name:"실패 문제 보기"}).first().click();await page.locator(".hero .copy").waitFor();
            await page.getByRole("link",{name:"기능 목록",exact:true}).first().click();await page.locator(".feature-row").first().waitFor();assert.equal(await page.locator(".feature-row").count(),3);
          }
        }
      }
      const tokens=await page.evaluate(()=>Object.fromEntries(["ink","muted","bar","fail","surface","bg","soft","accent","on","hero","hero-ink","hero-muted","ok","bad"].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue("--"+k).trim()])));
      const pairs=[["ink","surface",4.5],["muted","bg",4.5],["muted","surface",4.5],["muted","soft",4.5],["accent","on",4.5],["hero-ink","hero",4.5],["hero-muted","hero",4.5],["bar","surface",3],["fail","surface",3],["ok","surface",3],["bad","surface",3]];
      for(const [a,b,min] of pairs){const ratio=contrast(tokens[a],tokens[b]);assert.ok(ratio>=min);if(width===1440)console.log(theme,a,b,ratio.toFixed(2));}
      await page.goto(local("index.html"));
      await page.locator("#width").selectOption(String(width));
      await page.locator("#theme").selectOption(theme);
      for(const option of ["a","b","c"])for(const screen of ["home","feature","expanded","issue","alerts"]){
        await page.locator("#option").selectOption(option);await page.locator("#screen").selectOption(screen);
        await page.waitForFunction(()=>[...document.querySelectorAll(".pair img")].every(i=>i.complete&&i.naturalWidth>0));
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      console.log(width,theme,"screens, interactions and comparison passed");
    }finally{await page.close();}
  }
  // Contact sheets live outside the deliverables and make a side-by-side visual pass repeatable.
  for(const width of [1440,390])for(const screen of ["home","feature","issue","alerts",...(width===390?["expanded"]:[])]){
    const sheet=await browser.newPage({viewport:{width:1440,height:960}});
    await sheet.goto(local("index.html"));
    const imgs=["light","dark"].flatMap(theme=>["before","option-a","option-b","option-c"].map(folder=>({folder,theme,url:local(folder+"/"+screen+"-"+width+"-"+theme+".png")})));
    await sheet.evaluate(images=>{document.body.innerHTML='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">'+images.map(i=>'<div><b>'+i.folder+' '+i.theme+'</b><img style="width:100%;display:block" src="'+i.url+'"></div>').join("")+"</div>";},imgs);
    await sheet.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
    await sheet.screenshot({path:join(tmpdir(),"T42-"+screen+"-"+width+".png"),fullPage:true});await sheet.close();
  }
}finally{await browser?.close();await server.close();}
