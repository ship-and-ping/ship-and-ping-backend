#[cfg(target_arch = "wasm32")]
use crate::endpoint::Supabase;
#[cfg(target_arch = "wasm32")]
use worker::*;

fn scheduled_rpc(cron: &str) -> Option<&'static str> {
    match cron {
        "* * * * *" => Some("evaluate_all"),
        "15 0 * * *" => Some("cleanup_daily"),
        _ => None,
    }
}

#[cfg(target_arch = "wasm32")]
#[event(scheduled)]
pub async fn scheduled(event: ScheduledEvent, env: Env, _ctx: ScheduleContext) {
    let Some(rpc) = scheduled_rpc(&event.cron()) else {
        return;
    };
    let Ok(Some(db)) = Supabase::configured(&env) else {
        console_error!(
            "Scheduled RPC {} skipped: missing database configuration",
            rpc
        );
        return;
    };
    match db.rpc(rpc, b"{}".to_vec()).await {
        Ok(mut response) if rpc == "evaluate_all" => {
            // The transaction has already queued delivery; log only the count.
            match response.json::<Vec<serde::de::IgnoredAny>>().await {
                Ok(events) if !events.is_empty() => {
                    console_log!("Evaluation events: {}", events.len())
                }
                Ok(_) => (),
                Err(_) => console_error!("Invalid evaluation response"),
            }
        }
        Ok(_) => (),
        Err(_) => console_error!("Scheduled RPC {} failed", rpc),
    }
    let server_rpc = if rpc == "evaluate_all" {
        "evaluate_silence"
    } else {
        "rollup_server_hours"
    };
    if db.rpc(server_rpc, b"{}".to_vec()).await.is_err() {
        console_error!("Scheduled RPC {} failed", server_rpc);
    }
    if rpc == "evaluate_all" && crate::notify::deliver(&db, &env).await.is_err() {
        console_error!("Notification delivery interrupted");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn production_requires_only_core_secrets() {
        let config: toml::Table = toml::from_str(include_str!("../wrangler.toml")).unwrap();
        let mut required: Vec<_> = config["env"]["production"]["secrets"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|name| name.as_str().unwrap())
            .collect();
        required.sort_unstable();
        assert_eq!(
            required,
            [
                "MAIL_FROM",
                "RESEND_API_KEY",
                "SUPABASE_SECRET_KEY",
                "SUPABASE_URL",
                "WEB_ORIGIN"
            ]
        );
    }

    #[test]
    fn configured_schedules_dispatch_the_expected_rpcs() {
        let config: toml::Table = toml::from_str(include_str!("../wrangler.toml")).unwrap();
        for triggers in [
            &config["triggers"],
            &config["env"]["production"]["triggers"],
        ] {
            let crons = triggers["crons"].as_array().unwrap();
            assert_eq!(crons.len(), 2);
            let routes: BTreeMap<_, _> = crons
                .iter()
                .map(|value| {
                    let cron = value.as_str().unwrap();
                    (cron, scheduled_rpc(cron).unwrap())
                })
                .collect();
            assert_eq!(
                routes,
                BTreeMap::from([
                    ("* * * * *", "evaluate_all"),
                    ("15 0 * * *", "cleanup_daily")
                ])
            );
        }
        assert_eq!(scheduled_rpc("0 * * * *"), None);
    }
}
