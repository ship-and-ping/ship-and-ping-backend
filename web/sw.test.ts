import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {IDBFactory} from "fake-indexeddb";
import {expect,it,vi} from "vitest";
const source = readFileSync("public/sw.js","utf8").replaceAll("\r\n","\n");
const origin = "https://ship-and-ping.pages.dev";
const id = "12345678-1234-1234-1234-123456789abc";
const path = "/apps/"+id+"/issues/"+id;
function worker(script = source, indexedDB = new IDBFactory()) {
  const events = new Map<string,(event:unknown) => void>();
  const client = {postMessage:vi.fn()};
  const clients = {matchAll:vi.fn().mockResolvedValue([client]),openWindow:vi.fn()};
  const showNotification = vi.fn();
  const unsubscribe = vi.fn(async () => true);
  const getSubscription = vi.fn(async (): Promise<{unsubscribe: typeof unsubscribe} | null> => ({unsubscribe}));
  runInNewContext(script,{URL,indexedDB,self:{location:{origin},clients,registration:{
    showNotification,getNotifications:async () => [],pushManager:{getSubscription}},
    addEventListener:(name:string,fn:(value:unknown)=>void) => events.set(name,fn)}});
  return {client,clients,showNotification,unsubscribe,getSubscription,async command(command:string) {
    const reply = {postMessage:vi.fn()};
    await this.dispatch("message",{data:command,ports:[reply]});
    return reply.postMessage.mock.calls[0][0];
  },async dispatch(name:string,event:object) {
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
  const mutant = source.replace("  let notice;", "  (await self.clients.matchAll())[0].postMessage('fixture');\n  let notice;");
  expect(mutant).not.toBe(source);
  await expect(checkPrivatePush(mutant)).rejects.toThrow();
});

const privatePayload = {title:"고객 앱 · 결제",body:"실패 48건",url:path};
async function checkLockedPush(script: string) {
  const db = new IDBFactory();
  expect(await worker(script, db).command("lock-push")).toBe(true);
  const restarted = worker(script, db);
  restarted.unsubscribe.mockRejectedValue(Error("offline"));
  const json = vi.fn(() => privatePayload);
  await restarted.dispatch("push",{data:{json}});
  expect(restarted.showNotification).toHaveBeenCalledExactlyOnceWith(
    "쉽앤핑 알림이 있어요 — 로그인해서 확인하세요",{icon:"/sheep-192.png"});
  expect(json).not.toHaveBeenCalled();
  expect(restarted.unsubscribe).toHaveBeenCalledOnce();
}
it("masks a locked push after worker restart even when unsubscribe is offline", async () => {
  await checkLockedPush(source);
  const mutant = source.replace("if (locked !== false)", "if (false)");
  expect(mutant).not.toBe(source);
  await expect(checkLockedPush(mutant)).rejects.toThrow();
});

it.each([false,true])("keeps the lock until login cleanup confirms unsubscribe or absence (%s)", async absent => {
  const sw = worker();
  expect(await sw.command("lock-push")).toBe(true);
  sw.unsubscribe.mockResolvedValue(false);
  expect(await sw.command("recover-push")).toBe(false);
  await sw.dispatch("push",{data:{json:() => privatePayload}});
  expect(sw.showNotification.mock.calls[0][0]).toBe("쉽앤핑 알림이 있어요 — 로그인해서 확인하세요");
  sw.unsubscribe.mockClear().mockResolvedValue(true);
  if (absent) sw.getSubscription.mockResolvedValue(null);
  expect(await sw.command("recover-push")).toBe(true);
  expect(sw.unsubscribe).toHaveBeenCalledTimes(absent ? 0 : 1);
  await sw.dispatch("push",{data:{json:() => privatePayload}});
  expect(sw.showNotification.mock.calls[1][0]).toBe(privatePayload.title);
});

it.each(["/account","/apps/"+id+"/notifications","//example.org"+path])("ignores non-issue destinations (%s)",async url => {
  const sw = worker();
  await sw.dispatch("notificationclick",{notification:{data:{url},close:vi.fn()}});
  expect(sw.clients.openWindow).not.toHaveBeenCalled();
});
