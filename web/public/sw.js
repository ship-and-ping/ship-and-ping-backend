// User sessions and API responses always use the network.
function destination(value) {
  try {
    const url = new URL(value, self.location.origin);
    const id = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
    if (url.origin === self.location.origin &&
        new RegExp("^/apps/" + id + "/(?:issues/" + id + "|notifications)$", "i").test(url.pathname)) {
      return url.origin + url.pathname;
    }
  } catch { /* Open the app list when the payload is incomplete. */ }
  return self.location.origin + "/apps";
}

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

async function confirmOwner(binding) {
  const windows = await self.clients.matchAll({ type: "window" });
  const client = windows.find(window => window.focused);
  if (!client) return false;
  const channel = new MessageChannel();
  try {
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 1500);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        resolve(event.data === true);
      };
      client.postMessage({type:"confirm-push-owner", device:binding.device, owner:binding.owner}, [channel.port2]);
    });
  } finally {
    channel.port1.close();
  }
}

self.addEventListener("push", event => {
  let notice = {};
  try { notice = event.data?.json() ?? {}; } catch { /* Use the generic notification. */ }
  async function show() {
    const cache = await caches.open("ship-ping-push-device");
    const response = await cache.match("/.push-device");
    if (!response) return;
    const saved = await response.text();
    let binding;
    try { binding = JSON.parse(saved); } catch { binding = {device:saved}; }
    if (!notice.device || binding?.device !== notice.device) return;
    const confirmed = self.navigator?.locks && typeof binding.owner === "string" &&
      await confirmOwner(binding).catch(() => false);
    await self.registration.showNotification(confirmed && notice.title || "쉽앤핑", {
      body: confirmed && notice.body || "앱에서 알림을 확인해 주세요.",
      icon: "/sheep-192.png",
      data: { url: destination(confirmed ? notice.url : "/apps") },
    });
  }
  event.waitUntil(self.navigator?.locks ? self.navigator.locks.request("push-device", show) : show());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = destination(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url === url);
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  })());
});
