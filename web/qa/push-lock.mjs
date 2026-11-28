import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

// Two real browsing contexts share IndexedDB/localStorage even after the
// holding tab is abruptly closed. Exercise both browser lock implementations.
const server = await createServer({server:{host:"127.0.0.1",port:0}});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:process.platform === "win32" ? "msedge" : "chrome"});
  const privacy = await browser.newContext();
  try {
    const page = await privacy.newPage();
    await page.goto(server.resolvedUrls.local[0] + "src/push.ts");
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const {changePushPrivacy} = await import("/src/push.ts");
      await changePushPrivacy("lock-push");
    });
    await page.close();
    const login = await privacy.newPage();
    await login.goto(server.resolvedUrls.local[0] + "src/push.ts");
    const readLock = () => new Promise((resolve, reject) => {
      const open = indexedDB.open("ship-ping-push-privacy", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("device");
        const read = tx.objectStore("device").get("locked");
        tx.oncomplete = () => { db.close(); resolve(read.result === true); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    assert.equal(await login.evaluate(readLock), true);
    await login.evaluate(async () => (await import("/src/push.ts")).changePushPrivacy("recover-push"));
    assert.equal(await login.evaluate(readLock), false);
    console.log("Worker committed the privacy lock and cleared it on recovery");
  } finally { await privacy.close(); }
  for (const fallback of [false,true]) {
    const context = await browser.newContext();
    try {
      if (fallback) await context.addInitScript(() => Object.defineProperty(navigator,"locks",{value:undefined}));
      const first = await context.newPage();
      const second = await context.newPage();
      for (const page of [first,second]) {
        await page.goto(server.resolvedUrls.local[0] + "src/push-lock.ts");
        await page.evaluate(async () => {
          window.lockPush = (await import("/src/push-lock.ts")).withPushLock;
        });
      }
      await first.evaluate(() => {
        void window.lockPush(() => {
          localStorage.setItem("holder","first");
          return new Promise(() => {});
        });
      });
      await second.waitForFunction(() => localStorage.getItem("holder") === "first");
      await second.evaluate(() => { void window.lockPush(async () => localStorage.setItem("holder","second")); });
      // Observe contention in the implementation, then destroy the holder.
      if (fallback) {
        assert.ok(await first.evaluate(() => localStorage.getItem("ship-and-ping-push")));
      } else {
        await second.waitForFunction(async () => (await navigator.locks.query()).pending.some(lock => lock.name === "ship-and-ping-push"));
      }
      assert.equal(await second.evaluate(() => localStorage.getItem("holder")),"first");
      await first.close();
      await second.waitForFunction(() => localStorage.getItem("holder") === "second");
    } finally { await context.close(); }
    console.log(fallback ? "localStorage token recovered" : "Web Lock recovered");
  }
} finally { await browser?.close(); await server.close(); }
