import { deviceType, standalone } from "./push";

export function installDevice() {
  if (standalone()) return "installed";
  const type = deviceType();
  const ua = navigator.userAgent;
  if (type === "iPhone" || type === "iPad") {
    if (!/Version\/[\d.]+.*Safari\//.test(ua) || /CriOS|FxiOS|EdgiOS|GSA\/|Gmail|FBAN|FBAV|Instagram|Line\//i.test(ua)) return "open-safari";
    const version = /OS (\d+)[_.](\d+)/.exec(ua) ?? /Version\/(\d+)\.(\d+)/.exec(ua);
    if (version && (+version[1]<16 || (+version[1]===16 && +version[2]<4))) return "update";
    return "safari";
  }
  return type === "Android" ? "android" : "desktop";
}
