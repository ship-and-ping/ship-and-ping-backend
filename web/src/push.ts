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
export async function subscribe() {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!key) throw Error("푸시 발송 설정을 준비 중이에요.");
  // iOS requires permission to be requested directly from a user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw Error(permission === "denied" ? deniedHelp() : "알림을 받으려면 허용을 눌러 주세요.");
  await navigator.serviceWorker.register("/sw.js");
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  const bytes = Uint8Array.from(atob(key.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
  const oldKey = current?.options.applicationServerKey;
  if (current && oldKey && bytes.toString() === new Uint8Array(oldKey).toString()) return current;
  if (current) await current.unsubscribe();
  return registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
}
export function deniedHelp() {
  return ["iPhone","iPad"].includes(deviceType())
    ? "설정 → 알림 → 쉽앤핑에서 ‘알림 허용’을 켜 주세요."
    : "브라우저의 사이트 설정에서 쉽앤핑 알림을 허용해 주세요.";
}
