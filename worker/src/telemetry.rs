use super::{ApiError, Counts, MAX_BYTES, opaque_diagnostic, private_segment, require};
use serde_json::{Value, json};

fn label(value: &Value, max: usize) -> bool {
    let Some(s) = value.as_str() else {
        return false;
    };
    // A small display alphabet excludes URI syntax, hostnames, IPs and DSNs.
    // Common framework names with dots are explicitly recognized.
    let alphabet = matches!(
        s,
        "Node.js" | "Next.js" | "Nuxt.js" | "Vue.js" | ".NET" | "ASP.NET"
    ) || s.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || ('가'..='힣').contains(&c)
            || matches!(c, ' ' | '-' | '+' | '#')
    });
    alphabet
        && !s.is_empty()
        && s.trim() == s
        && s.chars().count() <= max
        && !private_segment(s)
        && !opaque_diagnostic(s)
        && !s
            .split([' ', '-'])
            .any(|word| word.len() >= 24 && word.is_ascii())
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
