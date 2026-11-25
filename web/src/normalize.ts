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

// Rust's Unicode word boundary also treats combining marks and connector
// punctuation as word characters. Short key prefixes have an ASCII boundary.
const word = "[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200c\\u200d]";
const start = "(?<!" + word + ")";
const privatePattern = new RegExp([
  start + /(?:set-cookie|cookie)[ \t]*:[^\r\n]*/.source,
  start + /bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;]+/.source,
  start + /basic[ \t]+(?:[a-z0-9+/]{14,}==|[a-z0-9+/]{15,}=|[a-z0-9+/]{16,})/.source,
  start + /(?:access_token|token|key|password)=[^&\s,;#]+/.source,
  "(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|" + start + "eyJ)[a-z0-9_.=-]+",
  /(?<![a-z0-9])(?:sk|pk|rk)_[a-z0-9_]{16,}/.source,
  /[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}/.source,
  "\\+?" + start + /\p{Nd}(?:[ ().-]*\p{Nd}){8,14}/u.source + "(?!" + word + ")",
].join("|"), "giu");

export function maskText(value: string): string {
  return [...normalizeText(value).replace(privatePattern, "[가림]")].slice(0, 300).join("");
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
    return /^\d+$/.test(part) || uuidSegment.test(part) ||
      part.search(privatePattern) >= 0 || opaqueSegment(part) ? ":id" : part;
  }).join("/");
}

/** Returns plain text for JSX text nodes and input values. */
export function displayText(
  value: string,
  field: "app-data" | "login-email" = "app-data",
): string {
  if (field === "login-email") return value;
  return maskText(value).replace(/\n+/g, " ");
}
