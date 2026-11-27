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

self.addEventListener("push", event => {
  let notice;
  try { notice = event.data?.json(); } catch { /* Use the generic notification. */ }
  event.waitUntil(self.registration.showNotification(notice?.title ?? "쉽앤핑", {
    body: notice?.body ?? "앱에서 알림을 확인해 주세요.",
    icon: "/sheep-192.png",
    data: { url: issueUrl(notice?.url) },
  }));
});

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
