use super::{ApiError, Counts, MAX_BYTES, mask, require};
use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

fn encoded_text(s: &str) -> bool {
    s.len() >= 4
        && STANDARD_NO_PAD
            .decode(s)
            .is_ok_and(|bytes| bytes.iter().all(|b| (32..=126).contains(b)))
}

fn label(value: &Value, max: usize) -> bool {
    let Some(s) = value.as_str() else {
        return false;
    };
    // Keep these word and credential rules in sync with private.profile_label.
    static WORD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^(?:[가-힣]{1,16}|(?:[A-Z]?[a-z]{1,14}|[A-Z]{1,6})[0-9]{0,2}|[0-9]{1,2})$")
            .unwrap()
    });
    static KNOWN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
            r"^(?:Node\.js|Next\.js|Nuxt\.js|Vue\.js|\.NET|ASP\.NET|C\+\+|C#|JavaScript|TypeScript|",
            r"FastAPI|SQLAlchemy|PostgreSQL|MySQL|MongoDB|SQLite|GitHub|GitLab|Cloudflare|Kubernetes|",
            r"Spring|Boot|Framework|Actions|[가-힣]{1,16}|(?i-u:check|view|open|use|the|in|on|to|",
            r"from|previous|release|deploy|redeploy|rollback|version|server|hosting|dashboard|metrics|logs|console))$"
        ))
        .unwrap()
    });
    static CREDENTIAL: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(concat!(
            r"(?i-u)^(?:bearer|basic|[spr]k(?:$|[- ]|live|test)|glpat|xox[baprs]|githubpat|",
            r"gh[pousr](?:$|[- ])|spsrv|sppub|sbsecret|apikey|accesstoken|password|akia|asia[0-9]|aiza|eyj)"
        ))
        .unwrap()
    });
    static LONG: LazyLock<Regex> = LazyLock::new(|| Regex::new("[A-Za-z0-9]{16}").unwrap());
    if s.is_empty() || s.chars().count() > max {
        return false;
    }
    let compact = s.replace(' ', "");
    if mask(s) != s || mask(&compact) != compact || encoded_text(&compact) {
        return false;
    }
    let mut known_only = true;
    let mut offset = 0;
    for word in s.split([' ', '-']) {
        let suffix = &s[offset..];
        if CREDENTIAL.is_match(suffix) || CREDENTIAL.is_match(&suffix.replace(' ', "")) {
            return false;
        }
        // Check short Base64 fragments even when surrounded by display words.
        // The compact length rule below covers longer opaque runs.
        let mut candidate = String::new();
        for fragment in suffix.split(' ') {
            if candidate.len() + fragment.len() >= 16
                || !fragment.bytes().all(|b| b.is_ascii_alphanumeric())
            {
                break;
            }
            candidate.push_str(fragment);
            if encoded_text(&candidate) {
                return false;
            }
        }
        if !KNOWN.is_match(word) {
            if !WORD.is_match(word) || encoded_text(word) {
                return false;
            }
            known_only = false;
        }
        offset += word.len() + 1;
    }
    known_only || !LONG.is_match(&compact.replace('-', ""))
}

fn range(value: &Value, min: f64, max: f64) -> bool {
    value.as_f64().is_some_and(|n| (min..=max).contains(&n))
}

fn service(value: &Value) -> bool {
    let Some(s) = value.as_object() else {
        return false;
    };
    s.len() == 3
        && s.get("feature").is_some_and(|v| label(v, 40))
        && s.get("name").is_some_and(|v| label(v, 40))
        && matches!(
            s.get("kind").and_then(Value::as_str),
            Some("map" | "payment" | "ai" | "mail" | "storage" | "other")
        )
}

pub fn profile(hash: &str, body: &[u8]) -> Result<(Vec<u8>, Counts), ApiError> {
    if body.len() > MAX_BYTES {
        return Err(ApiError::TooLarge);
    }
    let data: Value = serde_json::from_slice(body).map_err(|_| ApiError::Invalid)?;
    let fields = data.as_object().ok_or(ApiError::Invalid)?;
    require(
        !fields.is_empty()
            && fields.iter().all(|(key, value)| match key.as_str() {
                "language" | "framework" | "hosting" | "deploy" => label(value, 40),
                "rollback" => label(value, 80),
                "metrics" => label(value, 120),
                "plan" => matches!(value.as_str(), Some("free" | "paid" | "unknown")),
                "database" => matches!(
                    value.as_str(),
                    Some("postgres" | "mysql" | "sqlite" | "mongo" | "none" | "other")
                ),
                "cpu_cores" | "memory_gb" => range(value, 0.001, 65536.0),
                "services" => value
                    .as_array()
                    .is_some_and(|rows| rows.len() <= 40 && rows.iter().all(service)),
                _ => false,
            }),
    )?;
    Ok((
        json!({"app_key_hash":hash,"profile":data})
            .to_string()
            .into_bytes(),
        Counts {
            accepted: 1,
            dropped: 0,
        },
    ))
}

pub fn validate_resources(data: &Value) -> Result<(), ApiError> {
    let fields = data.as_object().ok_or(ApiError::Invalid)?;
    require(fields.iter().all(|(key, value)| match key.as_str() {
        "process_cpu_pct" | "system_cpu_pct" | "steal_pct" | "mem_used_pct" => {
            range(value, 0.0, 100.0)
        }
        "gc_pause_ms" | "event_loop_lag_ms" => range(value, 0.0, 60_000.0),
        "busy_threads" | "db_pool_in_use" | "db_pool_max" => {
            value.as_u64().is_some_and(|n| n <= 1_000_000)
        }
        _ => false,
    }))?;
    require(
        match (
            data["db_pool_in_use"].as_u64(),
            data["db_pool_max"].as_u64(),
        ) {
            (Some(used), Some(max)) => used <= max,
            _ => true,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_validates_all_fields_before_storage() {
        for bad in [
            json!({"hosting":"https://example.org"}),
            json!({"framework":"x@example.org"}),
            json!({"metrics":"127.0.0.1"}),
            json!({"rollback":"postgres://a:b@db"}),
            json!({"language":"sp_srv_example"}),
            json!({"services":[{"kind":"ai","feature":"검색","name":"a","url":"x"}]}),
            json!({"framework":"x".repeat(41)}),
            json!({"cpu_cores":-1}),
            json!({"other":"x"}),
        ] {
            assert!(profile("hash", &serde_json::to_vec(&bad).unwrap()).is_err());
        }
        assert!(
            profile(
                "hash",
                br#"{"framework":"Next.js","plan":"free","memory_gb":0.5}"#
            )
            .is_ok()
        );
    }

    #[test]
    fn profile_display_text_rejects_credentials_and_accepts_product_names() {
        for bad in [
            "Bearer abc",
            "Use Be arer abc",
            "sk live example",
            "sk-demo",
            "s k - demo",
            "c2VjcmV0",
            "Use QUJD",
            "YW Jj ZG Vm",
            "Use YW Jj ZG Vm now",
            "%42earer",
            "Ｂｅａｒｅｒ abc",
            "abcdefghijklmnop",
            "abcd efgh ijkl mnop",
            "ab12cd34ef56gh78",
        ] {
            for payload in [
                json!({"rollback":bad}),
                json!({"services":[{"kind":"map","feature":"지도","name":bad}]}),
            ] {
                assert!(
                    profile("hash", &serde_json::to_vec(&payload).unwrap()).is_err(),
                    "{bad}"
                );
            }
        }
        for good in [
            "Flask-SQLAlchemy",
            "flask-login",
            "C++",
            "Next.js",
            "Spring 8",
            "이전 릴리스 다시 배포",
            "Check the server dashboard",
        ] {
            assert!(label(&json!(good), 80), "{good}");
        }
    }

    #[test]
    fn resources_accept_partial_numbers_and_enforce_bounds() {
        for good in [json!({}), json!({"process_cpu_pct":100,"gc_pause_ms":0})] {
            assert!(validate_resources(&good).is_ok());
        }
        for bad in [
            json!({"steal_pct":100.1}),
            json!({"mem_used_pct":-1}),
            json!({"gc_pause_ms":60001}),
            json!({"busy_threads":1.2}),
            json!({"db_pool_in_use":3,"db_pool_max":2}),
            json!({"system_cpu_pct":"2"}),
            json!({"hostname":"server"}),
        ] {
            assert!(validate_resources(&bad).is_err());
        }
    }
}
