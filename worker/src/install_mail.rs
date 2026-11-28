use super::{Supabase, error};
use crate::ingest::key_hash;
use crate::notify::{Mail, install_mail, login_code_mail, send_resend, setting};
use futures_util::StreamExt;
use serde_json::{Value, json};
use worker::*;

pub(super) async fn route(req: Request, env: &Env, ctx: Context) -> Result<Response> {
    let Some(origin) = setting(env, "WEB_ORIGIN") else {
        return error(503, "mail unavailable");
    };
    if req.headers().get("Origin")?.as_deref() != Some(&origin) {
        return error(403, "origin denied");
    }
    let mut response = match req.method() {
        Method::Options => Response::empty()?.with_status(204),
        Method::Post => match handle(req, env, &origin, ctx).await {
            Ok(response) => response,
            Err(_) => error(503, "mail unavailable")?,
        },
        _ => error(405, "invalid method")?,
    };
    let headers = response.headers_mut();
    headers.set("Access-Control-Allow-Origin", &origin)?;
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS")?;
    headers.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
    )?;
    headers.set("Cache-Control", "no-store")?;
    headers.set("Vary", "Origin")?;
    Ok(response)
}

#[derive(serde::Deserialize)]
struct Reservation {
    receipt: uuid::Uuid,
    email: String,
}

async fn rpc(db: &Supabase, name: &str, args: Value) -> Result<Response> {
    db.rpc(name, args.to_string().into_bytes())
        .await
        .map_err(|_| Error::RustError("storage unavailable".into()))
}

async fn deliver(
    db: &Supabase,
    reservation: Reservation,
    key: &str,
    from: &str,
    mail: Mail,
) -> Result<bool> {
    // A lost response is ambiguous. Only release when Resend actually rejects the send.
    let status = send_resend(key, from, &reservation.email, mail).await?;
    if (200..300).contains(&status) {
        return Ok(true);
    }
    rpc(
        db,
        "release_install_mail",
        json!({"p_receipt":reservation.receipt}),
    )
    .await?;
    Ok(false)
}

async fn handle(mut req: Request, env: &Env, origin: &str, ctx: Context) -> Result<Response> {
    let (Ok(Some(db)), Some(key), Some(from)) = (
        Supabase::configured(env),
        setting(env, "RESEND_API_KEY"),
        setting(env, "MAIL_FROM"),
    ) else {
        return error(503, "mail unavailable");
    };
    if req.path() == "/v1/install-mail" {
        let Some(auth) = req
            .headers()
            .get("Authorization")?
            .filter(|s| s.starts_with("Bearer "))
        else {
            return error(401, "login required");
        };
        let Some(mail) = install_mail(origin) else {
            return error(503, "mail unavailable");
        };
        let mut identity = db
            .account_request(Method::Get, "/auth/v1/user", Some(&auth))
            .await?;
        if identity.status_code() != 200 {
            return error(401, "login required");
        }
        let member = identity.json::<Value>().await?;
        let Some(uid) = member["id"].as_str() else {
            return error(401, "login required");
        };
        let mut result = rpc(&db, "reserve_install_mail", json!({"p_member":uid})).await?;
        let Some(reservation) = result.json::<Option<Reservation>>().await? else {
            return error(429, "mail limit reached");
        };
        return if deliver(&db, reservation, &key, &from, mail).await? {
            Ok(Response::empty()?.with_status(204))
        } else {
            error(503, "mail unavailable")
        };
    }
    let ip = key_hash(&req.headers().get("CF-Connecting-IP")?.unwrap_or_default());
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
    let Ok(body) = serde_json::from_slice::<Value>(&bytes) else {
        return error(400, "invalid request");
    };
    let email = body["email"].as_str().unwrap_or("").trim().to_lowercase();
    if !email.contains('@') || email.len() > 254 {
        return error(400, "invalid email");
    }
    if req.path() == "/v1/install-code" {
        // The HTTP response never awaits account lookup, throttling or SMTP.
        ctx.wait_until(async move {
            if issue(&db, &key, &from, &email, &ip).await.is_err() {
                console_warn!("install code delivery unavailable");
            }
        });
        return Ok(Response::empty()?.with_status(202));
    }
    let code = body["code"].as_str().unwrap_or("");
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return error(400, "invalid code");
    }
    let mut result = rpc(
        &db,
        "consume_install_code",
        json!({"p_ip":ip,"p_email":email,"p_proof":proof(&db,&email,code)}),
    )
    .await?;
    let Some(uid) = result.json::<Option<uuid::Uuid>>().await? else {
        return error(403, "invalid or expired code");
    };
    // Recovery generation requires an existing account, including if it was deleted between calls.
    // Supabase accepts this one-time hash via verifyOtp(type=email) and issues an OTP session.
    let headers = Headers::new();
    headers.set("apikey", &db.key)?;
    headers.set("Content-Type", "application/json")?;
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_redirect(RequestRedirect::Manual)
        .with_body(Some(
            json!({"email":email,"type":"recovery"}).to_string().into(),
        ));
    let url = format!(
        "{}/auth/v1/admin/generate_link",
        db.url.trim_end_matches('/')
    );
    let mut reply = Fetch::Request(Request::new_with_init(&url, &init)?)
        .send()
        .await?;
    if reply.status_code() != 200 {
        return error(403, "request a new code");
    }
    let grant = reply.json::<Value>().await?;
    if grant["id"].as_str() != Some(&uid.to_string()) {
        return error(403, "request a new code");
    }
    let Some(hash) = grant["hashed_token"].as_str().filter(|s| !s.is_empty()) else {
        return error(503, "login unavailable");
    };
    Response::from_json(&json!({"token_hash":hash}))
}

fn proof(db: &Supabase, email: &str, code: &str) -> String {
    key_hash(&format!("T61/login-code/{}/{email}/{code}", db.key))
}

async fn issue(db: &Supabase, key: &str, from: &str, email: &str, ip: &str) -> Result<()> {
    let code = loop {
        let mut bytes = [0u8; 4];
        getrandom::getrandom(&mut bytes)
            .map_err(|_| Error::RustError("entropy unavailable".into()))?;
        let n = u32::from_be_bytes(bytes);
        if n < 4_294_000_000 {
            break n % 1_000_000;
        }
    };
    let mut result = rpc(
        db,
        "issue_install_code",
        json!({"p_email":email,"p_ip":ip,"p_proof":proof(db,email,&format!("{code:06}"))}),
    )
    .await?;
    if let Some(ticket) = result.json::<Option<Reservation>>().await? {
        deliver(db, ticket, key, from, login_code_mail(code)).await?;
    }
    Ok(())
}
