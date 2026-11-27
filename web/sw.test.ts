import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {expect,it,vi} from "vitest";
const source = readFileSync("public/sw.js","utf8");
const origin = "https://ship-and-ping.pages.dev";
const id = "12345678-1234-1234-1234-123456789abc";
const path = "/apps/"+id+"/issues/"+id;
function worker(script = source, saved = JSON.stringify({device:id,owner:"member"})) {
  const events = new Map<string,(event:unknown) => void>();
  const client = {focused:true, postMessage:vi.fn((_message, ports: MessagePort[]) => ports[0].postMessage(true))};
  const clients = {matchAll:vi.fn().mockResolvedValue([client]),openWindow:vi.fn()};
  const showNotification = vi.fn();
  const caches = {open:async () => ({match:async () => ({text:async () => saved})})};
  const locks = {request:async (_name:string, action:()=>Promise<void>) => action()};
  runInNewContext(script,{URL,caches,MessageChannel,setTimeout,clearTimeout,self:{navigator:{locks},location:{origin},clients,registration:{showNotification},
    addEventListener:(name:string,fn:(value:unknown)=>void) => events.set(name,fn)}});
  return {client,clients,showNotification,async dispatch(name:string,event:object) {
    let done;
    events.get(name)!({...event,waitUntil:(promise:Promise<unknown>) => {done=promise;}});
    await done;
  }};
}
it("shows the payload and opens its exact issue on a click",async () => {
  const sw = worker();
  await sw.dispatch("push",{data:{json:() => ({device:id,url:path,title:"문제 알림",body:"속도 변화"})}});
  const [title,options] = sw.showNotification.mock.calls[0];
  expect(title).toBe("문제 알림");
  expect(options.body).toBe("속도 변화");
  expect(sw.client.postMessage.mock.calls[0][0]).toEqual({type:"confirm-push-owner",owner:"member",device:id});
  sw.clients.matchAll.mockResolvedValue([]);
  await sw.dispatch("notificationclick",{notification:{data:options.data,close:vi.fn()}});
  expect(sw.clients.openWindow).toHaveBeenCalledWith(origin+path);
  const focus = vi.fn();
  sw.clients.matchAll.mockResolvedValue([{url:origin+path,focus}]);
  await sw.dispatch("notificationclick",{notification:{data:options.data,close:vi.fn()}});
  expect(focus).toHaveBeenCalledOnce();
  expect(sw.clients.openWindow).toHaveBeenCalledTimes(1);
});
async function checkExternalDestination(script: string) {
  const sw = worker(script);
  sw.clients.matchAll.mockResolvedValue([]);
  await sw.dispatch("notificationclick",{notification:{data:{url:"https://example.org"+path},close:vi.fn()}});
  expect(sw.clients.openWindow).toHaveBeenCalledWith(origin+"/apps");
}
it("opens only application routes at the app origin", async () => {
  await checkExternalDestination(source);
});
it("detects a missing origin check in an isolated worker copy", async () => {
  const copy = source.replace("url.origin === self.location.origin &&","true &&");
  expect(copy).not.toBe(source);
  await expect(checkExternalDestination(copy)).rejects.toThrow();
});

async function checkOldAccount(script: string) {
  const sw = worker(script);
  await sw.dispatch("push",{data:{json:() => ({device:"previous",title:"이전 계정",body:"이전 앱의 장애"})}});
  expect(sw.showNotification).not.toHaveBeenCalled();
}
it("drops an in-flight message addressed to the former device and detects a removed binding check", async () => {
  await checkOldAccount(source);
  const mutant = source.replace("binding?.device !== notice.device","false");
  expect(mutant).not.toBe(source);
  await expect(checkOldAccount(mutant)).rejects.toThrow();
});

it.each(["closed","different member","legacy binding","unreachable"])("shows only generic text and the app list when ownership is uncertain (%s)",async reason => {
  const sw = worker(source, reason === "legacy binding" ? id : undefined);
  if (reason === "closed") sw.clients.matchAll.mockResolvedValue([]);
  if (reason === "different member") sw.client.postMessage.mockImplementation((_message, ports) => ports[0].postMessage(false));
  if (reason === "unreachable") sw.client.postMessage.mockImplementation(() => {});
  await sw.dispatch("push",{data:{json:() => ({device:id,url:path,title:"이전 앱",body:"이전 장애"})}});
  expect(sw.showNotification).toHaveBeenCalledWith("쉽앤핑",{
    body:"앱에서 알림을 확인해 주세요.",icon:"/sheep-192.png",data:{url:origin+"/apps"},
  });
});

it("detects disclosure when the current-session confirmation is bypassed in a worker copy", async () => {
  async function check(script: string) {
    const sw = worker(script);
    sw.clients.matchAll.mockResolvedValue([]);
    await sw.dispatch("push",{data:{json:() => ({device:id,title:"이전 회원 앱"})}});
    expect(sw.showNotification.mock.calls[0][0]).toBe("쉽앤핑");
  }
  await check(source);
  const mutant = source.replace("await confirmOwner(binding).catch(() => false)", "true");
  expect(mutant).not.toBe(source);
  await expect(check(mutant)).rejects.toThrow();
});
