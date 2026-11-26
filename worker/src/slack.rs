use crate::{
    endpoint::Supabase,
    notify::{post, setting, valid_hook},
};
use serde_json::{Value, json};
use worker::*;

fn problem(status: u16, message: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({"error":message}))?.with_status(status))
}
fn explanation(code: &str) -> &'static str {
    match code {
        "action_prohibited" => "관리자가 앱 추가를 제한했어요. 슬랙 관리자에게 요청해 주세요.",
        "too_many_integrations" | "free_team_app_limit_reached" => {
            "무료 슬랙은 앱을 10개까지 추가할 수 있어요. 앱 하나를 지우거나 이메일 알림을 켜세요."
        }
        "access_denied" => "슬랙 연결을 취소했어요.",
        _ => "슬랙 연결을 마치지 못했어요. 다시 연결해 주세요.",
    }
}
pub async fn route(mut req: Request, env: &Env) -> Result<Response> {
    if req.method() == Method::Options {
        return Response::empty();
    }
    let install = match req.path().as_str() {
        "/v1/slack/install" => true,
        "/v1/slack/callback" => false,
        _ => return problem(404, "경로를 확인해 주세요."),
    };
    let (Some(client), Some(secret), Some(web)) = (
        setting(env, "SLACK_CLIENT_ID"),
        setting(env, "SLACK_CLIENT_SECRET"),
        setting(env, "WEB_ORIGIN"),
    ) else {
        return problem(503, "슬랙 연결이 아직 준비되지 않았어요.");
    };
    let url = req.url()?;
    let redirect = url.join("/v1/slack/callback")?.to_string();
    if !install && req.method() == Method::Get {
        // Finish in the initiating tab, which retains the member session and state.
        let mut page = Url::parse(&web)?.join("/apps/notifications")?;
        let mut params = url.clone();
        params.set_query(None);
        for (k, v) in url
            .query_pairs()
            .filter(|(k, _)| matches!(k.as_ref(), "code" | "state" | "error"))
        {
            params
                .query_pairs_mut()
                .append_pair(&format!("slack_{k}"), &v);
        }
        page.set_fragment(params.query());
        let mut response = Response::empty()?.with_status(302);
        response.headers_mut().set("Location", page.as_str())?;
        response
            .headers_mut()
            .set("Referrer-Policy", "no-referrer")?;
        response.headers_mut().set("Cache-Control", "no-store")?;
        return Ok(response);
    }
    if req.method() != Method::Post {
        return problem(405, "요청 방법을 확인해 주세요.");
    }
    let Some(auth) = req
        .headers()
        .get("Authorization")?
        .filter(|s| s.starts_with("Bearer "))
    else {
        return problem(401, "로그인이 필요해요.");
    };
    let Ok(Some(db)) = Supabase::configured(env) else {
        return problem(503, "데이터베이스 설정 필요");
    };
    let body: Value = match req.json().await {
        Ok(v) => v,
        Err(_) => return problem(400, "요청을 확인해 주세요."),
    };
    let (method, arg) = if install {
        ("start_slack_state", json!({"app":body["app"]}))
    } else {
        ("consume_slack_state", json!({"ticket":body["state"]}))
    };
    let Ok(mut response) = db
        .rpc_as(method, arg.to_string().into_bytes(), Some(&auth))
        .await
    else {
        return problem(403, "로그인과 연결 요청을 확인해 주세요.");
    };
    let Ok(Some(id)) = response.json::<Option<uuid::Uuid>>().await else {
        return problem(403, "연결 시간이 지났어요. 다시 시작해 주세요.");
    };
    if install {
        let mut dest = Url::parse("https://slack.com/oauth/v2/authorize")?;
        dest.query_pairs_mut()
            .append_pair("scope", "incoming-webhook")
            .append_pair("client_id", &client)
            .append_pair("redirect_uri", &redirect)
            .append_pair("state", &id.to_string());
        return Response::from_json(&json!({"url":dest.as_str(),"state":id}));
    }
    if let Some(error) = body["error"].as_str() {
        return problem(400, explanation(error));
    }
    let Some(code) = body["code"].as_str() else {
        return problem(400, "슬랙 연결 코드를 확인해 주세요.");
    };
    let mut form = Url::parse("https://slack.com/api/oauth.v2.access")?;
    let endpoint = form.to_string();
    form.query_pairs_mut()
        .append_pair("client_id", &client)
        .append_pair("client_secret", &secret)
        .append_pair("redirect_uri", &redirect)
        .append_pair("code", code);
    let mut reply = post(
        &endpoint,
        "application/x-www-form-urlencoded",
        form.query().unwrap_or_default().into(),
        None,
    )
    .await?;
    let result: Value = reply.json().await?;
    if result["ok"] != true || reply.status_code() != 200 {
        return problem(400, explanation(result["error"].as_str().unwrap_or("")));
    }
    let hook = &result["incoming_webhook"];
    let (Some(url), Some(name), Some(channel), Some(team)) = (
        hook["url"].as_str().filter(|s| valid_hook(s)),
        hook["channel"].as_str(),
        hook["channel_id"].as_str(),
        result["team"]["id"].as_str(),
    ) else {
        return problem(400, "슬랙에서 채널 정보를 받지 못했어요.");
    };
    let args =
        json!({"app":id,"hook":url,"channel":name,"destination":format!("{team}/{channel}")});
    if db
        .rpc("connect_slack", args.to_string().into_bytes())
        .await
        .is_err()
    {
        return problem(503, "연결을 저장하지 못했어요.");
    }
    Response::from_json(&json!({"app":id}))
}
