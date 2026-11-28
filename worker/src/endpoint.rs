use crate::ingest::{
    ApiError, Counts, MAX_BYTES, credential, key_hash, prepare_ingest, prepare_map,
};
use crate::limits::Limits;
use futures_util::StreamExt;
use serde_json::json;
use std::cell::RefCell;
use worker::*;
thread_local! { static LIMITS: RefCell<Limits> = RefCell::default(); }

pub(crate) struct SinkError(u16, &'static str);

struct PendingLookup<'a> {
    hash: &'a str,
    missing: bool,
}
impl Drop for PendingLookup<'_> {
    fn drop(&mut self) {
        let now = Date::now().as_millis() / 1000;
        LIMITS.with_borrow_mut(|state| state.finish_lookup(self.hash, self.missing, now));
    }
}

impl From<worker::Error> for SinkError {
    fn from(_: worker::Error) -> Self {
        Self(503, "storage unavailable")
    }
}

#[derive(serde::Deserialize)]
struct RpcFailure {
    code: String,
}

pub(crate) struct Supabase {
    url: String,
    key: String,
}
impl Supabase {
    async fn account_request(
        &self,
        method: Method,
        path: &str,
        bearer: Option<&str>,
    ) -> Result<Response> {
        let headers = Headers::new();
        headers.set("apikey", &self.key)?;
        if let Some(auth) = bearer {
            headers.set("Authorization", auth)?;
        }
        let mut init = RequestInit::new();
        init.with_method(method).with_headers(headers);
        let request =
            Request::new_with_init(&format!("{}{path}", self.url.trim_end_matches('/')), &init)?;
        Fetch::Request(request).send().await
    }
    pub(crate) fn configured(env: &Env) -> std::result::Result<Option<Self>, SinkError> {
        let url = env
            .var("SUPABASE_URL")
            .ok()
            .map(|v| v.to_string())
            .unwrap_or_default();
        let key = env
            .secret("SUPABASE_SECRET_KEY")
            .ok()
            .map(|v| v.to_string())
            .unwrap_or_default();
        if url.is_empty() || key.is_empty() {
            let dry_run = env
                .var("INGEST_DRY_RUN")
                .is_ok_and(|flag| flag.to_string() == "true");
            if dry_run && url.is_empty() && key.is_empty() {
                return Ok(None);
            }
            return Err(SinkError(503, "storage unavailable"));
        }
        Ok(Some(Self { url, key }))
    }
    pub(crate) async fn rpc(
        &self,
        name: &str,
        body: Vec<u8>,
    ) -> std::result::Result<Response, SinkError> {
        self.rpc_as(name, body, None).await
    }
    pub(crate) async fn rpc_as(
        &self,
        name: &str,
        body: Vec<u8>,
        bearer: Option<&str>,
    ) -> std::result::Result<Response, SinkError> {
        let h = Headers::new();
        h.set("apikey", &self.key)?;
        if let Some(auth) = bearer {
            h.set("Authorization", auth)?;
        }
        h.set("Content-Type", "application/json")?;
        let mut init = RequestInit::new();
        init.with_method(Method::Post)
            .with_headers(h)
            .with_body(Some(
                String::from_utf8(body)
                    .map_err(|_| Error::RustError("invalid JSON encoding".into()))?
                    .into(),
            ));
        let req = Request::new_with_init(
            &format!("{}/rest/v1/rpc/{name}", self.url.trim_end_matches('/')),
            &init,
        )?;
        let mut response = Fetch::Request(req)
            .send()
            .await
            .map_err(|_| SinkError(503, "storage unavailable"))?;
        let status = response.status_code();
        if !(200..300).contains(&status) {
            let code = if matches!(status, 400 | 401) {
                response.json::<RpcFailure>().await.ok().map(|e| e.code)
            } else {
                None
            };
            return Err(match (status, code.as_deref()) {
                (401, Some("PT401")) => SinkError(401, "invalid or expired key"),
                (400, Some("22023")) => SinkError(400, "invalid batch"),
                _ => SinkError(503, "storage unavailable"),
            });
        }
        Ok(response)
    }
    async fn app(&self, hash: &str, now: u64) -> std::result::Result<String, SinkError> {
        if let Some(app) = LIMITS.with_borrow(|state| state.cached(hash, now)) {
            return Ok(app);
        }
        match LIMITS.with_borrow_mut(|state| state.begin_lookup(hash, now)) {
            Err(()) => return Err(SinkError(429, "key lookup quota exceeded")),
            Ok(false) => return Err(SinkError(401, "unknown key")),
            Ok(true) => {}
        }
        let mut pending = PendingLookup {
            hash,
            missing: false,
        };
        let body = json!({"app_key_hash": hash}).to_string().into_bytes();
        let app = self
            .rpc("lookup_key_app", body)
            .await?
            .json::<Option<uuid::Uuid>>()
            .await
            .map_err(|_| SinkError(503, "invalid lookup response"))?;
        pending.missing = app.is_none();
        let app = app.ok_or(SinkError(401, "unknown key"))?.to_string();
        let now = Date::now().as_millis() / 1000;
        LIMITS.with_borrow_mut(|state| state.remember(hash, &app, now));
        Ok(app)
    }
}
fn error(status: u16, message: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({"error":message}))?.with_status(status))
}
async fn ingest(mut req: Request, env: Env) -> Result<Response> {
    let path = req.path();
    if !matches!(
        path.as_str(),
        "/v1/feature-map" | "/v1/ingest" | "/v1/profile"
    ) {
        return error(400, "unknown endpoint");
    }
    if req.method() == Method::Options {
        return Ok(Response::empty()?.with_status(204));
    }
    if req.method() != Method::Post {
        return error(400, "POST required");
    }
    let headers = req.headers();
    let auth = headers.get("Authorization")?;
    let content_type = headers.get("Content-Type")?.unwrap_or_default();
    let mime = content_type.split(';').next().unwrap_or("").trim();
    let beacon = path == "/v1/ingest" && mime.eq_ignore_ascii_case("text/plain");
    if auth.as_ref().is_some_and(|v| credential(v).is_err()) || (auth.is_none() && !beacon) {
        return error(401, "invalid key format");
    }
    if !(mime.eq_ignore_ascii_case("application/json") || mime.eq_ignore_ascii_case("text/plain")) {
        return error(400, "JSON body required");
    }
    if headers
        .get("Content-Length")?
        .and_then(|v| v.parse::<u64>().ok())
        .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return error(413, "batch too large");
    }
    let mut body = Vec::new();
    let Ok(mut stream) = req.stream() else {
        return error(400, "missing body");
    };
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            return error(400, "unreadable body");
        };
        if chunk.len() > MAX_BYTES - body.len() {
            return error(413, "batch too large");
        }
        body.extend_from_slice(&chunk);
    }
    let auth = match auth {
        Some(header) => header,
        None => {
            #[derive(serde::Deserialize)]
            struct Beacon {
                key: Option<String>,
            }
            let Ok(beacon) = serde_json::from_slice::<Beacon>(&body) else {
                return error(400, "invalid beacon");
            };
            let Some(key) = beacon.key else {
                return error(401, "missing key");
            };
            if key.starts_with("sp_srv_") {
                return error(400, "server key requires header");
            }
            format!("Bearer {key}")
        }
    };
    let Ok(key) = credential(&auth) else {
        return error(401, "invalid key format");
    };
    let hash = key_hash(key);
    let now = Date::now().as_millis() as i64;
    let seconds = (now / 1000) as u64;
    let db = match Supabase::configured(&env) {
        Ok(db) => db,
        Err(SinkError(status, msg)) => return error(status, msg),
    };
    let app = match &db {
        Some(db) => match db.app(&hash, seconds).await {
            Ok(app) => app,
            Err(SinkError(429, msg)) => {
                let mut response = error(429, msg)?;
                response
                    .headers_mut()
                    .set("Retry-After", &(60 - seconds % 60).to_string())?;
                return Ok(response);
            }
            Err(SinkError(status, msg)) => return error(status, msg),
        },
        None => hash.clone(),
    };
    let (name, prepared) = match path.as_str() {
        "/v1/feature-map" => ("suggest_feature_map", prepare_map(&hash, &body)),
        "/v1/profile" => (
            "write_app_profile",
            crate::ingest::telemetry::profile(&hash, &body),
        ),
        _ => ("ingest_batch", prepare_ingest(key, &hash, &body, now)),
    };
    let (rpc, counts) = match prepared {
        Ok(out) => out,
        Err(ApiError::TooLarge) => return error(413, "batch too large"),
        Err(ApiError::Unauthorized) => return error(401, "invalid key format"),
        Err(ApiError::Invalid) => return error(400, "invalid batch"),
    };
    if let Err(retry) =
        LIMITS.with_borrow_mut(|state| state.reserve(&app, Date::now().as_millis() / 1000))
    {
        let mut response = error(429, "app quota exceeded")?;
        response
            .headers_mut()
            .set("Retry-After", &retry.to_string())?;
        return Ok(response);
    }
    let mut result = counts;
    if let Some(db) = db {
        let mut response = match db.rpc(name, rpc).await {
            Ok(r) => r,
            Err(SinkError(status, msg)) => return error(status, msg),
        };
        let Ok(mut stored) = response.json::<Counts>().await else {
            return error(503, "invalid storage response");
        };
        stored.dropped += result.dropped;
        result = stored;
    }
    Ok(Response::from_json(&result)?.with_status(202))
}
#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    if req.path() == "/v1/login-requests" || req.path().starts_with("/v1/login-requests/") {
        return login_api::route(req, &env).await;
    }
    let result = if req.path() == "/v1/account/delete" {
        delete_self(req, &env).await
    } else if req.path().starts_with("/v1/slack/") {
        crate::slack::route(req, &env).await
    } else {
        ingest(req, env).await
    };
    let mut response = match result {
        Ok(response) => response,
        Err(_) => error(503, "ingest unavailable")?,
    };
    let h = response.headers_mut();
    h.set("Access-Control-Allow-Origin", "*")?;
    h.set("Access-Control-Expose-Headers", "Retry-After")?;
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS")?;
    h.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
    )?;
    Ok(response)
}

#[path = "login_api.rs"]
mod login_api;

async fn delete_self(mut req: Request, env: &Env) -> Result<Response> {
    if req.method() == Method::Options {
        return Ok(Response::empty()?.with_status(204));
    }
    if req.method() != Method::Post {
        return error(405, "POST required");
    }
    let Some(auth) = req
        .headers()
        .get("Authorization")?
        .filter(|s| s.starts_with("Bearer "))
    else {
        return error(401, "login required");
    };
    // Stream the small confirmation object and enumerate all JSON fields on Wasm.
    let Ok(mut stream) = req.stream() else {
        return error(400, "invalid request");
    };
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if chunk.len() > 1024 - body.len() {
            return error(413, "request too large");
        }
        body.extend_from_slice(&chunk);
    }
    if serde_json::from_slice::<crate::account::DeleteSelf>(&body).is_err() {
        return error(400, "invalid request");
    }
    let Ok(Some(db)) = Supabase::configured(env) else {
        return error(503, "account unavailable");
    };
    let mut identity = db
        .account_request(Method::Get, "/auth/v1/user", Some(&auth))
        .await?;
    if matches!(identity.status_code(), 401 | 403) {
        return error(401, "login required");
    }
    if identity.status_code() != 200 {
        return error(503, "account unavailable");
    }
    #[derive(serde::Deserialize)]
    struct Member {
        id: uuid::Uuid,
    }
    let member = identity.json::<Member>().await?;
    if !LIMITS.with_borrow_mut(|limits| {
        limits.allow_withdrawal(member.id, Date::now().as_millis() / 1000)
    }) {
        return error(429, "check result before retrying");
    }
    let member_arg = json!({"member_id":member.id}).to_string().into_bytes();
    let Ok(mut response) = db.rpc("claim_withdrawal", member_arg).await else {
        return error(503, "account unavailable");
    };
    let Some(token) = response.json::<Option<uuid::Uuid>>().await? else {
        return error(429, "check result before retrying");
    };
    let claim = json!({"member_id":member.id,"claim_token":token}).to_string();
    let apps = format!("/rest/v1/apps?owner_id=eq.{}", member.id);
    let removed = db
        .account_request(Method::Delete, &apps, Some(&auth))
        .await?;
    if !(200..300).contains(&removed.status_code()) {
        let _ = db.rpc("release_withdrawal", claim.into_bytes()).await;
        return error(503, "account unavailable");
    }
    let path = format!("/auth/v1/admin/users/{}", member.id);
    let Ok(removed) = db.account_request(Method::Delete, &path, None).await else {
        return error(504, "result unknown");
    };
    if matches!(removed.status_code(), 502 | 503 | 504) {
        return error(504, "result unknown");
    }
    if !(200..300).contains(&removed.status_code()) && removed.status_code() != 404 {
        let _ = db.rpc("release_withdrawal", claim.into_bytes()).await;
        return error(503, "account unavailable");
    }
    Response::from_json(&json!({"deleted":true}))
}
