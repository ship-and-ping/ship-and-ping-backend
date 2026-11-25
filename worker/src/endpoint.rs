use crate::ingest::{ApiError, Counts, MAX_BYTES, credential, prepare};
use futures_util::StreamExt;
use serde_json::json;
use worker::*;

trait BatchSink {
    async fn submit(&self, body: Vec<u8>, counts: Counts) -> Result<Counts>;
}
struct Supabase<'a>(&'a Env);
impl BatchSink for Supabase<'_> {
    async fn submit(&self, body: Vec<u8>, counts: Counts) -> Result<Counts> {
        let env = self.0;
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
            return Ok(counts);
        }
        let h = Headers::new();
        h.set("apikey", &key)?;
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
            &format!("{}/rest/v1/rpc/ingest_batch", url.trim_end_matches('/')),
            &init,
        )?;
        let mut response = Fetch::Request(req).send().await?;
        if !(200..300).contains(&response.status_code()) {
            return Err(Error::RustError("RPC failed".into()));
        }
        let mut result: Counts = response.json().await?;
        result.dropped += counts.dropped;
        Ok(result)
    }
}
fn error(status: u16, message: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({"error":message}))?.with_status(status))
}
async fn ingest(mut req: Request, env: Env) -> Result<Response> {
    if req.path() != "/v1/ingest" {
        return error(404, "not found");
    }
    if req.method() == Method::Options {
        return Ok(Response::empty()?.with_status(204));
    }
    if req.method() != Method::Post {
        return error(405, "POST required");
    }
    let headers = req.headers();
    let auth = headers.get("Authorization")?.unwrap_or_default();
    if credential(&auth).is_err() {
        return error(401, "invalid key format");
    }
    let content_type = headers.get("Content-Type")?.unwrap_or_default();
    if !content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("application/json")
    {
        return error(400, "application/json required");
    }
    if headers
        .get("Content-Length")?
        .and_then(|v| v.parse::<u64>().ok())
        .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return error(413, "batch too large");
    }
    let now = Date::now().as_millis() as i64;
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
    let (rpc, counts) = match prepare(&auth, &body, now) {
        Ok(out) => out,
        Err(ApiError::TooLarge) => return error(413, "batch too large"),
        Err(ApiError::Unauthorized) => return error(401, "invalid key format"),
        Err(ApiError::Invalid) => return error(400, "invalid batch"),
    };
    match Supabase(&env).submit(rpc, counts).await {
        Ok(counts) => Ok(Response::from_json(&counts)?.with_status(202)),
        Err(_) => error(503, "storage unavailable"),
    }
}
#[event(fetch)]
pub async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let mut response = ingest(req, env).await?;
    let h = response.headers_mut();
    h.set("Access-Control-Allow-Origin", "*")?;
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS")?;
    h.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
    )?;
    Ok(response)
}
