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
// Quoted keys may contain spaces or punctuation. Bare keys end at structural delimiters.
const credentialName = /[/%]+\s*=>?\s*|(?:\\*"[^"\n]*?\\*"|\\*'[^'\n]*?\\*'|[^\s/\\%"'=:,;<>{}\[\]&?#]+?)\s*(?:=>|->|,+(?=[ \t])|:|=|%3[aAdD])\s*/gu;
function pairKey(prefix: string) {
  return prefix.trimEnd().replace(/(?:=>|->|,|:|=|%3[aAdD])$/, "").trimEnd()
    .replace(/^\\*["']|\\*["']$/g, "").toLowerCase().replace(/[_-]/g, "");
}
const bareValue = /^(?:(?:bearer|basic|token|apikey|digest)(?:[ \t]*:[ \t]*|[ \t]+)[^\s;&]+|(?:\[가림\]|\\[^"\s]|[^"'\\\s,;&#])(?:[^\s,;}\]&#]|[}\]]+[^\s,;}\]&#])*)/i;
const numeric = /\+?\(?[0-9](?:[ ().\/_\t֊־᐀᠆‐‑‒–—―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－𐵮𐺭−-]*[0-9]){8,}\)?/g;
const privatePatterns = [
  start + /(?:set-cookie|cookie|authorization)[ \t]*:[^\r\n]*/.source,
  start + /bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;&#"']+/.source,
  start + /basic[ \t]+(?:[a-z0-9+/]{14,}==|[a-z0-9+/]{15,}=|[a-z0-9+/]{16,})/.source,
  "(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|" + start + "eyJ)[a-z0-9_.=-]+",
  /(?<![a-z0-9])(?:sk|pk|rk)_[a-z0-9_]{16,}/.source,
  /[a-z0-9._%+-]+(?:@|%40)[a-z0-9.-]+\.[a-z]{2,}/.source,
].map(pattern => new RegExp(pattern, "gi"));

type Span = [number, number];

function valueSpan(text: string, start: number, keyEscapes: number): Span | undefined {
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
  if (text[start] === "[" || text[start] === "{") {
    const close = text[start] === "[" ? "]" : "}";
    let depth = 0, slashes = 0, quote = "";
    for (pos = start; pos < text.length; pos++) {
      const c = text[pos];
      const delimiter = (c === '"' || c === "'") && slashes % (2 * (keyEscapes + 1)) === keyEscapes;
      if (delimiter && c === quote) quote = "";
      else if (delimiter && !quote) quote = c;
      else if (!quote && c === text[start]) depth++;
      else if (!quote && c === close && --depth === 0) return [start, pos + 1];
      slashes = c === "\\" ? slashes + 1 : 0;
    }
    return [start, text.length];
  }
  const bare = bareValue.exec(text.slice(start));
  if (bare) return [start, start + bare[0].length];
}

function credentialSpan(text: string, hit: RegExpMatchArray & { index: number }): Span | undefined {
  const prefix = hit[0].trimEnd();
  const start = hit.index + hit[0].length;
  const span = valueSpan(text, start, /^\\*/.exec(prefix)![0].length);
  const tail = text.slice(start);
  if (/%3a$/i.test(prefix)) {
    const size = /^[^&\n]*/.exec(tail)![0].length;
    return [start, Math.max(start + size, span?.[1] ?? start)];
  }
  const plainName = !/^[\\"']/.test(prefix);
  const header = plainName && prefix.endsWith(":");
  const lineValue = /^(?:set-cookie|cookie|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday)\s*=$/i.test(prefix);
  if (header || lineValue || /^digest\s/i.test(tail) || (plainName && /(?:=>|->|,)$/.test(prefix))) {
    const newline = text.indexOf("\n", start);
    return [header ? hit.index : start, Math.max(newline < 0 ? text.length : newline, span?.[1] ?? start)];
  }
  if (plainName && !/^[\\"'\[{]/.test(tail)) {
    const size = /^[^\s&;]*/.exec(tail)![0].length;
    let end = Math.max(start + size, span?.[1] ?? start);
    if (/^[ \t]/.test(text.slice(end)) && !/\?\S*$/.test(text.slice(0, hit.index))) {
      const rest = text.slice(end).split(/[;&\n]/, 1)[0];
      const next = rest.search(credentialName);
      end += rest.slice(0, next < 0 ? rest.length : next).trimEnd().length;
    }
    return [start, end];
  }
  return span;
}

function isTimestamp(number: string) {
  if (!/^[0-9]{13}$/.test(number)) return false;
  const seconds = Number(number.slice(0, 10));
  if (seconds < 1577836800 || seconds > 2082758399) return false;
  // All other 13–19 digit candidates are already masked by the numeric rule.
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    const digit = Number(number[i]) * (i % 2 + 1);
    sum += digit > 9 ? digit - 9 : digit;
  }
  if (sum % 10 === 0) return false;
  if (!/[1-8]/.test(number[6])) return true;
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


export function maskText(value: string): string {
  let end = 0, count = 0;
  for (const ch of value) {
    if (count++ === 2000) break;
    end += ch.length;
  }
  const truncated = end < value.length;
  const normalized = [...normalizeText(value.slice(0, end))];
  const clipped = truncated || normalized.length > 2000;
  const text = normalized.slice(0, 2000).join("").replace(/(?<![A-Za-z0-9_.:-])([A-Za-z0-9_.:-]*)((?:\/[A-Za-z0-9_.{}:=-]+)+)/g, (match: string, prefix: string, path: string) => {
    if (/^[0-9._-]+$/.test(prefix) && /^[0-9/]+$/.test(path)) return match;
    return prefix + path.split("/").map(part => /^[0-9]+$|^[a-z0-9]{16,}$/i.test(part) || uuidSegment.test(part) ? ":id" : part).join("/");
  });
  const spans: Span[] = [];
  const lineValues = /(?<![A-Za-z0-9_])(?:set-cookie|cookie|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday)[ \t]*=([^>\n][^\n]*)/gi;
  for (const hit of text.matchAll(lineValues)) {
    const end = hit.index + hit[0].length;
    spans.push([end - hit[1].length, end]);
  }
  const pairs = new RegExp(credentialName);
  let match: RegExpExecArray | null;
  while ((match = pairs.exec(text)) !== null) {
    const key = pairKey(match[0]);
    const start = match.index + match[0].length;
    if (match[0].trimEnd().endsWith(":") && ((/^(?:http|https)$/.test(key) && text.startsWith("//", start)) || /(?:bearer|cookie|authorization):\s*$/i.test(match[0]) && /^(?:bearer|.*[^\x00-\x7f](?:bearer|cookie|authorization))$/i.test(key))) continue;
    if (match[0].trimEnd().endsWith(",") && (!/^\s*$/.test(text.slice(Math.max(0,match.index-1),match.index)) || /^[0-9]/.test(key))) continue;
    const span = credentialSpan(text, match);
    if (span && span[1] > span[0]) {
      pairs.lastIndex = span[1];
      spans.push(span);
    }
  }
  for (const pattern of [...privatePatterns, numeric]) {
    for (const m of text.matchAll(pattern)) {
      if (pattern !== numeric || !isTimestamp(m[0])) spans.push([m.index, m.index + m[0].length]);
    }
  }
  const result = redact(text, spans).replace(/^\?[^\n]+|\?\S+/gm, "?[가림]");
  return [...result].slice(0, clipped ? 295 : 300).join("") + (clipped ? "…[잘림]" : "");
}

const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const uuidSegment = new RegExp("^(?:" + uuid + "|\\{" + uuid + "\\}|urn:uuid:" + uuid + ")$", "i");

function opaqueSegment(part: string): boolean {
  if (/\d{9}/.test(part)) return true;
  return part.length >= 16 && /^[a-z0-9_-]+={0,2}$/i.test(part) && (
    part.endsWith("=") || /^[a-z0-9]+$/i.test(part) || /\d/.test(part) ||
    (/[A-Z]/.test(part) && /[a-z]/.test(part))
  );
}

export function sanitizeRoute(value: string): string {
  return normalizeText(value).split(/[?#]/, 1)[0].split("/").map(segment => {
    const part = segment.split(";", 1)[0];
    return /^\d+$/.test(part) || uuidSegment.test(part) ||
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

function safeDiagnostic(value: string) {
  const prefixedToken = /(?:^|[._ -])(?:(?:gh[pos]_|AKIA|ASIA|AIza)[A-Za-z0-9_-]{12}|github_pat_[A-Za-z0-9_-]{5}|xox[abpr]-[A-Za-z0-9_-]{11}|sk-[A-Za-z0-9_-]{13}|glpat-[A-Za-z0-9_-]{10})/;
  const opaque = value.split(/[._ -]/).some(part => part.length >= 16 && (
    /[0-9]/.test(part) || (/[A-Z]/.test(part) && /[a-z]/.test(part) &&
      (!/^[a-z]*([A-Z]+[a-z]+)+[A-Z]*$/.test(part) || /(?:[A-Z][a-z]){3}/.test(part)))
  ));
  return !opaque && !prefixedToken.test(value) && privatePatterns.every(pattern => value.search(pattern) < 0)
    && [...value.matchAll(numeric)].every(match => isTimestamp(match[0]));
}

export function errorName(raw?: string | null) {
  const name = raw?.split(/[: \t\n\r]/, 1)[0];
  return name && name.length <= 60 && /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    && /(?:Error|Exception|Fault)$/.test(name) && safeDiagnostic(name) ? name : null;
}

export function errorKind(raw?: string | null) {
  return raw && raw.length <= 80 && !/[^A-Za-z0-9_.-]|\d{4}/.test(raw) && safeDiagnostic(raw) ? raw : null;
}

export function stepName(raw?: string | null) {
  return raw?.trim() && (!raw.includes(" ") || /[가-힣]/.test(raw)) && raw.length <= 40 && !/[^A-Za-z0-9_.가-힣 -]|\d{3}/.test(raw) && safeDiagnostic(raw) ? raw : null;
}
