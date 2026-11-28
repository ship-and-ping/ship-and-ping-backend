import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockPage } from "./fixtures.mjs";

// The walkthrough uses fixture mail, Auth and push responses, including the
// transition to the home screen app's separate storage. No real mail or push.
export async function recordFlow(browser, origin, directory, userAgent, mail) {
  const temp = await mkdtemp(join(tmpdir(),"t61-recording-"));
  const size = {width:390,height:844};
  const context = await browser.newContext({viewport:size,userAgent,locale:"ko-KR",recordVideo:{dir:temp,size}});
  try {
    const page = await context.newPage();
    const video = page.video();
    const email = "demo@example.invalid";
    const user = {id:"qa-member",email,created_at:"2026-11-25",app_metadata:{provider:"email"},user_metadata:{ship_ping_visited:true}};
    const session = {user,access_token:"qa-local-only",refresh_token:"qa-local-only",token_type:"bearer",expires_in:3600,expires_at:2100000000};
    await mockPage(page,"normal",false,origin);
    await page.addInitScript(session => {
      if (location.pathname === "/apps/phone") localStorage.setItem("sb-example-auth-token",JSON.stringify(session));
      Object.defineProperty(navigator,"standalone",{value:sessionStorage.getItem("qa-home")==="true"});
      let subscription;
      const endpoint = "https://web.push.apple.com/fixture";
      const registration = {active:{postMessage:(_,ports)=>ports[0].postMessage(true)},pushManager:{
        getSubscription:async()=>subscription,
        subscribe:async()=>subscription={endpoint,toJSON:()=>({endpoint,keys:{auth:"fixture",p256dh:"fixture"}})},
      }};
      Object.defineProperty(window,"Notification",{value:{permission:"default",requestPermission:async()=>"granted"}});
      Object.defineProperty(window,"PushManager",{value:class {}});
      Object.defineProperty(navigator,"serviceWorker",{value:{register:async()=>registration,getRegistration:async()=>registration,ready:Promise.resolve(registration)}});
    },session);
    await page.route("**/v1/install-mail",r=>r.fulfill({status:204}));
    await page.route("**/v1/push-config",r=>r.fulfill({json:{public_key:"BA"}}));
    await page.route("**/auth/v1/otp**",r=>r.fulfill({json:{}}));
    await page.route("**/auth/v1/verify**",r=>r.fulfill({json:session}));
    await page.route("**/rpc/register_push",r=>r.fulfill({json:"qa-device"}));
    await page.route("**/rpc/list_push_devices",r=>r.fulfill({json:[{id:"qa-device",endpoint:"https://web.push.apple.com/fixture",current_session:true}]}));
    await page.route("**/rpc/queue_test_push",r=>r.fulfill({json:true}));
    await page.route(origin+"/qa-mail",r=>r.fulfill({contentType:"text/html; charset=utf-8",body:mail.replaceAll("{{install_url}}",origin+"/install")}));
    await page.goto(origin+"/apps/phone");
    await page.getByRole("button",{name:"설치 안내 메일 받기"}).click();
    await page.getByText("가입한 이메일로 설치 안내를 보냈어요.").waitFor();
    await page.waitForTimeout(850);
    await page.goto(origin+"/qa-mail");
    await page.waitForTimeout(850);
    await page.getByRole("link",{name:"아이폰에서 열기"}).click();
    await page.getByText("1. 공유 버튼 누르기").waitFor();
    await page.waitForTimeout(1400);
    await page.evaluate(()=>{sessionStorage.setItem("qa-home","true");localStorage.removeItem("sb-example-auth-token");});
    await page.reload();
    await page.getByLabel("가입한 이메일").fill(email);
    await page.getByRole("button",{name:"6자리 코드 받기"}).click();
    await page.getByLabel("6자리 코드",{exact:true}).fill("123456");
    await page.waitForTimeout(850);
    await page.getByRole("button",{name:"코드로 로그인"}).click();
    await page.getByRole("button",{name:"알림 켜기",exact:true}).click();
    await page.getByRole("button",{name:"시험 알림 보내기"}).click();
    await page.getByText("알림이 왔나요?").waitFor();
    await page.waitForTimeout(850);
    await page.getByRole("button",{name:"왔어요",exact:true}).click();
    await page.waitForURL("**/apps/demo");
    await page.waitForTimeout(850);
    await page.close();
    await video.saveAs(fileURLToPath(new URL("flow.webm",directory)));
  } finally {
    await context.close();
    await rm(temp,{recursive:true,force:true});
  }
}
