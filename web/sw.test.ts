import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {expect,it,vi} from "vitest";
const source = readFileSync("public/sw.js","utf8").replaceAll("\r\n","\n");
const origin = "https://ship-and-ping.pages.dev";
const id = "12345678-1234-1234-1234-123456789abc";
const path = "/apps/"+id+"/issues/"+id;
function worker(script = source) {
  const events = new Map<string,(event:unknown) => void>();
  const client = {postMessage:vi.fn()};
  const clients = {matchAll:vi.fn().mockResolvedValue([client]),openWindow:vi.fn()};
  const showNotification = vi.fn();
  runInNewContext(script,{URL,self:{location:{origin},clients,registration:{showNotification},
    addEventListener:(name:string,fn:(value:unknown)=>void) => events.set(name,fn)}});
  return {client,clients,showNotification,async dispatch(name:string,event:object) {
    let done;
    await events.get(name)!({...event,waitUntil:(promise:Promise<unknown>) => {done=promise;}});
    await done;
  }};
}
it("shows the payload and opens its exact issue on a click",async () => {
  const sw = worker();
  await sw.dispatch("push",{data:{json:() => ({url:path,title:"문제 알림",body:"속도 변화"})}});
  const [title,options] = sw.showNotification.mock.calls[0];
  expect(title).toBe("문제 알림");
  expect(options.body).toBe("속도 변화");
  expect(sw.client.postMessage).not.toHaveBeenCalled();
  expect(sw.clients.matchAll).not.toHaveBeenCalled();
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
  expect(sw.clients.openWindow).not.toHaveBeenCalled();
}
it("opens only application routes at the app origin", async () => {
  await checkExternalDestination(source);
});
it("detects a missing origin check in an isolated worker copy", async () => {
  const copy = source.replace("url.origin === self.location.origin &&","true &&");
  expect(copy).not.toBe(source);
  await expect(checkExternalDestination(copy)).rejects.toThrow();
});

async function checkPrivatePush(script: string) {
  const sw = worker(script);
  await sw.dispatch("push",{data:{json:() => ({title:"예제",body:"본문",url:path})}});
  expect(sw.showNotification).toHaveBeenCalledOnce();
  expect(sw.client.postMessage).not.toHaveBeenCalled();
}

it("detects a worker that contacts an open window while handling push", async () => {
  await checkPrivatePush(source);
  const mutant = source.replace("event => {\n  let notice;", "async event => {\n    (await self.clients.matchAll())[0].postMessage('fixture');\n    let notice;");
  expect(mutant).not.toBe(source);
  await expect(checkPrivatePush(mutant)).rejects.toThrow();
});

it.each(["/account","/apps/"+id+"/notifications","//example.org"+path])("ignores non-issue destinations (%s)",async url => {
  const sw = worker();
  await sw.dispatch("notificationclick",{notification:{data:{url},close:vi.fn()}});
  expect(sw.clients.openWindow).not.toHaveBeenCalled();
});
