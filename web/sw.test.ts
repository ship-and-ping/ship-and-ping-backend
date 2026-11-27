import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {expect,it,vi} from "vitest";
const source = readFileSync("public/sw.js","utf8");
const origin = "https://ship-and-ping.pages.dev";
const id = "12345678-1234-1234-1234-123456789abc";
const path = "/apps/"+id+"/issues/"+id;
function worker(script = source) {
  const events = new Map<string,(event:unknown) => void>();
  const clients = {matchAll:vi.fn(),openWindow:vi.fn()};
  const showNotification = vi.fn();
  runInNewContext(script,{URL,self:{location:{origin},clients,registration:{showNotification},
    addEventListener:(name:string,fn:(value:unknown)=>void) => events.set(name,fn)}});
  return {clients,showNotification,async dispatch(name:string,event:object) {
    let done;
    events.get(name)!({...event,waitUntil:(promise:Promise<unknown>) => {done=promise;}});
    await done;
  }};
}
it("shows the payload and opens its exact issue on a click",async () => {
  const sw = worker();
  await sw.dispatch("push",{data:{json:() => ({url:path,title:"문제 알림",body:"속도 변화"})}});
  const [title,options] = sw.showNotification.mock.calls[0];
  expect(title).toBe("문제 알림");
  expect(options.body).toBe("속도 변화");
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
