/** 요청문에 들어갈 외부 문자열의 검사와 표시가 같은 문자를 보도록 한다. */
function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(
      /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu,
      "",
    )
    .replace(/[\r\v\f\u0085\u2028\u2029]/gu, "\n");
}

export function normalizePromptInput(value: string): string {
  return normalizeText(value).replace(/\n+/g, " ").trim();
}

// Header and credential names can follow Korean text.
const start = "(?<![A-Za-z0-9_])";
const credentialValue = /((?:\\?["'])?[A-Za-z0-9_-]*(?:token|key|secret|password|passwd|pwd)(?:\\?["'])?\s*(?:=>|:|=)\s*)(?:(\\")(?:\\\\.|\\[^"\\]|[^\\])*(\\"|$)|(")(?:\\.|[^"\\])*("|\\?$)|(')(?:\\.|[^'\\])*('|\\?$)|(?:(?:bearer|basic)(?:[ \t]*:[ \t]*|[ \t]+))?[^"'\\\s,;}\]&#][^\s,;}\]&#]*)/gi;
const numeric = /\+?\(?[0-9](?:[ ().-]*[0-9]){8,}\)?/g;
const privatePattern = new RegExp([
  start + /(?:set-cookie|cookie)[ \t]*:[^\r\n]*/.source,
  start + /bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;&#"']+/.source,
  start + /basic[ \t]+(?:[a-z0-9+/]{14,}==|[a-z0-9+/]{15,}=|[a-z0-9+/]{16,})/.source,
  "(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|" + start + "eyJ)[a-z0-9_.=-]+",
  /(?<![a-z0-9])(?:sk|pk|rk)_[a-z0-9_]{16,}/.source,
  /[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}/.source,
].join("|"), "giu");

export function maskText(value: string): string {
  const masked = normalizeText(value)
    .replace(credentialValue, "$1$2$4$6[가림]$3$5$7")
    .replace(privatePattern, "[가림]")
    .replace(numeric, number => {
      const seconds = Number(number.slice(0, 10));
      return /^(?:[0-9]{10}|[0-9]{13})$/.test(number) &&
        seconds >= 1000000000 && seconds <= 2147483647 ? number : "[가림]";
    });
  return [...masked].slice(0, 300).join("");
}

const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const uuidSegment = new RegExp("^(?:" + uuid + "|\\{" + uuid + "\\}|urn:uuid:" + uuid + ")$", "i");

function opaqueSegment(part: string): boolean {
  return part.length >= 16 && /^[a-z0-9_-]+={0,2}$/i.test(part) && (
    part.endsWith("=") || /^[a-f0-9]+$/i.test(part) || /\d/.test(part) ||
    (/[A-Z]/.test(part) && /[a-z]/.test(part))
  );
}

export function sanitizeRoute(value: string): string {
  return normalizeText(value).split(/[?#]/, 1)[0].split("/").map(segment => {
    const part = segment.split(";", 1)[0];
    return /^\d+$|\d{9}/.test(part) || uuidSegment.test(part) ||
      [privatePattern, credentialValue, numeric].some(pattern => part.search(pattern) >= 0) || opaqueSegment(part) ? ":id" : part;
  }).join("/");
}

/** Returns plain text for JSX text nodes and input values. */
export function displayText(
  value: string,
  field: "app-data" | "login-email" | "key-prefix" = "app-data",
): string {
  if (field === "login-email") return value;
  if (field === "key-prefix") return /^sp_(pub|srv)_[a-f0-9]$/.test(value) ? value : "[가림]";
  return maskText(value).replace(/\n+/g, " ");
}
