use super::{Supabase, error};
use crate::notify::{install_mail, send_resend, setting};
use worker::*;

pub(super) async fn route(req: Request, env: &Env) -> Result<Response> {
    let Some(origin) = setting(env, "WEB_ORIGIN") else {
        return error(503, "mail unavailable");
    };
    if req.headers().get("Origin")?.as_deref() != Some(&origin) {
        return error(403, "origin denied");
    }
    let mut response = match req.method() {
        Method::Options => Response::empty()?.with_status(204),
        Method::Post => match send(req, env, &origin).await {
            Ok(response) => response,
            Err(_) => error(503, "mail unavailable")?,
        },
        _ => error(405, "invalid method")?,
    };
    let headers = response.headers_mut();
    headers.set("Access-Control-Allow-Origin", &origin)?;
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS")?;
    headers.set("Access-Control-Allow-Headers", "Authorization")?;
    headers.set("Cache-Control", "no-store")?;
    headers.set("Vary", "Origin")?;
    Ok(response)
}

async fn send(req: Request, env: &Env, origin: &str) -> Result<Response> {
    let Some(auth) = req
        .headers()
        .get("Authorization")?
        .filter(|s| s.starts_with("Bearer "))
    else {
        return error(401, "login required");
    };
    let (Ok(Some(db)), Some(mail), Some(key), Some(from)) = (
        Supabase::configured(env),
        install_mail(origin),
        setting(env, "RESEND_API_KEY"),
        setting(env, "MAIL_FROM"),
    ) else {
        return error(503, "mail unavailable");
    };
    // Only the database resolves the address from the signed JWT. Ignore all request data.
    let Ok(mut reservation) = db
        .rpc_as("reserve_install_mail", b"{}".to_vec(), Some(&auth))
        .await
    else {
        return error(503, "reservation unavailable");
    };
    let Some(to) = reservation.json::<Option<String>>().await? else {
        return error(429, "mail limit reached");
    };
    if !send_resend(&key, &from, &to, mail).await {
        return error(503, "mail unavailable");
    }
    Ok(Response::empty()?.with_status(204))
}
