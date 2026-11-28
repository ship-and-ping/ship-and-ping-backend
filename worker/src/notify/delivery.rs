use super::push::Target;
use super::{Notice, render_mail, sentence};
use crate::endpoint::Supabase;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use worker::*;

#[wasm_bindgen::prelude::wasm_bindgen(module = "/src/version.js")]
extern "C" {
    #[wasm_bindgen::prelude::wasm_bindgen(js_name = versionLabel)]
    fn version_label(raw: &str) -> String;
}

#[derive(serde::Deserialize)]
struct ClaimedNotice {
    #[serde(flatten)]
    notice: Notice,
    app_version: Option<String>,
}

pub fn setting(env: &Env, name: &str) -> Option<String> {
    env.var(name)
        .ok()
        .map(|v| v.to_string())
        .filter(|s| !s.is_empty())
}

pub async fn post(url: &str, mime: &str, body: String, auth: Option<&str>) -> Result<Response> {
    let headers = Headers::new();
    headers.set("Content-Type", mime)?;
    if let Some(auth) = auth {
        headers.set("Authorization", auth)?;
    }
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_redirect(RequestRedirect::Manual)
        .with_body(Some(body.into()));
    Fetch::Request(Request::new_with_init(url, &init)?)
        .send()
        .await
}

pub fn valid_hook(input: &str) -> bool {
    Url::parse(input).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str() == Some("hooks.slack.com")
            && u.port().is_none()
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
            && u.path().starts_with("/services/")
    })
}

async fn rpc(db: &Supabase, name: &str, body: Value) -> Result<Response> {
    db.rpc(name, body.to_string().into_bytes())
        .await
        .map_err(|_| Error::RustError("알림 저장 실패".into()))
}
enum Outcome {
    Sent,
    Failed(&'static str),
    Broken,
    Deferred,
}

async fn email(
    db: &Supabase,
    env: &Env,
    app: uuid::Uuid,
    to: &str,
    mail: super::Mail,
) -> Result<Outcome> {
    let (Some(key), Some(from)) = (setting(env, "RESEND_API_KEY"), setting(env, "MAIL_FROM"))
    else {
        return Ok(Outcome::Failed("설정 필요"));
    };
    if !rpc(db, "reserve_mail", json!({"app":app}))
        .await?
        .json::<bool>()
        .await?
    {
        return Ok(Outcome::Deferred);
    }
    Ok(
        if send_resend(&key, &from, to, mail)
            .await
            .is_ok_and(|s| (200..300).contains(&s))
        {
            Outcome::Sent
        } else {
            Outcome::Failed("메일 발송 실패")
        },
    )
}

pub(crate) async fn send_resend(key: &str, from: &str, to: &str, mail: super::Mail) -> Result<u16> {
    post(
        "https://api.resend.com/emails",
        "application/json",
        mail.payload(from, to).to_string(),
        Some(&format!("Bearer {key}")),
    )
    .await
    .map(|r| r.status_code())
}
async fn deliver_email(
    db: &Supabase,
    env: &Env,
    rows: &[Notice],
    to: &str,
    origin: Option<&str>,
) -> Outcome {
    let first = &rows[0];
    let extra = if first.digest {
        let response = rpc(
            db,
            "expand_mail_digest",
            json!({"id":first.id,"token":first.claim_token}),
        )
        .await;
        let Ok(mut response) = response else {
            return Outcome::Failed("메일 묶음 조회 실패");
        };
        let Ok(extra) = response.json::<u32>().await else {
            return Outcome::Failed("메일 묶음 조회 실패");
        };
        extra
    } else {
        0
    };
    email(db, env, first.app, to, render_mail(rows, extra, origin))
        .await
        .unwrap_or(Outcome::Failed("메일 예약 실패"))
}

async fn slack(hook: &str, body: String) -> Outcome {
    if !valid_hook(hook) {
        return Outcome::Broken;
    }
    let Ok(mut response) = post(
        hook,
        "application/json",
        json!({"text":body,"mrkdwn":false,"unfurl_links":false,"unfurl_media":false}).to_string(),
        None,
    )
    .await
    else {
        return Outcome::Failed("슬랙 발송 실패");
    };
    let status = response.status_code();
    let result = response.text().await.unwrap_or_default();
    if matches!(status, 403 | 404 | 410)
        || matches!(result.trim(), "channel_not_found" | "invalid_token")
    {
        Outcome::Broken
    } else if (200..300).contains(&status) && result.trim() == "ok" {
        Outcome::Sent
    } else {
        Outcome::Failed("슬랙 발송 실패")
    }
}
async fn current_push_target(db: &Supabase, notice: &Notice) -> Result<Option<Target>> {
    rpc(
        db,
        "prepare_push_delivery",
        json!({"id":notice.id,"token":notice.claim_token,"app":notice.app}),
    )
    .await?
    .json()
    .await
}

pub async fn deliver(db: &Supabase, env: &Env) -> Result<()> {
    // Ten rows leave room for one provider request, reservation and completion per row.
    let rows: Vec<ClaimedNotice> = rpc(db, "claim_notification_payloads", json!({"limit":10}))
        .await?
        .json()
        .await?;
    let mut groups = BTreeMap::<(bool, String, String), Vec<Notice>>::new();
    for claimed in rows {
        let mut row = claimed.notice;
        if row.channel == "email" {
            row.version_label = claimed.app_version.as_deref().map(version_label);
        }
        let target = if row.channel == "slack" {
            row.hook
                .as_ref()
                .map(|hook| row.destination.as_ref().unwrap_or(hook).clone())
        } else if row.digest {
            row.email.clone()
        } else {
            Some(row.id.to_string())
        };
        groups
            .entry((
                row.channel == "push", // Finish email and Slack before contacting push providers.
                row.channel.clone(),
                target.unwrap_or_else(|| row.id.to_string()),
            ))
            .or_default()
            .push(row);
    }
    let origin = setting(env, "WEB_ORIGIN");
    for (_, rows) in groups {
        let first = &rows[0];
        if first.channel == "push" {
            let target = match current_push_target(db, first).await {
                Ok(Some(target)) => target,
                Ok(None) => continue, // Revoked or superseded lease, already settled by the DB.
                Err(_) => {
                    console_error!("Push target lookup failed");
                    continue; // Leave the lease for recovery.
                }
            };
            let result = super::push::send(first, &target, env).await;
            if rpc(
                db,
                "complete_push",
                json!({"id":first.id,"token":first.claim_token,"result":result}),
            )
            .await
            .is_err()
            {
                console_error!("Push completion failed");
            }
            continue;
        }
        let outcome = {
            if first.channel == "email" {
                if let Some(to) = &first.email {
                    deliver_email(db, env, &rows, to, origin.as_deref()).await
                } else {
                    Outcome::Failed("받을 곳 없음")
                }
            } else if let Some(hook) = &first.hook {
                let body = rows
                    .iter()
                    .map(|n| {
                        let Some(origin) = &origin else {
                            return sentence(n);
                        };
                        let path = n
                            .incident
                            .map(|id| format!("/apps/{}/issues/{id}", n.app))
                            .unwrap_or_else(|| format!("/apps/{}/notifications", n.app));
                        format!(
                            "{}\n쉽앤핑에서 보기 {}{}",
                            sentence(n),
                            origin.trim_end_matches('/'),
                            path
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                slack(hook, body).await
            } else if first.secret_id.is_some() {
                Outcome::Broken
            } else {
                Outcome::Failed("받을 곳 없음")
            }
        };
        for n in &rows {
            let mut args = json!({"id":n.id,"token":n.claim_token});
            let method = match outcome {
                Outcome::Deferred => "defer_mail",
                Outcome::Broken if n.hook == first.hook => {
                    args["secret"] = json!(n.secret_id);
                    "slack_failed"
                }
                _ => {
                    args["ok"] = json!(matches!(outcome, Outcome::Sent));
                    args["error"] = match outcome {
                        Outcome::Failed(msg) => json!(msg),
                        Outcome::Broken => json!("슬랙 발송 실패"),
                        _ => Value::Null,
                    };
                    "complete_notification"
                }
            };
            if rpc(db, method, args).await.is_err() {
                console_error!("Notification completion failed");
            }
        }
    }
    Ok(())
}
