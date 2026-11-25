use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::LazyLock};
use uuid::Uuid;

pub const MAX_BYTES: usize = 65536;
const BOUNDS: [u32; 15] = [
    50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 30000,
];
static PRIVATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)bearer[ \t]+[^\s,;]+|sk_[a-z0-9_.\-]+|eyJ[a-z0-9_.=\-]+|[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}|\+?\d(?:[ ().\-]*\d){8,14}"
).unwrap()
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
    records: Vec<Value>,
}
#[derive(Deserialize)]
struct Record {
    ts: DateTime<Utc>,
    #[serde(flatten)]
    data: Data,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Data {
    Request {
        route: String,
        method: String,
        status: u16,
        duration_ms: u32,
        error_kind: Option<String>,
        error_message: Option<String>,
    },
    AttemptStart {
        feature_key: String,
        attempt_id: Uuid,
    },
    AttemptResult {
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
fn route(path: &str) -> String {
    path.split(['?', '#'])
        .next()
        .unwrap_or("")
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
        .join("/")
}
fn mask(text: &str) -> String {
    PRIVATE
        .replace_all(text, "[가림]")
        .chars()
        .take(300)
        .collect()
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
pub fn prepare(header: &str, body: &[u8], now_ms: i64) -> Result<(Vec<u8>, Counts), ApiError> {
    let key = credential(header)?;
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
    let mut groups = BTreeMap::<(i64, String, String), Stats>::new();
    let mut attempts = Vec::new();
    let mut samples = Vec::new();
    for value in batch.records {
        let Record { ts, data } = serde_json::from_value(value).map_err(|_| ApiError::Invalid)?;
        let stale = ts.timestamp_millis().abs_diff(now_ms) > 86_400_000;
        match data {
            Data::Request {
                route: path,
                method,
                status,
                duration_ms,
                error_kind,
                error_message,
            } => {
                require(
                    path.starts_with('/')
                        && bounded(&path, 200)
                        && bounded(&method, 32)
                        && method.bytes().all(|b| b.is_ascii_uppercase() || b == b'-')
                        && (status == 0 || (100..600).contains(&status))
                        && duration_ms <= 600000
                        && valid_kind(&error_kind),
                )?;
                if !stale {
                    let path = route(&path);
                    let client = (400..500).contains(&status);
                    let failed = !client && (status == 0 || status >= 500 || error_kind.is_some());
                    if (failed || client) && (error_message.is_some() || error_kind.is_some()) {
                        samples.push(json!({"route":path,"method":method,"at":ts,"error_kind":error_kind.as_deref().map(mask),"message":error_message.as_deref().map(mask)}));
                    }
                    let row = groups
                        .entry((ts.timestamp().div_euclid(300) * 300, method, path))
                        .or_default();
                    row.total += 1;
                    row.failures += u32::from(failed);
                    row.client_errors += u32::from(client);
                    row.duration_sum_ms += u64::from(duration_ms);
                    row.hist[BOUNDS.partition_point(|bound| *bound < duration_ms)] += 1;
                }
            }
            Data::AttemptStart {
                feature_key,
                attempt_id,
            } => {
                require(!feature_key.trim().is_empty())?;
                if !stale {
                    attempts.push(json!({"type":"attempt_start","feature_key":feature_key,"attempt_id":attempt_id,"ts":ts}));
                }
            }
            Data::AttemptResult {
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
                if !stale {
                    attempts.push(json!({"type":"attempt_result","feature_key":feature_key,"attempt_id":attempt_id,"ts":ts,"source":source,"result":result,"step":step.as_deref().map(mask),"error_kind":error_kind.as_deref().map(mask),"error_message":error_message.as_deref().map(mask)}));
                }
            }
        }
        if stale {
            counters.dropped += 1
        } else {
            counters.accepted += 1
        }
    }
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
    let rpc = json!({"app_key_hash":format!("{:x}",Sha256::digest(key.as_bytes())),"payload":{
        "batch_id":batch.batch_id,"app_version":batch.app_version,"platform":batch.platform,"sent_at":batch.sent_at,
        "stats":stats,"attempts":attempts,"error_samples":samples
    }});
    Ok((
        serde_json::to_vec(&rpc).map_err(|_| ApiError::Invalid)?,
        counters,
    ))
}
