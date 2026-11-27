import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import type {Gateway} from "./data";
import {PushChannel} from "./PushChannel";
import {startPwa} from "./push";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function setup(home: boolean, permission: NotificationPermission = "granted", agent = "iPhone", rotated = false) {
  vi.stubGlobal("crypto", {subtle:{digest:async (_algorithm: string, bytes: ArrayBuffer) => bytes}});
  const sub = {endpoint:"https://web.push.apple.com/device",toJSON:() => ({endpoint:"https://web.push.apple.com/device",keys:{p256dh:"fixture",auth:"fixture"}})};
  const old = {...sub,options:{applicationServerKey:Uint8Array.of(3).buffer},unsubscribe:vi.fn(async () => true)};
  const manager = {getSubscription:vi.fn(async () => rotated ? old : null),subscribe:vi.fn(async () => sub)};
  const reg = {pushManager:manager};
  const register = vi.fn(async () => reg);
  vi.stubGlobal("navigator", {userAgent:agent,standalone:home,serviceWorker:{register,getRegistration:register,ready:Promise.resolve(reg)}});
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal("Notification",{permission:"default",requestPermission});
  vi.stubGlobal("PushManager",class {});
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY","BA");
  const api = {devices:vi.fn(async () => rotated ? [{id:"old",endpoint:sub.endpoint,user_agent:"iPhone",
    created_at:"2026-11-27",vapid_fingerprint:"03"}] : []),registerPush:vi.fn(),removeEndpoint:vi.fn()};
  render(<PushChannel api={api as unknown as Gateway} app="mine" settings={{push:true,email:false,connected:false,broken:false,channel:null}} reload={vi.fn()}/>);
  return {api,manager,sub,old,requestPermission};
}
it("shows the Safari instructions until launched from the Home Screen", () => {
  const {requestPermission} = setup(false);
  expect(screen.getByText(/iOS·iPadOS 16.4 이상/)).toBeTruthy();
  expect(screen.queryByRole("button",{name:"푸시 켜기"})).toBeNull();
  expect(requestPermission).not.toHaveBeenCalled();
});
it("saves the browser subscription only after the user enables push", async () => {
  const {api,manager,sub,requestPermission} = setup(true);
  expect(requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"푸시 켜기"}));
  await waitFor(() => expect(api.registerPush).toHaveBeenCalledWith("mine",sub.toJSON(),"iPhone"));
  expect(manager.subscribe).toHaveBeenCalledWith({userVisibleOnly:true,applicationServerKey:new Uint8Array([4])});
});
it("replaces the stored device after VAPID rotation before offering a test push", async () => {
  const {api,manager,sub,old} = setup(true,"granted","iPhone",true);
  await screen.findByText("다시 켜기 필요");
  expect(screen.queryByRole("button",{name:"시험 푸시 보내기"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"푸시 다시 켜기"}));
  await waitFor(() => expect(api.registerPush).toHaveBeenCalledWith("mine",sub.toJSON(),"iPhone"));
  expect(api.removeEndpoint).toHaveBeenCalledWith(old.endpoint);
  expect(old.unsubscribe).toHaveBeenCalledOnce();
  expect(manager.subscribe).toHaveBeenCalledOnce();
});
it("explains how to restore denied iPhone permission", async () => {
  const {api,manager} = setup(true,"denied");
  fireEvent.click(screen.getByRole("button",{name:"푸시 켜기"}));
  await screen.findByText(/설정 → 알림 → 쉽앤핑/);
  expect(manager.subscribe).not.toHaveBeenCalled();
  expect(api.registerPush).not.toHaveBeenCalled();
});
it("prompts Android users to install using the deferred install event", async () => {
  setup(false,"granted","Android");
  startPwa();
  const prompt = vi.fn();
  fireEvent(window,Object.assign(new Event("beforeinstallprompt",{cancelable:true}),{prompt,userChoice:Promise.resolve({outcome:"accepted"})}));
  fireEvent.click(await screen.findByRole("button",{name:"쉽앤핑 설치"}));
  expect(prompt).toHaveBeenCalledOnce();
});
