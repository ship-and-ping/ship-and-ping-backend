import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import type {Gateway} from "./data";
import {PushChannel} from "./PushChannel";
import {startPwa} from "./push";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function setup(home: boolean, permission: NotificationPermission = "granted", agent = "iPhone") {
  const sub = {endpoint:"https://web.push.apple.com/device",toJSON:() => ({endpoint:"https://web.push.apple.com/device",keys:{p256dh:"fixture",auth:"fixture"}})};
  const manager = {getSubscription:vi.fn(async () => null),subscribe:vi.fn(async () => sub)};
  const reg = {pushManager:manager};
  const register = vi.fn(async () => reg);
  vi.stubGlobal("navigator", {userAgent:agent,standalone:home,serviceWorker:{register,getRegistration:register,ready:Promise.resolve(reg)}});
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal("Notification",{permission:"default",requestPermission});
  vi.stubGlobal("PushManager",class {});
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY","BA");
  const api = {devices:vi.fn(async () => []),registerPush:vi.fn()};
  render(<PushChannel api={api as unknown as Gateway} app="mine" settings={{push:true,email:false,connected:false,broken:false,channel:null}} reload={vi.fn()}/>);
  return {api,manager,sub,requestPermission};
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
