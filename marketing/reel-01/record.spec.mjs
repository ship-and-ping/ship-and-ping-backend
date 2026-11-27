import { test, expect } from "playwright/test";
import { readFile } from "node:fs/promises";
import { origin, prepareDemo } from "./demo.mjs";
import { cameraFor, prepareDirs, run, take } from "./capture-utils.mjs";
import { assemble } from "./film.mjs";

test("record the four-line mobile prompt excerpt", async ({browser}) => {
  await prepareDirs();
  const context = await browser.newContext({
    viewport: {width:312,height:820}, deviceScaleFactor:3, locale:"ko-KR",
    timezoneId:"Asia/Seoul", colorScheme:"light", serviceWorkers:"block"
  });
  try {
    const page = await context.newPage();
    await prepareDemo(page,{value:"slow"});
    await page.goto(origin+"/apps/demo/issues/example",{waitUntil:"networkidle"});
    await page.getByText("보낼 내용 미리 보기",{exact:true}).click();
    await page.evaluate(()=>document.fonts.ready);
    const preview = page.locator(".issue-actions details[open] pre").first();
    await preview.evaluate(el=>el.scrollIntoView({block:"start",behavior:"instant"}));
    const excerpt = await preview.evaluate(el=>{
      const node=el.firstChild, rows=[];
      for(let i=0;i<node.length;i++){
        const range=document.createRange();
        range.setStart(node,i);range.setEnd(node,i+1);
        const box=range.getBoundingClientRect();
        if(!box.width)continue;
        if(!rows.length || Math.abs(rows.at(-1).top-box.top)>1){
          if(rows.length===4)break;
          rows.push({top:box.top,bottom:box.bottom,text:""});
        }
        rows.at(-1).text+=node.data[i];
      }
      const rect=el.getBoundingClientRect();
      const x=Math.floor(rect.left)-4,y=Math.max(0,Math.floor(rows[0].top)-4);
      const even=n=>2*Math.ceil(n/2);
      return {clip:{x,y,width:even(rect.width+8),height:even(rows.at(-1).bottom+4-y)},
        font:parseFloat(getComputedStyle(el).fontSize),lines:rows.map(row=>row.text)};
    });
    expect(excerpt.lines[0]).toBe("[쉽앤핑 문제 보고]");
    expect(excerpt.lines[1]).toContain("상태: 문제를 감지했어요");
    expect(excerpt.lines.join(" ")).not.toMatch(/(?:sp_(?:pub|sec)|sb_secret|Bearer|https?:\/\/|[a-f0-9]{24,})/i);
    expect(excerpt.font*582/excerpt.clip.width).toBeGreaterThanOrEqual(32);
    for(let frame=0;frame<12;frame++){
      await page.screenshot({clip:excerpt.clip,scale:"device",path:"raw/mobile-"+String(frame).padStart(2,"0")+".png"});
    }
    await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-framerate","30","-i","raw/mobile-%02d.png",
      "-frames:v","12","-an","-c:v","libx264","-crf","10","-pix_fmt","yuv420p","raw/preview-mobile.mp4"]);
    console.log("Mobile prompt excerpt",JSON.stringify(excerpt));
  } finally {
    await context.close();
  }
});

test("record the local React application", async ({page}) => {
  await prepareDirs();
  const phase = {value:"waiting"};
  await prepareDemo(page,phase);
  page.on("pageerror",error=>console.error("Page:",error.message));
  const go = async path => {
    await page.goto(origin+path,{waitUntil:"networkidle"});
    await page.evaluate(()=>document.fonts.ready);
  };
  const button = name => page.getByRole("button",{name,exact:true});
  const center = locator => locator.evaluate(el=>el.scrollIntoView({behavior:"instant",block:"center"}));
  await go("/apps/demo/connect");
  await button("수집 키 재발급").click({timeout:12000});
  const copy = page.getByRole("button",{name:"연결 요청문 복사(키 포함)",exact:true});
  await center(copy);
  await take(page,"connect",43,await cameraFor(copy,250,-16,-4,55),async frame=>{
    if(frame===13) await copy.hover();
    if(frame===22) { await copy.click(); await expect(button("복사했어요")).toBeVisible(); }
  });
  const text = await page.evaluate(()=>navigator.clipboard.readText());
  expect(text).toContain("[쉽앤핑 연결 요청]");
  const chat = await page.context().newPage();
  await chat.setContent(await readFile("neutral.html","utf8"));
  const area = chat.getByRole("textbox");
  await area.focus();
  await take(chat,"paste",44,await cameraFor(chat.locator("main"),538,-12,-36),async frame=>{
    if(frame===10){
      await area.press("Control+v");
      await expect(area).toHaveValue(text.replaceAll("\r\n","\n"));
      // The neutral input's display masks the synthetic key and shows the start of the pasted request.
      await area.evaluate(el=>{el.value=el.value.replace(/sp_pub_[0-9a-f]{64}/g,"[데모 키]");el.setSelectionRange(0,0);el.scrollTop=0;});
    }
  });
  await chat.close();
  phase.value="arrived";
  await go("/apps/demo/connect");
  const hero = page.locator(".hero-card");
  await expect(hero).toContainText("기록이 도착했어요");
  await take(page,"arrival",48,await cameraFor(hero,465,14,24,116,"0x261b40"));
  phase.value="slow";
  await go("/apps/demo");
  await expect(hero).toContainText("분석이 느려졌어요");
  await expect(hero).toContainText("평소 1.1초 → 최근 30분 3.4초");
  await take(page,"alert",123,await cameraFor(hero,472,14,18,160,"0x261b40"));
  await page.locator("#issues").getByRole("link",{name:/분석이 느려졌어요/}).click();
  await expect(page.getByRole("heading",{name:"분석 · 느림 문제 상세"})).toBeVisible();
  const send=button("AI에 보낼 내용 복사"), preview=page.getByText("보낼 내용 미리 보기",{exact:true});
  await center(send);
  await take(page,"copy",62,await cameraFor(preview,425,-12,-11,128),async frame=>{
    if(frame===12) await send.hover();
    if(frame===24) { await send.click(); await expect(button("복사했어요")).toBeVisible(); }
  });
  await preview.click();
  const pre=page.locator(".issue-actions details[open] pre").first();
  await expect(pre).toBeVisible();
  await center(preview);
  await take(page,"preview",67,await cameraFor(preview,550,-11,-10,189));
  phase.value="updated";
  await go("/apps/demo/issues/example");
  const timeline=page.locator(".timeline");
  await expect(timeline).toContainText("새 버전 감지");
  await center(timeline);
  await take(page,"update",49,await cameraFor(timeline,342,-15,-48,177,"0xfaf9fc"));
  phase.value="resolved";
  await go("/apps/demo/issues/example");
  await expect(timeline).toContainText("해결됐어요");
  await center(timeline);
  await take(page,"resolved",71,await cameraFor(timeline,342,-15,67,139,"0xfaf9fc"));
  await assemble();
});
