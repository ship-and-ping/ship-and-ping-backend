use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{borrow::Cow, collections::BTreeMap, sync::LazyLock};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub const MAX_BYTES: usize = 65536;
const BOUNDS: [u32; 15] = [
    50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 30000,
];
static PRIVATE: LazyLock<Vec<Regex>> =
    LazyLock::new(|| {
        [
        r"(?-u:\b)(?:set-cookie|cookie|authorization)[ \t]*:[^\r\n]*",
        r#"(?-u:\b)bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;&#"']+"#,
        r"(?-u:\b)basic[ \t]+(?-iu:[A-Za-z0-9+/]{14,}==|[A-Za-z0-9+/]{15,}=|[A-Za-z0-9+/]{16,})",
        r"(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|(?-u:\b)eyJ)[a-z0-9_.=\-]+",
        r"[a-z0-9._%+\-]+(?:@|%40)[a-z0-9.\-]+\.[a-z]{2,}",
    ].iter().map(|pattern| Regex::new(&format!("(?i){pattern}")).unwrap()).collect()
    });

static SHORT_KEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i-u:sk_|pk_|rk_)[A-Za-z0-9_]{16,}").expect("short key pattern")
});
static CREDENTIAL_NAME: LazyLock<Regex> = LazyLock::new(|| {
    let name = r"(?:(?i-u:(?:user|account|member|customer|session)[_-]?id|uid|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday)|[A-Za-z0-9_-]*(?:(?i:token|secret|password|passwd|pwd|credential|authorization|cookie|privatekey|accesskey|secretkey|apikey|clientkey|authkey|sessionkey|signingkey|encryptionkey|masterkey)|K[eE][yY]|kE[yY]|keY|[A-Z0-9_-]key)[A-Za-z0-9_-]*|keys?(?:[_-][A-Za-z0-9_-]+)?|key[A-Z0-9][A-Za-z0-9_-]*)";
    Regex::new(&format!(
        r#"(?:\\*["']{name}\\*["']|{name})\s*(?:=>|->|,|:|=|%3[aAdD])\s*"#
    ))
    .unwrap()
});
static BARE_VALUE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)^(?:(?:bearer|basic|token|apikey|digest)(?:[ \t]*:[ \t]*|[ \t]+)[^\s;&]+|(?:\[가림\]|\\[^"\s]|[^"'\\\s,;&#])(?:[^\s,;}\]&#]|[}\]]+[^\s,;}\]&#])*)"#).unwrap()
});

#[derive(Debug, PartialEq)]
pub enum ApiError {
    Invalid,
    Unauthorized,
    TooLarge,
}
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Counts {
    pub accepted: usize,
    pub dropped: usize,
}

#[cfg(test)]
mod sanitize_budget {
    use super::mask;
    use std::time::{Duration, Instant};

    #[test]
    fn adversarial_64k_lines() {
        let _ = mask("Cookie: warm up all patterns");
        for unit in [
            "token=x ",
            "Cookie: a=b ",
            "1234567890 ",
            "token=inside ",
            "가",
        ] {
            let input: String = unit
                .chars()
                .cycle()
                .take(65536 / unit.chars().next().unwrap().len_utf8())
                .collect();
            let input = if unit == "token=inside " {
                format!("token=\"{}", &input[..65529])
            } else {
                input
            };
            let start = Instant::now();
            let output = mask(&input);
            let elapsed = start.elapsed();
            eprintln!("{unit:?} {elapsed:?}");
            assert!(output.ends_with("…[잘림]") && output.chars().count() <= 300);
            assert!(
                elapsed < Duration::from_millis(if cfg!(debug_assertions) { 100 } else { 10 }),
                "{elapsed:?}"
            );
        }
    }
}

#[derive(Deserialize)]
struct Batch {
    spec: String,
    app_id: Option<serde::de::IgnoredAny>,
    batch_id: Uuid,
    app_version: String,
    platform: String,
    sent_at: DateTime<Utc>,
    records: Vec<Box<serde_json::value::RawValue>>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Data {
    Request {
        ts: DateTime<Utc>,
        route: String,
        method: String,
        status: u16,
        duration_ms: u32,
        error_kind: Option<String>,
        error_message: Option<String>,
    },
    AttemptStart {
        ts: DateTime<Utc>,
        feature_key: String,
        attempt_id: Uuid,
    },
    AttemptResult {
        ts: DateTime<Utc>,
        feature_key: String,
        attempt_id: Uuid,
        result: String,
        source: String,
        step: Option<String>,
        error_kind: Option<String>,
        error_message: Option<String>,
    },
}
#[derive(Default, Serialize)]
struct Stats {
    total: u32,
    failures: u32,
    client_errors: u32,
    duration_sum_ms: u64,
    hist: [u32; 16],
    // Transient inputs for DB-side aggregation with the feature's current threshold.
    timings: Vec<(usize, u32, Option<bool>)>,
}

fn require(ok: bool) -> Result<(), ApiError> {
    ok.then_some(()).ok_or(ApiError::Invalid)
}
fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
}
fn valid_kind(kind: &Option<String>) -> bool {
    kind.as_ref().is_none_or(|s| bounded(s, 80))
}
fn clean_char(c: char) -> Option<char> {
    match c {
        '\u{00ad}'
        | '\u{061c}'
        | '\u{200b}'..='\u{200f}'
        | '\u{202a}'..='\u{202e}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{2069}'
        | '\u{feff}' => None,
        '\r' | '\x0b' | '\x0c' | '\u{0085}' | '\u{2028}' | '\u{2029}' => Some('\n'),
        _ => Some(c),
    }
}
fn normalize(text: &str) -> Cow<'_, str> {
    if unicode_normalization::is_nfkc_quick(text.chars())
        == unicode_normalization::IsNormalized::Yes
        && text.chars().all(|c| clean_char(c) == Some(c))
    {
        return Cow::Borrowed(text);
    }
    Cow::Owned(text.nfkc().filter_map(clean_char).collect())
}

fn opaque_segment(part: &str) -> bool {
    static NUMERIC_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new("[0-9]{9}").unwrap());
    if NUMERIC_ID.is_match(part) {
        return true;
    }
    let token = part.trim_end_matches('=');
    if part.len() < 16
        || token.is_empty()
        || part.len() - token.len() > 2
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return false;
    }
    part != token
        || token.bytes().all(|b| b.is_ascii_alphanumeric())
        || token.bytes().any(|b| b.is_ascii_digit())
        || (token.bytes().any(|b| b.is_ascii_uppercase())
            && token.bytes().any(|b| b.is_ascii_lowercase()))
}

fn route(path: &str) -> String {
    path.split('/')
        .map(|part| {
            let part = part.split(';').next().unwrap_or_default();
            if !part.is_empty()
                && (part.bytes().all(|b| b.is_ascii_digit())
                    || Uuid::try_parse(part).is_ok()
                    || private_segment(part)
                    || opaque_segment(part))
            {
                ":id"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}
fn boundary(text: &str, start: usize) -> bool {
    start == 0 || !text.as_bytes()[start - 1].is_ascii_alphanumeric()
}
fn phones(text: &str) -> impl Iterator<Item = std::ops::Range<usize>> + '_ {
    static PHONE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\+?\(?[0-9](?:[ ()./_\t֊־᐀᠆‐‑‒–—―⸗⸚⸺⸻⹀⹝〜〰゠︱︲﹘﹣－𐵮𐺭−-]*[0-9]){8,}\)?")
            .expect("numeric sequence")
    });
    PHONE.find_iter(text).filter_map(|hit| {
        let value = hit.as_str();
        let timestamp = value.len() == 13
            && value.bytes().all(|b| b.is_ascii_digit())
            && (1577836800..=2082758399).contains(&value[..10].parse::<u64>().unwrap())
            && !(value
                .bytes()
                .enumerate()
                .map(|(i, c)| {
                    let n = u32::from(c - b'0') * (1 + i as u32 % 2);
                    if n > 9 { n - 9 } else { n }
                })
                .sum::<u32>()
                % 10
                == 0)
            && !(matches!(value.as_bytes()[6], b'1'..=b'8')
                && chrono::NaiveDate::from_ymd_opt(
                    2000 + value[..2].parse::<i32>().unwrap(),
                    value[2..4].parse().unwrap(),
                    value[4..6].parse().unwrap(),
                )
                .is_some());
        (!timestamp).then(|| hit.range())
    })
}
fn credential_names(text: &str) -> impl Iterator<Item = regex::Match<'_>> {
    CREDENTIAL_NAME.find_iter(text).filter(|m| {
        m.as_str().starts_with(['\\', '"', '\''])
            || m.start() == 0
            || !matches!(text.as_bytes()[m.start() - 1], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_')
    })
}
fn private_segment(part: &str) -> bool {
    phones(part).next().is_some()
        || credential_names(part).next().is_some()
        || PRIVATE.iter().any(|p| p.is_match(part))
        || short_keys(part).next().is_some()
}
fn short_keys(text: &str) -> impl Iterator<Item = std::ops::Range<usize>> + '_ {
    SHORT_KEY.find_iter(text).filter_map(move |hit| {
        if boundary(text, hit.start()) {
            return Some(hit.range());
        }
        // A rejected match can contain a valid prefix after an underscore.
        let bytes = text.as_bytes();
        (hit.start() + 3..=hit.end() - 19)
            .find(|&i| {
                boundary(text, i)
                    && [b"sk_", b"pk_", b"rk_"]
                        .iter()
                        .any(|prefix| bytes[i..i + 3].eq_ignore_ascii_case(*prefix))
            })
            .map(|start| start..hit.end())
    })
}
fn mask_version(version: String) -> String {
    static KEY: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_)[a-z0-9_.=\-]+")
            .expect("version key prefixes")
    });
    let normalized = normalize(&version);
    let mut spans: Vec<_> = KEY
        .find_iter(&normalized)
        .map(|m| m.range())
        .chain(short_keys(&normalized))
        .collect();
    if spans.is_empty() {
        return version;
    }
    spans.sort_by_key(|span| span.start);
    let mut result = String::new();
    let mut end = 0;
    for span in spans {
        if end <= span.start {
            result.push_str(&normalized[end..span.start]);
            result.push_str("[가림]");
        }
        end = end.max(span.end);
    }
    result.push_str(&normalized[end..]);
    result.chars().take(64).collect()
}
fn value_span(text: &str, start: usize, key_escapes: usize) -> Option<std::ops::Range<usize>> {
    let bytes = text.as_bytes();
    let escapes = bytes[start..].iter().take_while(|&&c| c == b'\\').count();
    if let Some(&quote @ (b'"' | b'\'')) = bytes.get(start + escapes) {
        let body = start + escapes + 1;
        let mut slashes = 0;
        for (index, &c) in bytes.iter().enumerate().skip(body) {
            if c == quote && slashes % (2 * (escapes + 1)) == escapes {
                return Some(body..index - escapes);
            }
            slashes = if c == b'\\' { slashes + 1 } else { 0 };
        }
        return Some(body..bytes.len());
    }
    if let Some(&open @ (b'[' | b'{')) = bytes.get(start) {
        let close = if open == b'[' { b']' } else { b'}' };
        let mut depth = 0;
        let mut quote = None;
        let mut slashes = 0;
        for (index, &c) in bytes.iter().enumerate().skip(start) {
            let delimiter =
                matches!(c, b'"' | b'\'') && slashes % (2 * (key_escapes + 1)) == key_escapes;
            if delimiter && quote == Some(c) {
                quote = None;
            } else if delimiter && quote.is_none() {
                quote = Some(c);
            } else if quote.is_none() && c == open {
                depth += 1;
            } else if quote.is_none() && c == close {
                depth -= 1;
                if depth == 0 {
                    return Some(start..index + 1);
                }
            }
            slashes = if c == b'\\' { slashes + 1 } else { 0 };
        }
        return Some(start..bytes.len());
    }
    BARE_VALUE
        .find(&text[start..])
        .map(|m| start..start + m.end())
}

fn credential_span(text: &str, hit: regex::Match<'_>) -> Option<std::ops::Range<usize>> {
    let prefix = hit.as_str().trim_end();
    let start = hit.end();
    let key_escapes = prefix.bytes().take_while(|&c| c == b'\\').count();
    let span = value_span(text, start, key_escapes);
    let header = !prefix.starts_with(['\\', '"', '\'']) && prefix.ends_with(':');
    let tail = &text[start..];
    if prefix.ends_with("%3A") || prefix.ends_with("%3a") {
        let end = start + tail.find(['&', '\n']).unwrap_or(tail.len());
        return Some(start..end.max(span.map_or(start, |r| r.end)));
    }
    let digest = tail
        .get(..6)
        .is_some_and(|s| s.eq_ignore_ascii_case("digest"))
        && tail.as_bytes().get(6).is_some_and(u8::is_ascii_whitespace);
    let line_value = prefix.strip_suffix('=').is_some_and(|key| {
        matches!(
            key.trim_end().to_ascii_lowercase().as_str(),
            "cookie"
                | "set-cookie"
                | "name"
                | "full_name"
                | "full-name"
                | "fullname"
                | "username"
                | "email"
                | "phone"
                | "mobile"
                | "tel"
                | "address"
                | "addr"
                | "birth"
                | "birthday"
        )
    });
    if header
        || line_value
        || digest
        || (!prefix.starts_with(['\\', '"', '\''])
            && (prefix.ends_with("=>") || prefix.ends_with("->") || prefix.ends_with(',')))
    {
        let line_end = start + tail.find('\n').unwrap_or(tail.len());
        return Some(
            (if header { hit.start() } else { start })..line_end.max(span.map_or(start, |r| r.end)),
        );
    }
    if !prefix.starts_with(['\\', '"', '\'']) && !tail.starts_with(['\\', '"', '\'', '[', '{']) {
        let end = start
            + tail
                .find(|c: char| c.is_whitespace() || matches!(c, '&' | ';'))
                .unwrap_or(tail.len());
        return Some(start..end.max(span.map_or(start, |r| r.end)));
    }
    span
}

fn message_paths(text: &str) -> Cow<'_, str> {
    static PATH: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[A-Za-z0-9_.:-]*(?:/[A-Za-z0-9_.{}:=-]+)+").unwrap());
    PATH.replace_all(text, |caps: &regex::Captures<'_>| {
        let hit = caps.get(0).unwrap();
        // Leave slash-separated phones to the numeric pass.
        let (prefix, path) = hit.as_str().split_once('/').unwrap();
        if !prefix.is_empty()
            && prefix
                .bytes()
                .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'_'))
            && path.bytes().all(|b| b.is_ascii_digit() || b == b'/')
        {
            return hit.as_str().to_owned();
        }
        let path = path
            .split('/')
            .map(|part| {
                if !part.is_empty()
                    && (part.bytes().all(|b| b.is_ascii_digit())
                        || Uuid::try_parse(part).is_ok()
                        || (part.len() >= 16 && part.bytes().all(|b| b.is_ascii_alphanumeric())))
                {
                    ":id"
                } else {
                    part
                }
            })
            .collect::<Vec<_>>()
            .join("/");
        format!("{prefix}/{path}")
    })
}

pub(crate) fn mask(text: &str) -> String {
    static QUERY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?m)^\?[^\n]+|\?\S+"#).unwrap());
    let cutoff = text.char_indices().nth(2000).map(|(pos, _)| pos);
    let normalized = normalize(&text[..cutoff.unwrap_or(text.len())]);
    let text = message_paths(&normalized);
    let mut spans: Vec<_> = PRIVATE
        .iter()
        .flat_map(|p| p.find_iter(&text).map(|m| m.range()))
        .chain(short_keys(&text))
        .chain(phones(&text))
        .collect();
    // An assignment inside another bare value can outlive that value's semicolon.
    static LINE_VALUE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
        r"(?i-u:\b(?:set-cookie|cookie|name|full[_-]?name|username|email|phone|mobile|tel|address|addr|birth|birthday))[ \t]*=([^>\n][^\n]*)"
    ).unwrap()
    });
    spans.extend(
        LINE_VALUE
            .captures_iter(&text)
            .map(|hit| hit.get(1).unwrap().range()),
    );
    let mut cursor = 0;
    for hit in credential_names(&text) {
        if hit.start() >= cursor
            && let Some(span) = credential_span(&text, hit)
        {
            cursor = span.end;
            spans.push(span);
        }
    }
    spans.sort_by_key(|r| r.start);
    let mut result = String::new();
    let mut end = 0;
    for span in spans {
        if span.is_empty() {
            continue;
        }
        if span.start >= end {
            result.push_str(&text[end..span.start]);
            result.push_str("[가림]");
        }
        end = end.max(span.end);
    }
    result.push_str(&text[end..]);
    let result = QUERY.replace_all(&result, "?[가림]");
    if cutoff.is_some() {
        result.chars().take(295).chain("…[잘림]".chars()).collect()
    } else {
        result.chars().take(300).collect()
    }
}
pub fn credential(header: &str) -> Result<&str, ApiError> {
    let key = header
        .strip_prefix("Bearer ")
        .ok_or(ApiError::Unauthorized)?;
    let suffix = key
        .strip_prefix("sp_pub_")
        .or_else(|| key.strip_prefix("sp_srv_"))
        .ok_or(ApiError::Unauthorized)?;
    if suffix.is_empty()
        || !suffix
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err(ApiError::Unauthorized);
    }
    Ok(key)
}
#[derive(Default)]
struct Aggregate {
    groups: BTreeMap<(i64, String, String), Stats>,
    attempts: Vec<Value>,
    samples: Vec<Value>,
}

impl Aggregate {
    fn add(
        &mut self,
        value: &serde_json::value::RawValue,
        now_ms: i64,
        key: &str,
        position: usize,
    ) -> Result<(), ApiError> {
        let data: Data = serde_json::from_str(value.get()).map_err(|_| ApiError::Invalid)?;
        let ts = match &data {
            Data::Request { ts, .. }
            | Data::AttemptStart { ts, .. }
            | Data::AttemptResult { ts, .. } => *ts,
        };
        require(ts.timestamp_millis().abs_diff(now_ms) <= 86_400_000)?;
        match data {
            Data::Request {
                ts: _,
                route: path,
                method,
                status,
                duration_ms,
                error_kind,
                error_message,
            } => {
                let path = clean_route(&path)?;
                require(
                    valid_method(&method)
                        && (status == 0 || (100..600).contains(&status))
                        && duration_ms <= 600000
                        && valid_kind(&error_kind),
                )?;
                let client = (400..500).contains(&status);
                let failed = !client && (status == 0 || status >= 500 || error_kind.is_some());
                if (failed || client) && (error_message.is_some() || error_kind.is_some()) {
                    self.samples.push(json!({"route":path,"method":method,"at":ts,"error_kind":error_kind.as_deref().map(mask),"message":error_message.as_deref().map(mask)}));
                }
                let row = self
                    .groups
                    .entry((ts.timestamp().div_euclid(300) * 300, method, path))
                    .or_default();
                row.total += 1;
                row.failures += u32::from(failed);
                row.client_errors += u32::from(client);
                row.duration_sum_ms += u64::from(duration_ms);
                row.hist[BOUNDS.partition_point(|bound| *bound < duration_ms)] += 1;
                row.timings
                    .push((position, duration_ms, (!client).then_some(!failed)));
            }
            Data::AttemptStart {
                ts: _,
                feature_key,
                attempt_id,
            } => {
                require(!feature_key.trim().is_empty())?;
                self.attempts.push(json!({"type":"attempt_start","feature_key":feature_key,"attempt_id":attempt_id,"ts":ts}));
            }
            Data::AttemptResult {
                ts: _,
                feature_key,
                attempt_id,
                result,
                source,
                step,
                error_kind,
                error_message,
            } => {
                require(
                    !feature_key.trim().is_empty()
                        && valid_kind(&error_kind)
                        && matches!(result.as_str(), "success" | "failure" | "abandon")
                        && (source == "browser"
                            || (source == "server" && key.starts_with("sp_srv_"))),
                )?;
                self.attempts.push(json!({"type":"attempt_result","feature_key":feature_key,"attempt_id":attempt_id,"ts":ts,"source":source,"result":result,"step":step.as_deref().map(mask),"error_kind":error_kind.as_deref().map(mask),"error_message":error_message.as_deref().map(mask)}));
            }
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
struct Feature {
    route: String,
    method: String,
    name: String,
}
fn valid_method(method: &str) -> bool {
    bounded(method, 32) && method.bytes().all(|b| b.is_ascii_uppercase() || b == b'-')
}
fn clean_route(input: &str) -> Result<String, ApiError> {
    let normalized = normalize(input);
    let path = normalized.split(['?', '#']).next().unwrap_or_default();
    require(path.starts_with('/') && bounded(path, 200))?;
    Ok(route(path))
}

pub fn prepare_map(hash: &str, body: &[u8]) -> Result<(Vec<u8>, Counts), ApiError> {
    if body.len() > MAX_BYTES {
        return Err(ApiError::TooLarge);
    }
    let mut items: Vec<Feature> = serde_json::from_slice(body).map_err(|_| ApiError::Invalid)?;
    if items.len() > 200 {
        return Err(ApiError::TooLarge);
    }
    for item in &mut items {
        require(valid_method(&item.method) && bounded(&item.name, 300))?;
        item.route = clean_route(&item.route)?;
        item.name = mask(&item.name);
        require(bounded(&item.name, 300))?;
    }
    let counts = Counts {
        accepted: items.len(),
        dropped: 0,
    };
    let rpc = json!({"app_key_hash": hash, "items": items});
    Ok((
        serde_json::to_vec(&rpc).map_err(|_| ApiError::Invalid)?,
        counts,
    ))
}
pub fn key_hash(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}
pub fn prepare(header: &str, body: &[u8], now_ms: i64) -> Result<(Vec<u8>, Counts), ApiError> {
    let key = credential(header)?;
    prepare_ingest(key, &key_hash(key), body, now_ms)
}
pub fn prepare_ingest(
    key: &str,
    hash: &str,
    body: &[u8],
    now_ms: i64,
) -> Result<(Vec<u8>, Counts), ApiError> {
    if body.len() > MAX_BYTES {
        return Err(ApiError::TooLarge);
    }
    let batch: Batch = serde_json::from_slice(body).map_err(|_| ApiError::Invalid)?;
    if batch.records.len() > 100 {
        return Err(ApiError::TooLarge);
    }
    require(
        batch.app_id.is_none()
            && batch.spec == "sp-1"
            && bounded(&batch.app_version, 64)
            && matches!(batch.platform.as_str(), "server" | "browser"),
    )?;
    let mut counters = Counts::default();
    let mut aggregate = Aggregate::default();
    for (position, value) in batch.records.into_iter().enumerate() {
        if aggregate.add(&value, now_ms, key, position).is_ok() {
            counters.accepted += 1;
        } else {
            counters.dropped += 1;
        }
    }
    let Aggregate {
        groups,
        attempts,
        samples,
    } = aggregate;
    let stats: Vec<_> = groups
        .into_iter()
        .map(|((seconds, method, path), row)| {
            let mut value = json!(row);
            value["bucket"] = json!(DateTime::<Utc>::from_timestamp_secs(seconds));
            value["method"] = json!(method);
            value["route"] = json!(path);
            value
        })
        .collect();
    // Retain the release label for display validation unless it contains private data.
    let version = mask_version(batch.app_version);
    let rpc = json!({"app_key_hash":hash,"payload":{
        "batch_id":batch.batch_id,"app_version":version,"platform":batch.platform,"sent_at":batch.sent_at,
        "stats":stats,"attempts":attempts,"error_samples":samples
    }});
    Ok((
        serde_json::to_vec(&rpc).map_err(|_| ApiError::Invalid)?,
        counters,
    ))
}
