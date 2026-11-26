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
const name = "(?:[a-z0-9_-]*(?:token|secret|password|passwd|pwd|apikey)[a-z0-9_-]*|(?:[a-z0-9_-]+[_-])?keys?(?:[_-][a-z0-9_-]+)?)";
const credentialName = new RegExp(String.raw`(?:\\*["']${name}\\*["']|${start}${name})\s*(?:=>|:|=|%3d)\s*`, "gi");
const bareValue = /^(?:(?:bearer|basic)(?:[ \t]*:[ \t]*|[ \t]+))?(?:\[가림\]|\\[^"\s]|[^"'\\\s,;&#])(?:[^\s,;}\]&#]|[}\]]+[^\s,;}\]&#])*/i;
const numeric = /\+?\(?[0-9](?:[ ().\/_\t֊־᐀᠆‐‑‒–—―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－𐵮𐺭−-]*[0-9]){8,}\)?/g;
const privatePatterns = [
  start + /(?:set-cookie|cookie)[ \t]*:[^\r\n]*/.source,
  start + /authorization[ \t]*:[ \t]*token[ \t]+[^\s,;&#"']+/.source,
  start + /bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;&#"']+/.source,
  start + /basic[ \t]+(?:[a-z0-9+/]{14,}==|[a-z0-9+/]{15,}=|[a-z0-9+/]{16,})/.source,
  "(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|" + start + "eyJ)[a-z0-9_.=-]+",
  /(?<![a-z0-9])(?:sk|pk|rk)_[a-z0-9_]{16,}/.source,
  /[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}/.source,
].map(pattern => new RegExp(pattern, "gi"));

type Span = [number, number];

function valueSpan(text: string, start: number): Span | undefined {
  let pos = start;
  while (text[pos] === "\\") pos++;
  const quote = text[pos];
  if (quote === '"' || quote === "'") {
    const escapes = pos - start;
    const body = ++pos;
    let slashes = 0;
    for (; pos < text.length; pos++) {
      if (text[pos] === quote && slashes % (2 * (escapes + 1)) === escapes)
        return [body, pos - escapes];
      slashes = text[pos] === "\\" ? slashes + 1 : 0;
    }
    return [body, pos];
  }
  if (text[start] === "[") {
    let depth = 0, quoted = false;
    for (pos = start; pos < text.length; pos++) {
      if (quoted && text[pos] === "\\") pos++;
      else if (text[pos] === '"') quoted = !quoted;
      else if (!quoted && text[pos] === "[") depth++;
      else if (!quoted && text[pos] === "]" && --depth === 0) return [start, pos + 1];
    }
    return [start, text.length];
  }
  const bare = bareValue.exec(text.slice(start));
  if (bare) return [start, start + bare[0].length];
}

function isTimestamp(number: string) {
  if (!/^(?:[0-9]{10}|[0-9]{13})$/.test(number)) return false;
  const seconds = Number(number.slice(0, 10));
  if (seconds < 1577836800 || seconds > 2082758399) return false;
  if (number.length === 10) return true;
  // All other 13–19 digit candidates are already masked by the numeric rule.
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    const digit = Number(number[i]) * (i % 2 + 1);
    sum += digit > 9 ? digit - 9 : digit;
  }
  if (sum % 10 === 0) return false;
  if (!/[1-4]/.test(number[6])) return true;
  const year = 2000 + Number(number.slice(0, 2));
  const month = Number(number.slice(2, 4)), day = Number(number.slice(4, 6));
  return month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function redact(text: string, spans: Span[]) {
  let end = 0, result = "";
  for (const [start, stop] of spans.sort((a, b) => a[0] - b[0])) {
    if (start >= end) result += text.slice(end, start) + "[가림]";
    end = Math.max(end, stop);
  }
  return result + text.slice(end);
}

export function maskVersion(raw: string) {
  const text = normalizeText(raw);
  const pattern = /(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_)[a-z0-9_.=-]+|(?<![a-z0-9])(?:sk|pk|rk)_[a-z0-9_]{16,}/gi;
  return text.replace(pattern, "[가림]");
}

export function maskText(value: string): string {
  const text = normalizeText(value);
  const spans: Span[] = [];
  for (const match of text.matchAll(credentialName)) {
    const span = valueSpan(text, match.index + match[0].length);
    if (span && span[1] > span[0]) spans.push(span);
  }
  for (const pattern of [...privatePatterns, numeric]) {
    for (const m of text.matchAll(pattern)) {
      if (pattern !== numeric || !isTimestamp(m[0])) spans.push([m.index, m.index + m[0].length]);
    }
  }
  return [...redact(text, spans)].slice(0, 300).join("");
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
      [...privatePatterns, credentialName, numeric].some(pattern => part.search(pattern) >= 0) || opaqueSegment(part) ? ":id" : part;
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
