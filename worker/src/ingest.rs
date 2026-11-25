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
static PRIVATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?i)(?-u:\b)(?:set-cookie|cookie)[ \t]*:[^\r\n]*",
        r"|(?-u:\b)bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;]+",
        r"|(?-u:\b)basic[ \t]+(?-iu:[A-Za-z0-9+/]{14,}==|[A-Za-z0-9+/]{15,}=|[A-Za-z0-9+/]{16,})",
        r"|(?:sp_pub_|sp_srv_|sb_secret_|sb_publishable_|(?-u:\b)eyJ)[a-z0-9_.=\-]+",
        r"|[a-z0-9._%+\-]+(?:@|%40)[a-z0-9.\-]+\.[a-z]{2,}",
    ))
    .expect("static redaction patterns")
});

static SHORT_KEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i-u:sk_|pk_|rk_)[A-Za-z0-9_]{16,}").expect("short key pattern")
});
static NAMED_SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i-u:[A-Za-z0-9_-]*(?:token|key|secret|password|passwd|pwd))[ \t]*[=:][ \t]*([^&\s,;#]+)")
        .expect("credential value")
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

#[derive(Deserialize)]
struct Batch {
    spec: String,
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
        || token.bytes().all(|b| b.is_ascii_hexdigit())
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
    static PHONE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\+?[0-9](?:[ ().\-]*[0-9]){8,14}").expect("phone pattern"));
    let bytes = text.as_bytes();
    let mut cursor = 0;
    std::iter::from_fn(move || {
        loop {
            let hit = PHONE.find_at(text, cursor)?;
            let (start, mut end) = (hit.start(), hit.end());
            if start == 0 || !bytes[start - 1].is_ascii_digit() {
                if bytes.get(end).is_some_and(u8::is_ascii_digit) {
                    // The last digit group continues beyond the limit. Try the preceding group.
                    while end > start && bytes[end - 1].is_ascii_digit() {
                        end -= 1;
                    }
                    while end > start && !bytes[end - 1].is_ascii_digit() {
                        end -= 1;
                    }
                    if bytes[start..end]
                        .iter()
                        .filter(|b| b.is_ascii_digit())
                        .count()
                        < 9
                    {
                        end = start;
                    }
                }
                if end > start {
                    cursor = end;
                    return Some(start..end);
                }
            }
            // Skip the rejected start, retaining later candidates after punctuation or whitespace.
            cursor = start + 1;
            if bytes[start].is_ascii_digit() {
                while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
                    cursor += 1;
                }
            }
        }
    })
}
fn private_segment(part: &str) -> bool {
    if phones(part).next().is_some() || (part.contains([':', '=']) && NAMED_SECRET.is_match(part)) {
        return true;
    }
    if !part.is_ascii() || part.contains(['_', '=', '@', '%']) {
        return PRIVATE.is_match(part) || short_keys(part).next().is_some();
    }
    // These legacy patterns also match route segments without the four markers.
    static OTHER: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
        r"(?i)(?-u:\b)(?:set-cookie|cookie)[ \t]*:|(?-u:\b)bearer(?:[ \t]*:[ \t]*|[ \t]+)[^\s,;]+",
        r"|(?-u:\b)basic[ \t]+[a-z0-9+/]{16,}|(?-u:\b)eyj[a-z0-9_.=\-]+",
    )).expect("ASCII route patterns")
    });
    OTHER.is_match(part)
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
fn mask(text: &str) -> String {
    let normalized = normalize(text);
    let mut short = short_keys(&normalized).peekable();
    let mut phone = phones(&normalized).peekable();
    let mut values = normalized
        .contains([':', '='])
        .then(|| NAMED_SECRET.captures_iter(&normalized))
        .into_iter()
        .flatten()
        .map(|caps| caps.get(1).unwrap().range())
        .peekable();
    if short.peek().is_none() && phone.peek().is_none() && values.peek().is_none() {
        return PRIVATE
            .replace_all(&normalized, regex::NoExpand("[가림]"))
            .chars()
            .take(300)
            .collect();
    }
    let mut main = PRIVATE.find_iter(&normalized).map(|m| m.range()).peekable();
    let mut end = 0;
    let mut result = String::new();
    loop {
        let first = [main.peek(), short.peek(), phone.peek(), values.peek()]
            .into_iter()
            .flatten()
            .map(|r| r.start)
            .min();
        let Some(start) = first else { break };
        let span = if main.peek().is_some_and(|r| r.start == start) {
            main.next()
        } else if short.peek().is_some_and(|r| r.start == start) {
            short.next()
        } else if values.peek().is_some_and(|r| r.start == start) {
            values.next()
        } else {
            phone.next()
        }
        .unwrap();
        if span.start >= end {
            result.push_str(&normalized[end..span.start]);
            result.push_str("[가림]");
        }
        end = end.max(span.end);
    }
    result.push_str(&normalized[end..]);
    result.chars().take(300).collect()
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
        batch.spec == "sp-1"
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
    let rpc = json!({"app_key_hash":hash,"payload":{
        "batch_id":batch.batch_id,"app_version":batch.app_version,"platform":batch.platform,"sent_at":batch.sent_at,
        "stats":stats,"attempts":attempts,"error_samples":samples
    }});
    Ok((
        serde_json::to_vec(&rpc).map_err(|_| ApiError::Invalid)?,
        counters,
    ))
}
