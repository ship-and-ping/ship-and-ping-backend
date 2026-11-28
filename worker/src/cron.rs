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
async fn run_evaluation(db: &Supabase, rpc: &str) {
    use futures_util::future::{Either, select};
    use std::time::Duration;

    let evaluate = async {
        match db.rpc(rpc, b"{}".to_vec()).await {
            Ok(mut response) if rpc == "evaluate_all" => {
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
    };
    // Allow the database its eight-second statement budget plus network time.
    let deadline = Delay::from(Duration::from_secs(10));
    if let Either::Right(_) = select(Box::pin(evaluate), Box::pin(deadline)).await {
        console_error!("Scheduled RPC {} exceeded 10 seconds", rpc);
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
    if rpc == "evaluate_all" {
        futures_util::join!(
            run_evaluation(&db, rpc),
            run_evaluation(&db, "evaluate_silence")
        );
        if crate::notify::deliver(&db, &env).await.is_err() {
            console_error!("Notification delivery interrupted");
        }
    } else {
        for daily in [rpc, "rollup_server_hours"] {
            if db.rpc(daily, b"{}".to_vec()).await.is_err() {
                console_error!("Scheduled RPC {} failed", daily);
            }
        }
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
