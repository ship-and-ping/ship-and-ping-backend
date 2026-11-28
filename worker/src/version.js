const uuid = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89abAB][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}";
const deployment = new RegExp(
  "^(\\d{4}-\\d{2}-\\d{2})(T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2}))?(?:-(" + uuid + "))?$",
);
export const maskedVersion = "버전 형식 확인 필요";
/** @param {string} raw */
export function versionLabel(raw) {
  if (typeof raw !== "string" || raw.length > 64 || /\s/.test(raw)) return maskedVersion;
  // A short hex key with both digits and letters is indistinguishable from a commit ID.
  const hasHexLetter = /[a-f]/.test(raw);
  if (/^[0-9a-f]{7,12}$/.test(raw) && hasHexLetter && /\d/.test(raw)) return raw;
  if (/^[0-9a-f]{40}$/.test(raw) && hasHexLetter) return raw.slice(0, 7);
  if (/^v?\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|dev|pre|build)(?:\.?\d{1,6})?|\+\d{1,9})?$/.test(raw)) return raw;
  if (/^(?:build|b)?-?\d{1,9}$/.test(raw)) return raw;

  const match = deployment.exec(raw);
  if (!match) return maskedVersion;
  const [, date, time = "", id] = match;
  const midnight = Date.parse(date);
  const instant = Date.parse(date + time);
  // Date.parse rolls some invalid calendar dates into the following month.
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date ||
      !Number.isFinite(instant)) return maskedVersion;
  const [kstDate, kstTime] = new Date(instant + 9 * 3600000).toISOString().split("T");
  return kstDate.slice(-5).replace("-", "/") + " " + kstTime.slice(0, 5) +
    (id ? " · " + id.slice(0, 8) : "");
}
