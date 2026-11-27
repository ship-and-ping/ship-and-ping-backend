use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{borrow::Cow, collections::BTreeMap, sync::LazyLock};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub const MAX_BYTES: usize = 65536;
const BOUNDS: [u32; 29] = [
    50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 3300, 3600, 3900, 4200, 4500, 4800, 5000,
    5100, 5400, 5700, 6000, 6300, 6600, 6900, 7200, 7500, 10000, 20000, 30000,
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
    Regex::new(r#"[/%]+\s*=>?\s*|(?:\\*"[^"\n]*?\\*"|\\*'[^'\n]*?\\*'|[^\s/\\%"'=:,;<>{}\[\]&?#]+?)\s*(?:=>|->|,|:|=|%3[aAdD])\s*"#).unwrap()
});
fn pair_key(prefix: &str) -> String {
    let prefix = prefix.trim_end();
    let key = ["%3D", "%3d", "%3a", "%3A", "=>", "->", ",", ":", "="]
        .iter()
        .find_map(|op| prefix.strip_suffix(op))
        .unwrap_or(prefix)
        .trim_end();
    let unescaped = key.trim_start_matches('\\');
    let key = if unescaped.starts_with(['"', '\'']) {
        let quote = unescaped.as_bytes()[0] as char;
        unescaped[1..]
            .strip_suffix(quote)
            .unwrap_or("")
            .trim_end_matches('\\')
    } else {
        key
    };
    key.to_ascii_lowercase().replace(['_', '-'], "")
}
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
    fn diagnostic_batch_budget() {
        let mut records: Vec<_> = (0..100).map(|i| {
            let message = ["first_name=x; 이름=y; statusCode=503 ", "stack={\"dob\":123,\"line\":42} ",
                "Cookie: sid=abc; path=/ ", "path=/users/42?session=raw ", "ﷺ "][i % 5].repeat(8);
            serde_json::json!({"error_message": message, "error_kind": "kind=timeout member_no=42",
                "step": "retry=1; login_id=sample"})
        }).collect();
        let size = serde_json::to_vec(&records).unwrap().len();
        for i in 0..100 {
            let extra = (65536 - size) / 100 + usize::from(i < (65536 - size) % 100);
            let message =
                records[i]["error_message"].as_str().unwrap().to_owned() + &"x".repeat(extra);
            records[i]["error_message"] = message.into();
        }
        assert_eq!(serde_json::to_vec(&records).unwrap().len(), 65536);
        mask("Cookie: warmup");
        let start = Instant::now();
        for record in records {
            std::hint::black_box(super::error_kind(record["error_kind"].as_str().unwrap()));
            std::hint::black_box(super::step_name(record["step"].as_str().unwrap()));
            std::hint::black_box(super::error_name(record["error_message"].as_str().unwrap()));
        }
        let elapsed = start.elapsed();
        eprintln!("65536 bytes, 100 records, 300 fields: {elapsed:?}");
        assert!(elapsed < Duration::from_millis(if cfg!(debug_assertions) { 500 } else { 50 }));

        let kind = "a_".repeat(40);
        let step = "가".repeat(40);
        let name = format!("{}Error", "pkg.".repeat(13) + "Abc");
        assert_eq!(name.len(), 60);
        let start = Instant::now();
        for _ in 0..100 {
            assert!(super::error_kind(std::hint::black_box(&kind)).is_some());
            assert!(super::step_name(std::hint::black_box(&step)).is_some());
            assert!(super::error_name(std::hint::black_box(&name)).is_some());
        }
        let elapsed = start.elapsed();
        eprintln!("100 records, 300 accepted maximum-length fields: {elapsed:?}");
        assert!(elapsed < Duration::from_millis(if cfg!(debug_assertions) { 500 } else { 50 }));
    }

    #[test]
    fn adversarial_64k_lines() {
        let expanded = "ﷺ".repeat(200);
        assert_eq!(
            mask(&expanded),
            super::normalize(&expanded)
                .chars()
                .take(295)
                .chain("…[잘림]".chars())
                .collect::<String>()
        );
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
    #[serde(rename = "hist_30", skip_serializing_if = "no_refined_samples")]
    hist: [u32; BOUNDS.len() + 1],
    // Transient inputs for DB-side aggregation with the feature's current threshold.
    timings: Vec<(usize, u32, Option<bool>)>,
}

fn no_refined_samples(hist: &[u32; BOUNDS.len() + 1]) -> bool {
    hist[10..26].iter().all(|&count| count == 0)
}

impl Stats {
    // Older databases always read hist. They ignore the optional hist_30 field.
    fn legacy_hist(&self) -> [u32; 16] {
        let mut compact = [0; 16];
        compact[..10].copy_from_slice(&self.hist[..10]);
        compact[10] = self.hist[10..17].iter().sum(); // (3000, 5000]
        compact[11] = self.hist[17..26].iter().sum(); // (5000, 7500]
        compact[12..].copy_from_slice(&self.hist[26..]);
        compact
    }
}

fn require(ok: bool) -> Result<(), ApiError> {
    ok.then_some(()).ok_or(ApiError::Invalid)
}
fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
}
fn opaque_diagnostic(value: &str) -> bool {
    static PREFIXED_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?:^|[._ -])(?:(?:gh[pos]_|AKIA|ASIA|AIza)[A-Za-z0-9_-]{12}|github_pat_[A-Za-z0-9_-]{5}|xox[abpr]-[A-Za-z0-9_-]{11}|sk-[A-Za-z0-9_-]{13}|glpat-[A-Za-z0-9_-]{10})").unwrap()
    });
    static CAMEL: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[a-z]*([A-Z]+[a-z]+)+[A-Z]*$").unwrap());
    static ALTERNATING: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?:[A-Z][a-z]){3}").unwrap());
    PREFIXED_TOKEN.is_match(value)
        || value.split(['.', '_', '-', ' ']).any(|part| {
            part.chars().count() >= 16
                && (part.bytes().any(|b| b.is_ascii_digit())
                    || (part.bytes().any(|b| b.is_ascii_uppercase())
                        && part.bytes().any(|b| b.is_ascii_lowercase())
                        && (!CAMEL.is_match(part) || ALTERNATING.is_match(part))))
        })
}

fn error_name(raw: &str) -> Option<String> {
    static NAME: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*[A-Za-z_$][A-Za-z0-9_$]*$").unwrap()
    });
    let name = raw.split([':', ' ', '\t', '\n', '\r']).next()?;
    (name.len() <= 60
        && ["Error", "Exception", "Fault"]
            .iter()
            .any(|s| name.ends_with(s))
        && NAME.is_match(name)
        && !opaque_diagnostic(name)
        && !private_segment(name))
    .then(|| name.to_owned())
}

fn error_kind(raw: &str) -> Option<String> {
    static DIGITS: LazyLock<Regex> = LazyLock::new(|| Regex::new("[0-9]{4}").unwrap());
    (!raw.is_empty()
        && raw.len() <= 80
        && raw
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        && !DIGITS.is_match(raw)
        && !opaque_diagnostic(raw)
        && !private_segment(raw))
    .then(|| raw.to_owned())
}

fn step_name(raw: &str) -> Option<String> {
    static STEP: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_.가-힣 -]{1,40}$").unwrap());
    static DIGITS: LazyLock<Regex> = LazyLock::new(|| Regex::new("[0-9]{3}").unwrap());
    (!raw.trim().is_empty()
        && (!raw.contains(' ') || raw.chars().any(|c| ('가'..='힣').contains(&c)))
        && STEP.is_match(raw)
        && !DIGITS.is_match(raw)
        && !opaque_diagnostic(raw)
        && !private_segment(raw))
    .then(|| raw.to_owned())
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
        let mut end = end.max(span.map_or(start, |r| r.end));
        if text[end..].starts_with([' ', '\t'])
            && !text[..hit.start()]
                .rsplit(char::is_whitespace)
                .next()
                .unwrap_or_default()
                .contains('?')
        {
            let rest = text[end..]
                .split([';', '&', '\n'])
                .next()
                .unwrap_or_default();
            let next = CREDENTIAL_NAME.find(rest).map_or(rest.len(), |m| m.start());
            end += rest[..next].trim_end().len();
        }
        return Some(start..end);
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
    let second_cut = normalized.char_indices().nth(2000).map(|(i, _)| i);
    let text = message_paths(&normalized[..second_cut.unwrap_or(normalized.len())]);
    let mut spans: Vec<_> = PRIVATE
        .iter()
        .flat_map(|p| p.find_iter(&text).map(|m| m.range()))
        .chain(short_keys(&text))
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
    while let Some(hit) = CREDENTIAL_NAME.find_at(&text, cursor) {
        cursor = hit.end();
        let prefix = hit.as_str().trim_end();
        let key = pair_key(prefix);
        if prefix.ends_with(':')
            && ((matches!(key.as_str(), "http" | "https") && text[hit.end()..].starts_with("//"))
                || key == "bearer"
                || ["bearer", "cookie", "authorization"].iter().any(|suffix| {
                    key.strip_suffix(suffix)
                        .and_then(|s| s.chars().last())
                        .is_some_and(|c| !c.is_ascii())
                }))
        {
            continue;
        }
        if prefix.ends_with(',')
            && (hit.as_str() == prefix
                || text[..hit.start()]
                    .chars()
                    .next_back()
                    .is_some_and(|c| !c.is_whitespace())
                || key.starts_with(|c: char| c.is_ascii_digit()))
        {
            continue;
        }
        if let Some(span) = credential_span(&text, hit) {
            cursor = span.end;
            spans.push(span);
        }
    }
    spans.extend(phones(&text));
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
    if cutoff.is_some() || second_cut.is_some() {
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
                        && duration_ms <= 600000,
                )?;
                let client = (400..500).contains(&status);
                let failed = !client && (status == 0 || status >= 500 || error_kind.is_some());
                if (failed || client) && (error_message.is_some() || error_kind.is_some()) {
                    self.samples.push(json!({"route":path,"method":method,"at":ts,"error_kind":error_kind.as_deref().and_then(self::error_kind),"message":error_message.as_deref().and_then(error_name)}));
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
                        && matches!(result.as_str(), "success" | "failure" | "abandon")
                        && (source == "browser"
                            || (source == "server" && key.starts_with("sp_srv_"))),
                )?;
                self.attempts.push(json!({"type":"attempt_result","feature_key":feature_key,"attempt_id":attempt_id,"ts":ts,"source":source,"result":result,"step":step.as_deref().and_then(step_name),"error_kind":error_kind.as_deref().and_then(self::error_kind),"error_message":error_message.as_deref().and_then(error_name)}));
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
    }
    let received = items.len();
    items.retain(|item| !item.name.trim().is_empty());
    let counts = Counts {
        accepted: items.len(),
        dropped: received - items.len(),
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
            value["hist"] = json!(row.legacy_hist());
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
