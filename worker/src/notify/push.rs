use super::{Notice, app_name, event_title, feature_name, metric_summary, notice_link};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes128Gcm, Nonce};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use hkdf::Hkdf;
use p256::ecdh::diffie_hellman;
use p256::ecdsa::{Signature, SigningKey, signature::Signer};
use p256::elliptic_curve::{rand_core::OsRng, sec1::ToEncodedPoint};
use p256::{PublicKey, SecretKey};
use serde::Deserialize;
use serde_json::json;
use sha2::Sha256;

#[derive(Deserialize)]
pub(super) struct Target {
    endpoint: String,
    p256dh: String,
    auth: String,
}

fn push_origin(endpoint: &str) -> Option<String> {
    let url = url::Url::parse(endpoint).ok()?;
    let host = url.host_str()?;
    // Only browser-operated push services can receive server-side requests.
    let provider = matches!(
        host,
        "fcm.googleapis.com" | "updates.push.services.mozilla.com" | "web.push.apple.com"
    ) || host.ends_with(".push.apple.com")
        || host.ends_with(".notify.windows.com")
        || host.ends_with(".push.services.mozilla.com");
    (provider
        && url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.path() != "/")
        .then(|| url.origin().ascii_serialization())
}

fn authorization(private: &str, public: &str, origin: &str, now: u64) -> Option<String> {
    let key = SigningKey::from_slice(&B64.decode(private).ok()?).ok()?;
    if B64.encode(key.verifying_key().to_encoded_point(false).as_bytes()) != public {
        return None;
    }
    let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
    let claims = json!({"aud":origin,"exp":now+12*3600,"sub":"https://ship-and-ping.pages.dev"});
    let input = format!("{header}.{}", B64.encode(claims.to_string()));
    let signature: Signature = key.sign(input.as_bytes());
    Some(format!(
        "vapid t={input}.{}, k={public}",
        B64.encode(signature.to_bytes())
    ))
}

fn encrypt(
    target: &Target,
    payload: &[u8],
    server: &SecretKey,
    salt: &[u8; 16],
) -> Option<Vec<u8>> {
    if payload.len() > 3993 {
        return None;
    }
    let auth: [u8; 16] = B64.decode(&target.auth).ok()?.try_into().ok()?;
    let receiver = PublicKey::from_sec1_bytes(&B64.decode(&target.p256dh).ok()?).ok()?;
    let sender = server.public_key().to_encoded_point(false);
    let shared = diffie_hellman(server.to_nonzero_scalar(), receiver.as_affine());
    let info = [
        b"WebPush: info\0".as_slice(),
        receiver.to_encoded_point(false).as_bytes(),
        sender.as_bytes(),
    ]
    .concat();
    let mut ikm = [0; 32];
    Hkdf::<Sha256>::new(Some(&auth), shared.raw_secret_bytes())
        .expand(&info, &mut ikm)
        .ok()?;
    let content = Hkdf::<Sha256>::new(Some(salt), &ikm);
    let mut key = [0; 16];
    let mut nonce = [0; 12];
    content
        .expand(b"Content-Encoding: aes128gcm\0", &mut key)
        .ok()?;
    content
        .expand(b"Content-Encoding: nonce\0", &mut nonce)
        .ok()?;
    let plaintext = [payload, &[2]].concat();
    let ciphertext = Aes128Gcm::new_from_slice(&key)
        .ok()?
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_slice())
        .ok()?;
    Some(
        [
            salt.as_slice(),
            &4096_u32.to_be_bytes(),
            &[65],
            sender.as_bytes(),
            &ciphertext,
        ]
        .concat(),
    )
}

pub(super) fn payload(n: &Notice) -> String {
    let app = app_name(n).unwrap_or_else(|| "내 앱".into());
    let title = if n.event == "test" {
        format!("[쉽앤핑] {app} · 시험 알림이에요")
    } else {
        let feature: String = feature_name(n)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(60)
            .collect();
        let suffix = if n.event == "open" && n.kind.as_deref() == Some("slow") {
            let last = feature.chars().last().unwrap_or(' ');
            let particle = if ('가'..='힣').contains(&last)
                && (last as u32 - '가' as u32).is_multiple_of(28)
            {
                "가"
            } else {
                "이"
            };
            format!("{particle} 느려졌어요")
        } else {
            format!(" · {}", event_title(n))
        };
        format!("[쉽앤핑] {app} · {feature}{suffix}")
    };
    let body = match (
        n.kind.as_deref(),
        n.event.as_str(),
        n.metric["baseline_p50"]
            .as_f64()
            .or(n.metric["baseline"].as_f64()),
        n.metric["p50"].as_f64(),
    ) {
        (Some("slow"), "open" | "worse", Some(base), Some(now)) => format!(
            "평소 약 {:.1}초 → 지금 약 {:.1}초",
            base / 1000.0,
            now / 1000.0
        ),
        _ => metric_summary(n),
    };
    json!({"title":title,"body":body,"url":notice_link(n,"")}).to_string()
}

fn result(status: u16) -> &'static str {
    match status {
        200..=299 => "sent",
        404 | 410 => "gone",
        _ => "retry",
    }
}

fn configured<'a>(private: Option<&'a str>, public: Option<&'a str>) -> Option<(&'a str, &'a str)> {
    Some((
        private.filter(|v| !v.is_empty())?,
        public.filter(|v| !v.is_empty())?,
    ))
}

#[cfg(target_arch = "wasm32")]
pub(super) async fn send(n: &Notice, target: &Target, env: &worker::Env) -> &'static str {
    use worker::*;
    let private = env.secret("VAPID_PRIVATE_KEY").ok().map(|v| v.to_string());
    let public = super::setting(env, "VAPID_PUBLIC_KEY");
    let Some((private, public)) = configured(private.as_deref(), public.as_deref()) else {
        return "unconfigured";
    };
    let Some(origin) = push_origin(&target.endpoint) else {
        return "retry";
    };
    let Some(token) = authorization(private, public, &origin, Date::now().as_millis() / 1000)
    else {
        return "unconfigured";
    };
    let mut salt = [0; 16];
    if getrandom::getrandom(&mut salt).is_err() {
        return "retry";
    }
    let Some(body) = encrypt(
        target,
        payload(n).as_bytes(),
        &SecretKey::random(&mut OsRng),
        &salt,
    ) else {
        return "retry";
    };
    let headers = Headers::new();
    for (name, value) in [
        ("Authorization", token.as_str()),
        ("Content-Type", "application/octet-stream"),
        ("Content-Encoding", "aes128gcm"),
        ("TTL", "900"),
        ("Urgency", "high"),
    ] {
        if headers.set(name, value).is_err() {
            return "retry";
        }
    }
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_redirect(RequestRedirect::Manual)
        .with_body(Some(
            worker::js_sys::Uint8Array::from(body.as_slice()).into(),
        ));
    let Ok(req) = Request::new_with_init(&target.endpoint, &init) else {
        return "retry";
    };
    let deadline = web_sys::AbortSignal::timeout_with_u32(3_000).into();
    Fetch::Request(req)
        .send_with_signal(&deadline)
        .await
        .map_or("retry", |r| result(r.status_code()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;
    #[test]
    fn rfc8291_section_five() {
        let target = Target {
            endpoint: String::new(),
            p256dh: concat!(
                "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx",
                "aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
            )
            .into(),
            auth: "BTBZMqHH6r4Tts7J_aSIgg".into(),
        };
        // Public RFC 8291 example, not a VAPID signing key.
        let key = SecretKey::from_slice(
            &B64.decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
                .unwrap(),
        )
        .unwrap();
        let salt = B64
            .decode("DGv6ra1nlYgDCS1FRnbzlw")
            .unwrap()
            .try_into()
            .unwrap();
        let result = encrypt(
            &target,
            b"When I grow up, I want to be a watermelon",
            &key,
            &salt,
        )
        .unwrap();
        assert_eq!(
            B64.encode(result),
            concat!(
                "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml",
                "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT",
                "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
            )
        );
    }
    #[test]
    fn verifies_vapid_signature_and_claims() {
        let key = SigningKey::random(&mut OsRng);
        let public = B64.encode(key.verifying_key().to_encoded_point(false).as_bytes());
        let origin = push_origin("https://web.push.apple.com/example").unwrap();
        let header = authorization(&B64.encode(key.to_bytes()), &public, &origin, 100).unwrap();
        let (token, k) = header
            .strip_prefix("vapid t=")
            .unwrap()
            .split_once(", k=")
            .unwrap();
        assert_eq!(k, public);
        let (input, sig) = token.rsplit_once('.').unwrap();
        key.verifying_key()
            .verify(
                input.as_bytes(),
                &Signature::from_slice(&B64.decode(sig).unwrap()).unwrap(),
            )
            .unwrap();
        let (h, c) = input.split_once('.').unwrap();
        let decode =
            |v| serde_json::from_slice::<serde_json::Value>(&B64.decode(v).unwrap()).unwrap();
        assert_eq!(decode(h)["alg"], "ES256");
        assert_eq!(
            decode(c),
            json!({"aud":"https://web.push.apple.com","exp":43300,"sub":"https://ship-and-ping.pages.dev"})
        );
        assert!(push_origin("https://web.push.apple.com.example.org/abc").is_none());
    }
    #[test]
    fn missing_keys_and_provider_responses() {
        assert!(configured(None, Some("public")).is_none());
        assert!(configured(Some("private"), None).is_none());
        assert_eq!(result(404), "gone");
        assert_eq!(result(410), "gone");
        assert_eq!(result(201), "sent");
        assert_eq!(result(503), "retry");
    }
}
