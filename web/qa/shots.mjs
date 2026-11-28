import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";
import { exampleEmail, mockPage, now } from "./fixtures.mjs";

const phase = process.argv[2] ?? "screens";
const require = createRequire(import.meta.url);
const patterns = ["patterns-before", "patterns-after"].includes(phase);
const chart = ["chart-before", "chart-after"].includes(phase);
if (!patterns && !chart && !["screens", "before", "after","qa3-before","qa3-after"].includes(phase)) throw Error("Unknown QA phase");
const qa3 = phase.startsWith("qa3-");
const gallery = phase === "screens";
const dir = gallery ? resolve("../docs/design/screens") : resolve("../docs/design/qa", phase);
await mkdir(dir, { recursive: true });
const cases = [
  ["소개","/","normal",".intro"], ["로그인","/login","normal","input"],
  ["내 앱","/apps","normal",".app-card"], ["빈 앱 목록","/apps","empty",".hero-card"],
  ["앱 등록","/apps/new","normal","#app-name"], ["연결 대기","/apps/demo/connect","waiting",".hero-card"],
  ["앱 홈","/apps/demo","normal",".monitor"], ["첫 기록 대기","/apps/demo","waiting",".monitor"],
  ["문제 있는 홈","/apps/demo","failure",".monitor"], ["기능 상세","/apps/demo/features/apply","normal",".monitor"],
  ...["failure","slow","unconfirmed","resolved"].map(state => ["문제 상세","/apps/demo/issues/example",state,".monitor"]),
  ["깊게 보기","/apps/demo/features/deep/new","normal","#deep-name"],
  ["알림 설정","/apps/demo/notifications","normal","[role=switch]"],
  ["알림 목록 불러오기","/apps/notifications","loading","main h1"],
  ["알림 목록 오류","/apps/notifications","error","[role=alert]"],
  ["기록 로딩","/apps/demo","loading",".monitor-loading"], ["기록 오류","/apps/demo","error","[role=alert]"],
  ["앱 설정","/apps/demo/settings","normal",".settings-sections"], ["내 계정","/account","normal",".sp-kv"],
  ["회원 가입","/signup","normal","input[name=confirm]"],
  ["새 비밀번호","/reset-password#type=recovery&access_token=qa-local-only&refresh_token=qa-local-only&expires_in=3600&token_type=bearer","normal","input[name=confirm]"],
  ["비밀번호 찾기","/forgot-password","normal","input[type=email]"],
  ["PC 로그인 승인","/login/approve?req=qa-request&proof=fixture","approval","input[inputmode=numeric]"],
];
// Keep the original D6 indices stable for before/after comparisons.
const flow = [
  [0,"서비스 소개"],
  [1,"로그인"],
  [1,"메일 링크 로그인","mail"],
  [22,"회원 가입"],
  [24,"비밀번호 찾기"],
  [23,"새 비밀번호"],
  [3,"앱이 없을 때"],
  [2,"내 앱"],
  [4,"앱 등록"],
  [5,"앱 연결"],
  [7,"첫 기록 대기"],
  [6,"앱 홈"],
  [9,"기능 상세"],
  [8,"문제가 생긴 앱"],
  [10,"실패 문제"],
  [11,"느림 문제"],
  [12,"결과 미확인"],
  [13,"해결된 문제"],
  [18,"기록 불러오기"],
  [19,"기록 조회 실패"],
  [14,"깊게 보기"],
  [16,"알림 불러오기"],
  [17,"알림 조회 실패"],
  [15,"알림 설정"],
  [20,"앱 설정"],
  [21,"내 계정"],
  [21,"비밀번호 변경 본인 확인","reauth"],
  [21,"탈퇴 확인","confirm"],
  [21,"탈퇴 진행","deleting"],
  [21,"탈퇴 실패","failed"],
  [21,"탈퇴 완료","done"],
  [25,"휴대폰에서 PC 로그인 승인"],
  [1,"PC 요청 만료","expired"], [1,"PC 요청 거절","denied"],
  [25,"휴대폰 승인 완료","approval-ok"], [25,"휴대폰 거절 완료","approval-deny"],
  [5,"키가 든 연결 요청문","prompt"], [5,"복사 실패 후 가린 요청문","masked"],
  [20,"새 키로 교체","replacement"], [15,"슬랙 미설정","unconfigured"],
  [25,"휴대폰 확인 숫자 불일치","approval-mismatch"],
].map(([index,title,variant]) => {
  const [,path,state,ready] = cases[index];
  return [title,path,variant ?? state,ready];
});
const profiles = chart ? [[1440,"light",1,false],[390,"light",1,true]] : qa3 ? [[1440,"light",1,false],[1440,"dark",1,false],[390,"light",1,false],[390,"dark",1,true]] : gallery ? [[1440,"light",1,false],[390,"light",1,false]] : [
  [1440,"light",1,false], [1280,"dark",1,false], [390,"light",1,false], [390,"dark",2,true],
];
const selected = process.argv.slice(3);
const chartScenes = ["many","few","cluster","scrolled"].map(state =>
  [state === "scrolled" ? "아래로 내린 회원 메뉴" : "사용 흐름", "/apps/demo/features/apply", state, ".chart-period"]);
const scenes = chart ? chartScenes : patterns ? [...cases,
  ["내 앱 불러오기","/apps","loading","main h1"],
  ["이메일 알림 저장","/apps/demo/notifications","email-saving","[role=switch]"],
] : gallery || qa3 ? flow : cases;
if (selected.some(id => !scenes[Number(id)] || String(Number(id)) !== id)) throw Error("Unknown screen index");
const server = await createServer({server:{host:"127.0.0.1",port:4179,strictPort:true,hmr:false},
  define: { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid") }});
let browser;
try {
  await server.listen();
  browser = process.platform === "win32" ? await chromium.launch({channel:"msedge"})
    : existsSync(webkit.executablePath()) ? await webkit.launch() : await chromium.launch({channel:"chrome"});
  const origin = "http://127.0.0.1:4179";
  const entries = [];
  for (const [width,colorScheme,scale,reduced] of profiles) {
    for (const [index,[title,path,state,ready]] of scenes.entries()) {
      if (selected.length && !selected.includes(String(index))) continue;
      const page = await browser.newPage({ viewport:{width,height:width===390?844:900}, colorScheme,
        hasTouch: phase === "chart-after" && width === 390,
        reducedMotion: reduced ? "reduce" : "no-preference", locale:"ko-KR",timezoneId:"Asia/Seoul", serviceWorkers:"block" });
      try {
        await page.clock.setFixedTime(new Date(now));
        await mockPage(page,state,path.startsWith("/apps") || path==="/account" || state.startsWith("approval"),origin);
        await page.goto(origin+path,{waitUntil:"domcontentloaded"});
        await page.locator(ready).first().waitFor({timeout:12000});
        if (gallery || qa3) await prepareScene(page,state);
        if (state === "email-saving") {
          const toggle = page.getByRole("switch");
          await tabTo(page,toggle);
          await page.keyboard.press("Space");
          await page.waitForSelector('[role=switch]:disabled');
          if (phase === "patterns-after") {
            await page.getByRole("status").filter({hasText:"이메일 알림 설정을 저장하는 중이에요."}).waitFor();
            if (await toggle.getAttribute("aria-checked") !== "true") throw Error("Unconfirmed email setting");
          }
        }
        if (phase === "qa3-after" && state === "approval") {
          const field = page.getByRole("textbox");
          await tabTo(page,field);
          await page.keyboard.type("07");
          await tabTo(page,page.getByRole("button",{name:"이 PC 로그인 승인"}));
          await tabTo(page,page.getByRole("button",{name:"거절",exact:true}));
          await field.fill("");
          await field.blur();
        }
        if (scale===2) await page.addStyleTag({content:"html { font-size: 200% !important }"});
        if (phase === "after" && width === 390 && path === "/account") {
          const header = page.locator(".compact");
          if (await header.locator('a[aria-label="내 계정"]').isVisible() !== (scale === 1))
            throw Error("Account icon visibility at " + scale * 100 + "%");
          await header.getByRole("button",{name:"메뉴"}).waitFor();
        }
        await page.evaluate(()=>window.scrollTo(0,0));
        if (phase === "after" && path === "/") {
          const example = page.getByRole("region", {name:"예시 화면", exact:true});
          await example.getByRole("button", {name:"문제 상세", exact:true}).click();
          await example.getByRole("heading", {name:"모임 신청 20건 중 6건 실패"}).waitFor();
          await example.getByRole("button", {name:"앱 홈", exact:true}).click();
          await page.evaluate(()=>window.scrollTo(0,0));
        }
        if (phase === "after" && path.endsWith("/issues/example") && state === "failure") {
          await page.getByRole("heading", {name:"모임 신청 20건 중 6건 실패"}).waitFor();
          const title = page.getByRole("heading", {level:1,name:"모임 신청 · 실패 문제 상세"});
          if (!await title.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle === "none"))
            throw Error("Issue heading focus");
          if (!await page.getByRole("button", {name:"문제 아님으로 닫기"}).evaluate(el => el.classList.contains("secondary")))
            throw Error("Dismiss action hierarchy");
        }
        const overflow = await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
        if (phase === "chart-after" && overflow > 0) throw Error("Chart overflow at " + width);
        if (phase === "chart-after") {
          const hero = page.locator(".hero-card");
          const contained = await hero.evaluate(card => {
            const frame = card.getBoundingClientRect();
            const sheep = card.querySelector(".sheep").getBoundingClientRect();
            return sheep.top >= frame.top && sheep.bottom <= frame.bottom && sheep.right <= frame.right;
          });
          if (!contained) throw Error("Feature summary clips its sheep");
          const usage = page.getByRole("figure", {name:"사용과 실패"});
          const mark = usage.getByRole("slider");
          await tabTo(page, mark);
          await usage.getByRole("tooltip").waitFor();
          if (width === 390 && state === "cluster") await checkMixedChartInput(page, usage, mark);
          if (width === 390 && state === "scrolled") {
            const duration = page.getByRole("figure", {name:"걸린 시간"});
            const label = await duration.locator(".isolated-value").boundingBox();
            const dot = await duration.locator("circle").boundingBox();
            const gap = dot.x - (label.x + label.width);
            if (gap < 0 || gap > 6 || Math.abs(label.y + label.height / 2 - dot.y - dot.height / 2) > 2)
              throw Error("Single measurement label is detached from the last point");
            if (await duration.locator(".isolated-value").evaluate(el => {
              const text = document.createRange();
              text.selectNodeContents(el);
              return text.getClientRects().length !== 1;
            })) throw Error("Single measurement label wraps");
            await duration.screenshot({path:resolve(dir,"isolated-390.jpg")});
          }
          await page.keyboard.press("Escape");
          await usage.getByRole("tooltip").waitFor({state:"hidden"});
          await mark.evaluate(el => el.blur());
          await page.getByRole("button", {name:"7일",exact:true}).click();
          await page.getByText("표로 보기", {exact:true}).click();
          if (await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth))
            throw Error("Seven-day chart table overflow");
          await page.getByText("표로 보기", {exact:true}).click();
          await page.getByRole("button", {name:"24시간",exact:true}).click();
          await page.getByRole("button", {name:"24시간",exact:true}).evaluate(el=>el.blur());
          await page.mouse.move(0,0);
          await page.evaluate(()=>window.scrollTo(0,0));
        }
        if ((gallery || phase === "after" || qa3) && scale === 1 && (gallery || width === 390)) {
          const endings = await page.evaluate(shortKoreanEndings);
          if (endings.length) console.warn("Short last lines", index, endings);
        }
        const issues = [];
        if (phase.endsWith("after")) {
          await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
          const violations = await page.evaluate(async () => (await window.axe.run(document, {
            runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]},
          })).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
          issues.push(...violations);
        }
        if (phase.endsWith("after") && reduced && await page.evaluate(()=>document.getAnimations().length))
          throw Error("Reduced-motion animation on "+path);
        const file = gallery ? String(index+1).padStart(2,"0")+"-"+width+".jpg"
          : String(index).padStart(2,"0")+"-"+state+"-"+width+"-"+colorScheme+".jpg";
        const capture = phase === "patterns-after" ? existsSync(resolve(dir,"../patterns-before",file))
          : phase !== "qa3-after" || state === "approval-mismatch" || existsSync(resolve(dir,"../qa3-before",file));
        if (state === "scrolled") await checkScrolledMenu(page, phase === "chart-after");
        if (capture) {
          const bytes = await page.screenshot({path:resolve(dir,file),type:"jpeg",quality:80,fullPage:state !== "scrolled",animations:"disabled"});
          if (gallery && bytes.length > 500000) throw Error(file+" exceeds 500 KB");
        }
        const smallTargets = qa3 && width === 390 ? await page.locator("main :is(button,summary,input:not([type=checkbox]),select,a)").evaluateAll(nodes =>
          nodes.filter(el=>el.checkVisibility()).filter(el=>{
            const rect = el.getBoundingClientRect();
            return rect.height < 44 || rect.width < 44;
          }).map(el=>el.getAttribute("aria-label") || el.textContent.trim() || el.name)) : [];
        entries.push({title,state,width,colorScheme,scale,reduced,file,overflow,issues,...(patterns ? {capture} : {}),...(qa3 ? {capture,smallTargets} : {})});
        if (phase === "patterns-after" && path === "/") {
          const item = page.locator(".product-example .issue-list-item button");
          await tabTo(page,item);
          await page.keyboard.press("Enter");
          const detail = page.getByRole("button",{name:"문제 상세",exact:true});
          await page.getByRole("heading",{name:"모임 신청 20건 중 6건 실패"}).waitFor();
          if (!await detail.evaluate(el=>el===document.activeElement && el.getAttribute("aria-pressed")==="true"))
            throw Error("Example detail lost keyboard focus");
        }
        if (state === "approval-mismatch") {
          await page.reload();
          await page.getByRole("status").filter({hasText:"이미 처리한 요청이에요."}).waitFor();
        }
        if (overflow>1) console.warn("Overflow",file,overflow);
        if (phase === "after" && state === "failure" && path === "/apps/demo") {
          const link = page.locator("#issues a").first();
          await tabTo(page,link);
          await page.keyboard.press("Enter");
          const copy = page.getByRole("button",{name:"AI에 보낼 내용 복사",exact:true});
          await tabTo(page,copy);
          await page.keyboard.press("Enter");
          await page.getByRole("button",{name:"복사했어요",exact:true}).waitFor();
        }
      } finally { await page.close(); }
    }
  }
  if (phase === "after" && (!selected.length || selected.includes("0"))) {
    const motionDir = resolve(dir, "../motion");
    const page = await browser.newPage({viewport:{width: 980, height: 720},
      recordVideo:{dir:motionDir,size:{width: 800,height: 588}}, reducedMotion:"no-preference",
      locale:"ko-KR",timezoneId:"Asia/Seoul",serviceWorkers:"block"});
    const video = page.video();
    try {
      await mockPage(page, "normal", false, origin);
      await page.goto(origin);
      await page.locator(".intro h1").waitFor();
      await page.waitForTimeout(850);
      for (const selector of [".review-story", ".answers", ".product-example", ".alert-examples", ".section-heading[data-mood]"]) {
        await page.locator(selector).evaluate(el => el.scrollIntoView({behavior:"smooth",block:"center"}));
        await page.waitForTimeout(1100);
        if (selector === ".product-example") {
          await page.getByRole("button",{name:"문제 상세",exact:true}).click();
          await page.waitForTimeout(650);
        }
      }
    } finally { await page.close(); }
    await video.saveAs(resolve(motionDir, "landing.webm"));
    await video.delete();
  }
  if (!gallery) {
    const resultsPath = resolve(dir,"results.json");
    const results = selected.length && existsSync(resultsPath)
      ? [...JSON.parse(await readFile(resultsPath,"utf8")).filter(old => !entries.some(entry => entry.file === old.file)), ...entries]
      : entries;
    await writeFile(resultsPath,JSON.stringify(results,null,2)+"\n");
  }
  console.log(entries.length+" views checked, "+entries.filter(entry=>entry.capture !== false).length+" screenshots in "+dir);
  if (phase === "qa3-after" && entries.some(entry=>entry.smallTargets.length))
    throw Error("Review targets smaller than 44px in results.json");
  if (phase.endsWith("after") && entries.some(entry=>entry.issues.length || entry.overflow > 1))
    throw Error("Review overflow or axe findings in results.json");
} finally { await browser?.close(); await server.close(); }

async function prepareScene(page,state) {
  const button = name => page.getByRole("button",{name,exact:true});
  if (["mail","expired","denied"].includes(state)) {
    await page.locator("[name=email]").fill(exampleEmail);
    await button("비밀번호 없이 메일 링크로 받기").click();
    await page.getByText("메일을 확인해 주세요",{exact:true}).waitFor();
    if (state !== "mail") await page.getByText(state === "expired" ? /요청 시간이 지났어요/ : /휴대폰에서 거절했어요/).waitFor();
  } else if (["approval-ok","approval-deny","approval-mismatch"].includes(state)) {
    if (state !== "approval-deny") await page.getByRole("textbox").fill(state === "approval-ok" ? "07" : "70");
    await button(state === "approval-deny" ? "거절" : "이 PC 로그인 승인").click();
    if (state === "approval-ok") await page.getByRole("heading",{name:"승인했어요."}).waitFor();
    else await page.getByRole("status").filter({hasText:state === "approval-deny" ? "거절했어요" : "숫자가 맞지 않아 요청을 취소했어요"}).waitFor();
  } else if (["prompt","masked","replacement"].includes(state)) {
    page.once("dialog", dialog => dialog.accept());
    await button("수집 키 재발급").click();
    const copy = page.getByRole("button",{name:/요청문 복사\(/}).first();
    await copy.waitFor();
    if (state === "masked") {
      await page.evaluate(() => {
        Object.defineProperty(navigator,"clipboard",{value:{writeText:async()=>{throw Error("QA denied");}}});
        document.execCommand = () => false;
      });
      await copy.click();
      await button("키 포함해서 보기").waitFor();
    }
  } else if (state === "unconfigured") {
    await button("Slack에 추가").click();
    await page.getByText(/슬랙 연결이 아직 준비되지 않았어요/).waitFor();
  } else if (state === "reauth") {
    await button("비밀번호 바꾸기").click();
    for (const field of ["password","confirm"]) await page.locator('[name="'+field+'"]').fill("example-only-password");
    await button("비밀번호 저장").click();
    await page.getByText("본인 확인을 위해 메일로 보낸 번호를 적어 주세요.").waitFor();
  } else if (["confirm","deleting","failed","done"].includes(state)) {
    await button("회원 탈퇴").click();
    const email = page.getByLabel("로그인 이메일 다시 입력");
    await email.waitFor();
    if (state === "confirm") return;
    await email.fill(exampleEmail);
    await button("모든 앱과 기록을 지우고 탈퇴").click();
    const expected = {deleting:"탈퇴하는 중", failed:"탈퇴를 마치지 못했어요.", done:"탈퇴를 마쳤어요"};
    await page.getByText(expected[state],{exact:false}).first().waitFor();
  }
}

// Inspect rendered lines, including text split across inline markup.
function shortKoreanEndings() {
  const findings = [];
  for (const el of document.querySelectorAll("main :is(h1,h2,h3,p,small,label,button,summary,dd,blockquote)")) {
    if (!el.checkVisibility() || el.childElementCount && el.querySelector("input,button,p")) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const lines = new Map();
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.length; i++) {
        range.setStart(node,i);
        range.setEnd(node,i+1);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const top = Math.round(rect.bottom);
        lines.set(top,(lines.get(top) ?? "") + node.data[i]);
      }
    }
    const last = [...lines.values()].at(-1)?.trim() ?? "";
    if (lines.size > 1 && /^[가-힣]{1,2}[.!?]?$/.test(last)) findings.push(el.textContent.trim());
  }
  return findings;
}

async function checkMixedChartInput(page, figure, slider) {
  await slider.evaluate(el => el.scrollIntoView({block:"center"}));
  const box = await slider.boundingBox();
  const y = Math.round(box.y + box.height / 2);
  const x = slot => Math.round(box.x + box.width * (slot - 0.5) / 24);
  const tap = slot => page.touchscreen.tap(x(slot), y);
  const screenshot = name => page.screenshot({path:resolve(dir,name + "-390.jpg")});
  await tap(3);
  if (await slider.getAttribute("aria-valuenow") !== "3") throw Error("Touch did not select the third bucket");
  if (page.context().browser().browserType().name() === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:[{x:x(3), y}]});
    await session.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:[{x:x(21), y}]});
    await session.send("Input.dispatchTouchEvent", {type:"touchEnd", touchPoints:[]});
    await session.detach();
  } else {
    await tap(21);
  }
  if (await slider.getAttribute("aria-valuenow") !== "21") throw Error("Touch did not select the peak bucket");
  const tip = figure.getByRole("tooltip");
  await tip.filter({hasText:"실패 10건"}).waitFor();
  await screenshot("touch");
  await page.keyboard.press("ArrowLeft");
  await tip.filter({hasText:"실패 8건"}).waitFor();
  const focusedText = await tip.textContent();
  await page.mouse.move(x(21), y);
  await tip.filter({hasText:"실패 10건"}).waitFor();
  await screenshot("mouse");
  await page.mouse.move(box.x - 4, y);
  await tip.filter({hasText:focusedText}).waitFor();
  await screenshot("keyboard-restored");
}

async function tabTo(page,target) {
  await target.waitFor();
  for (let n=0;n<80;n++) {
    if (await target.evaluate(el=>el===document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw Error("Keyboard could not reach "+target);
}

async function checkScrolledMenu(page, verify) {
  const viewport = page.viewportSize();
  const rail = page.locator("#member-menu");
  await page.getByText("표로 보기", {exact:true}).click();
  await page.evaluate(() => window.scrollTo(0, 900));
  if (await page.evaluate(() => scrollY) < 800) throw Error("Missing long-page fixture");
  if (!verify) return;
  if (viewport.width === 390) {
    if (await rail.isVisible() || await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw Error("Mobile menu must stay collapsed without horizontal overflow");
    await page.evaluate(() => window.scrollTo(0, 0));
    const toggle = page.getByRole("button", {name:"메뉴", exact:true});
    await toggle.click();
    const firstLink = rail.getByRole("link", {name:"내 앱", exact:true});
    if (!await firstLink.evaluate(el => el === document.activeElement && getComputedStyle(el.closest("aside")).position === "static"))
      throw Error("Mobile menu layout or initial focus changed");
    await page.keyboard.press("Escape");
    if (!await toggle.evaluate(el => el === document.activeElement)) throw Error("Menu toggle lost focus");
  } else {
    const pinned = await rail.evaluate(el => el.getBoundingClientRect().top === 0 &&
      el.offsetHeight === innerHeight && getComputedStyle(el).position === "sticky");
    if (!pinned) throw Error("Desktop member menu scrolled off screen");
    await page.setViewportSize({width:viewport.width,height:360});
    await rail.getByRole("link", {name:"내 계정"}).focus();
    await page.keyboard.press("Tab");
    const last = rail.getByRole("button", {name:"로그아웃"});
    if (!await last.evaluate(el => el === document.activeElement && el.closest("aside").scrollTop > 0 &&
      el.getBoundingClientRect().bottom <= innerHeight && scrollY === 900))
      throw Error("Keyboard focus must scroll the short menu independently of the document");
    await last.evaluate(el => el.blur());
    await page.setViewportSize(viewport);
  }
  await page.evaluate(() => window.scrollTo(0, 900));
}
