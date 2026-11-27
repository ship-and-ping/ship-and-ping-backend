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

self.addEventListener("push", event => {
  let notice = {};
  try { notice = event.data?.json() ?? {}; } catch { /* Use the generic notification. */ }
  event.waitUntil(self.registration.showNotification(notice.title || "쉽앤핑", {
    body: notice.body || "앱에서 알림을 확인해 주세요.",
    icon: "/sheep-192.png",
    data: { url: destination(notice.url) },
  }));
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
