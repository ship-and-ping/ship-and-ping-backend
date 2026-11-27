type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | undefined;
function updateInstall(event?: InstallEvent) {
  installEvent = event;
  window.dispatchEvent(new Event("push-install-change"));
}
export function startPwa() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    updateInstall(event as InstallEvent);
  });
  window.addEventListener("appinstalled", () => updateInstall());
  if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
export const canInstall = () => Boolean(installEvent);
export async function install() {
  const event = installEvent;
  if (!event) return;
  updateInstall();
  await event.prompt();
  await event.userChoice;
}
export function deviceType() {
  if (/iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone|iPod/.test(navigator.userAgent)) return "iPhone";
  return /Android/.test(navigator.userAgent) ? "Android" : "PC";
}
export function standalone() {
  return (navigator as Navigator & {standalone?: boolean}).standalone === true ||
    Boolean(window.matchMedia?.("(display-mode: standalone)").matches);
}
export function notifyPushChange() {
  window.dispatchEvent(new Event("push-device-change"));
  if (window.BroadcastChannel) {
    const channel = new BroadcastChannel("push-device-change");
    channel.postMessage(null);
    channel.close();
  }
}

export async function closePushNotifications() {
  const registration = await navigator.serviceWorker?.getRegistration("/");
  const notices = await registration?.getNotifications?.();
  notices?.forEach(notice => notice.close());
}
export async function currentSubscription() {
  const registration = await navigator.serviceWorker?.getRegistration("/");
  return await registration?.pushManager?.getSubscription() ?? null;
}
export function configuredKey() {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return key ? Uint8Array.from(atob(key.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0)) : null;
}
export async function fingerprint(bytes: ArrayBuffer | null | undefined) {
  if (!bytes) return null;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2,"0")).join("");
}
export class PushCleanupError extends Error {
  constructor() { super("이전 회원의 푸시 구독을 정리하지 못했어요. 연결을 확인하고 다시 시도해 주세요."); }
}
export async function requestPushPermission() {
  const bytes = configuredKey();
  if (!bytes) throw Error("푸시 발송 설정을 준비 중이에요.");
  // iOS requires permission to be requested directly from a user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw Error(permission === "denied" ? deniedHelp() : "알림을 받으려면 허용을 눌러 주세요.");
  return bytes;
}
export async function subscribe(bytes: Uint8Array<ArrayBuffer>, remove: (endpoint: string) => Promise<void>, registeredEndpoint?: string) {
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  const oldKey = current?.options.applicationServerKey;
  if (current && current.endpoint === registeredEndpoint && oldKey && bytes.toString() === new Uint8Array(oldKey).toString()) return current;
  if (current) {
    await remove(current.endpoint);
    if (!await current.unsubscribe()) throw Error("푸시 구독을 갱신하지 못했어요.");
  }
  return registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
}
export function deniedHelp() {
  return ["iPhone","iPad"].includes(deviceType())
    ? "설정 → 알림 → 쉽앤핑에서 ‘알림 허용’을 켜 주세요."
    : "브라우저의 사이트 설정에서 쉽앤핑 알림을 허용해 주세요.";
}
