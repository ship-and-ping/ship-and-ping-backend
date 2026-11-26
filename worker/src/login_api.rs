use super::{Supabase, error};
use crate::ingest::key_hash;
use futures_util::StreamExt;
use serde_json::{Value, json};
use worker::*;

pub(super) async fn route(req: Request, env: &Env) -> Result<Response> {
    let origin = env.var("WEB_ORIGIN").ok().map(|v| v.to_string());
    if origin.is_none() || req.headers().get("Origin")? != origin {
        return error(403, "origin denied");
    }
    let mut response = if req.method() == Method::Options {
        Response::empty()?.with_status(204)
    } else {
        match handle(req, env).await {
            Ok(response) => response,
            Err(_) => error(503, "login unavailable")?,
        }
    };
    let headers = response.headers_mut();
    headers.set("Access-Control-Allow-Origin", &origin.unwrap())?;
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")?;
    headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Poll-Secret",
    )?;
    headers.set("Vary", "Origin")?;
    headers.set("Cache-Control", "no-store")?;
    Ok(response)
}

async fn rpc(db: &Supabase, name: &str, args: &Value) -> Result<Value> {
    db.rpc(name, args.to_string().into_bytes())
        .await
        .map_err(|_| Error::RustError("storage unavailable".into()))?
        .json()
        .await
}

async fn handle(mut req: Request, env: &Env) -> Result<Response> {
    let Ok(Some(db)) = Supabase::configured(env) else {
        return error(503, "login unavailable");
    };
    let path = req.path();
    let tail = path.trim_start_matches("/v1/login-requests");
    let ip = key_hash(&req.headers().get("CF-Connecting-IP")?.unwrap_or_default());
    let mut body = Value::Null;
    if req.method() == Method::Post {
        let mut bytes = Vec::new();
        let Ok(mut stream) = req.stream() else {
            return error(400, "invalid request");
        };
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if bytes.len() + chunk.len() > 1024 {
                return error(413, "request too large");
            }
            bytes.extend_from_slice(&chunk);
        }
        let Ok(parsed) = serde_json::from_slice(&bytes) else {
            return error(400, "invalid request");
        };
        body = parsed;
    }
    let result = if tail.is_empty() && req.method() == Method::Post {
        let email = body["email"].as_str().unwrap_or("").trim();
        if !email.contains('@') || email.len() > 254 {
            return error(400, "invalid email");
        }
        let browser = crate::login::browser(&req.headers().get("User-Agent")?.unwrap_or_default());
        let place = req
            .headers()
            .get("CF-IPCountry")?
            .filter(|v| v.len() == 2 && v.bytes().all(|b| b.is_ascii_uppercase()));
        rpc(&db,"login_create",&json!({"p_email":email,"p_ip":ip,"p_browser":browser,"p_place":place.unwrap_or_else(|| "위치 확인 불가".into())})).await?
    } else {
        let pieces: Vec<_> = tail.trim_start_matches('/').split('/').collect();
        let Ok(id) = uuid::Uuid::parse_str(pieces[0]) else {
            return error(404, "missing");
        };
        let action = match (pieces.as_slice(), req.method()) {
            ([_], Method::Get) if req.headers().has("Authorization")? => "inspect",
            ([_], Method::Get) => "poll",
            ([_, "approve"], Method::Post) => match body["action"].as_str() {
                None | Some("approve") => "claim",
                Some("deny") => "deny",
                Some("local") => "local",
                _ => return error(400, "invalid action"),
            },
            _ => return error(405, "invalid method"),
        };
        let mut email = String::new();
        let mut member = String::new();
        if action != "poll" {
            if rpc(&db, "login_auth_budget", &json!({"p_ip":ip})).await? != true {
                return error(429, "too many requests");
            }
            let Some(auth) = req
                .headers()
                .get("Authorization")?
                .filter(|v| v.starts_with("Bearer "))
            else {
                return error(401, "login required");
            };
            let mut res = db
                .account_request(Method::Get, "/auth/v1/user", Some(&auth))
                .await?;
            if res.status_code() != 200 {
                return error(401, "login required");
            }
            let user: Value = res.json().await?;
            let (Some(address), Some(uid), Some(_)) = (
                user["email"].as_str(),
                user["id"].as_str(),
                user["email_confirmed_at"].as_str(),
            ) else {
                return error(403, "verified email required");
            };
            email = address.to_owned();
            member = uid.to_owned();
        }
        let mut args = json!({"p_id":id,"p_action":action,"p_email":email,"p_ip":ip,
            "p_secret":req.headers().get("X-Poll-Secret")?.unwrap_or_default(),"p_code":body["match_code"].as_str().unwrap_or(""),
            "p_key":key_hash(&format!("T32/login-grant/{}",db.key)),"p_token":""});
        let decision = rpc(&db, "login_step", &args).await?;
        if action == "claim" && decision["status"] == "issuing" {
            let headers = Headers::new();
            headers.set("apikey", &db.key)?;
            headers.set("Content-Type", "application/json")?;
            let mut init = RequestInit::new();
            init.with_method(Method::Post)
                .with_headers(headers)
                .with_body(Some(
                    json!({"type":"magiclink","email":email}).to_string().into(),
                ));
            let request = Request::new_with_init(
                &format!(
                    "{}/auth/v1/admin/generate_link",
                    db.url.trim_end_matches('/')
                ),
                &init,
            )?;
            let mut response = Fetch::Request(request).send().await?;
            if response.status_code() != 200 {
                return error(503, "request a new link");
            }
            let grant: Value = response.json().await?;
            if grant["id"].as_str() != Some(member.as_str()) {
                return error(403, "member changed");
            }
            let Some(token) = grant["hashed_token"].as_str().filter(|v| !v.is_empty()) else {
                return error(503, "grant unavailable");
            };
            args["p_action"] = json!("seal");
            args["p_token"] = json!(token);
            rpc(&db, "login_step", &args).await?
        } else {
            decision
        }
    };
    let status = match result["status"].as_str() {
        Some("limited") => 429,
        Some("missing") => 404,
        _ => 200,
    };
    Ok(Response::from_json(&result)?.with_status(status))
}
