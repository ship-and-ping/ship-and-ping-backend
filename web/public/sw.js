function issueUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    const id = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
    if (url.origin === self.location.origin &&
        new RegExp("^/apps/" + id + "/issues/" + id + "$", "i").test(url.pathname)) {
      return url.origin + url.pathname;
    }
  } catch { /* A notification without an issue has no click destination. */ }
  return null;
}

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  await caches.delete("ship-ping-push-device");
  await self.clients.claim();
})()));

// Serialize notifications and account transitions, including browser unsubscribe.
// A delayed locked push must never unsubscribe a newly registered device.
let privacyQueue = Promise.resolve();
function inPushOrder(action) {
  const result = privacyQueue.then(action);
  privacyQueue = result.catch(() => {});
  return result;
}

async function deviceLock(operation) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open("ship-ping-push-privacy", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("device");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("device", operation === "read" ? "readonly" : "readwrite");
      const store = tx.objectStore("device");
      let request;
      if (operation === "lock") store.put(true, "locked");
      else if (operation === "unlock") store.delete("locked");
      else request = store.get("locked");
      tx.oncomplete = () => resolve(request?.result === true);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function unsubscribeDevice() {
  const sub = await self.registration.pushManager?.getSubscription();
  if (sub && !await sub.unsubscribe()) throw Error("unsubscribe failed");
}

self.addEventListener("message", event => {
  const command = event.data;
  const reply = event.ports[0];
  if (!reply || (command !== "lock-push" && command !== "recover-push")) return;
  event.waitUntil(inPushOrder(async () => {
    if (command === "lock-push") {
      await deviceLock("lock");
      // Close any notification that was displayed just before the lock.
      const notices = await self.registration.getNotifications();
      notices.forEach(notice => notice.close());
    } else if (await deviceLock("read")) {
      await unsubscribeDevice();
      await deviceLock("unlock");
    }
  }).then(() => reply.postMessage(true), () => reply.postMessage(false)));
});

self.addEventListener("push", event => event.waitUntil(inPushOrder(async () => {
  let locked;
  try { locked = await deviceLock("read"); } catch { /* Hide details if storage is unavailable. */ }
  if (locked !== false) {
    await Promise.all([
      self.registration.showNotification("쉽앤핑 알림이 있어요 — 로그인해서 확인하세요", {icon: "/sheep-192.png"}),
      locked && unsubscribeDevice().catch(() => {}),
    ]);
    return;
  }
  let notice;
  try { notice = event.data?.json(); } catch { /* Use the generic notification. */ }
  await self.registration.showNotification(notice?.title ?? "쉽앤핑", {
    body: notice?.body ?? "앱에서 알림을 확인해 주세요.",
    icon: "/sheep-192.png",
    data: { url: issueUrl(notice?.url) },
  });
})));

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = issueUrl(event.notification.data?.url);
  if (!url) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url === url);
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  })());
});
