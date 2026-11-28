import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gateway, type Gateway } from "./data";
import { OtpLogin } from "./OtpLogin";
import { PushSetup } from "./PushSetup";
import * as push from "./push";

afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();});
it("requests an existing member's code and verifies it in the home screen session", async () => {
  const auth = {signInWithOtp:vi.fn().mockResolvedValue({}),verifyOtp:vi.fn().mockResolvedValue({})};
  const api = gateway({auth} as unknown as SupabaseClient);
  await api.requestLoginCode("member@example.invalid");
  expect(auth.signInWithOtp).toHaveBeenCalledWith({email:"member@example.invalid",options:{shouldCreateUser:false,emailRedirectTo:location.origin+"/install"}});
  await api.verifyLoginCode("member@example.invalid","001234");
  expect(auth.verifyOtp).toHaveBeenCalledWith({type:"email",email:"member@example.invalid",token:"001234"});
});
it("lets the member correct a bad code and explains a server-side attempt limit", async () => {
  const api = {requestLoginCode:vi.fn(),verifyLoginCode:vi.fn()
    .mockRejectedValueOnce({status:403}).mockRejectedValueOnce({status:429}).mockResolvedValueOnce(undefined)};
  render(<OtpLogin api={api}/>);
  fireEvent.change(screen.getByLabelText("가입한 이메일"),{target:{value:"member@example.invalid"}});
  fireEvent.click(screen.getByRole("button",{name:"6자리 코드 받기"}));
  fireEvent.change(await screen.findByLabelText("6자리 코드"),{target:{value:"001234"}});
  fireEvent.click(screen.getByRole("button",{name:"코드로 로그인"}));
  expect((await screen.findByRole("alert")).textContent).toMatch(/코드를 다시/);
  fireEvent.click(screen.getByRole("button",{name:"코드로 로그인"}));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/잠시 뒤/));
});
it("shows a preparation state without asking permission when VAPID is absent", async () => {
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY","");
  const permission = vi.spyOn(push,"requestPushPermission");
  render(<MemoryRouter><PushSetup api={{apps:vi.fn(async()=>[])} as unknown as Gateway}/></MemoryRouter>);
  expect(await screen.findByText("알림 준비 중")).toBeTruthy();
  expect(permission).not.toHaveBeenCalled();
});
it("waits for server VAPID configuration even when the browser has a key", async () => {
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY","BA");
  const apps = vi.fn();
  render(<MemoryRouter><PushSetup api={{pushReady:async()=>false,apps} as unknown as Gateway}/></MemoryRouter>);
  expect(await screen.findByText("알림 준비 중")).toBeTruthy();
  expect(apps).not.toHaveBeenCalled();
});
it("requests permission on tap and waits for a delivery acknowledgement", async () => {
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY","BA");
  vi.stubGlobal("Notification",{permission:"default"});
  vi.stubGlobal("PushManager",{});
  vi.stubGlobal("navigator",{userAgent:"Android",serviceWorker:{}});
  const permission = vi.spyOn(push,"requestPushPermission").mockResolvedValue(Uint8Array.of(4));
  vi.spyOn(push,"currentSubscription").mockResolvedValue(null);
  vi.spyOn(push,"subscribe").mockResolvedValue({endpoint:"endpoint",toJSON:()=>({})} as PushSubscription);
  const api = {pushReady:async()=>true,apps:async()=>[{id:"app",name:"내 앱"}],devices:async()=>[{id:"device",endpoint:"endpoint",current_session:true}],
    withPushRegistration:async (action: (ops:unknown)=>Promise<void>)=>action({registerPush:vi.fn(),removeEndpoint:vi.fn()}),testPush:vi.fn(async()=>true)};
  render(<MemoryRouter><PushSetup api={api as unknown as Gateway}/></MemoryRouter>);
  const enable = await screen.findByRole("button",{name:"알림 켜기"});
  expect(permission).not.toHaveBeenCalled();
  fireEvent.click(enable);
  fireEvent.click(await screen.findByRole("button",{name:"시험 알림 보내기"}));
  expect(await screen.findByText("알림이 왔나요?")).toBeTruthy();
  expect(api.testPush).toHaveBeenCalledWith("app","device");
  fireEvent.click(screen.getByRole("button",{name:"안 왔어요"}));
  expect(await screen.findByText(/집중 모드/)).toBeTruthy();
});
