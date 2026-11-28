use crate::ingest::mask;
use serde::Deserialize;
use serde_json::{Value, json};
mod push;

#[cfg(target_arch = "wasm32")]
mod delivery;
#[cfg(target_arch = "wasm32")]
pub(crate) use delivery::send_resend;
#[cfg(target_arch = "wasm32")]
pub use delivery::{deliver, post, setting, valid_hook};

#[derive(Deserialize)]
struct Notice {
    id: uuid::Uuid,
    claim_token: uuid::Uuid,
    app: uuid::Uuid,
    app_name: Option<String>,
    incident: Option<uuid::Uuid>,
    event: String,
    channel: String,
    kind: Option<String>,
    feature: Option<String>,
    #[serde(skip)]
    version_label: Option<String>,
    #[serde(default)]
    is_overflow: bool,
    metric: Value,
    hook: Option<String>,
    destination: Option<String>,
    secret_id: Option<uuid::Uuid>,
    email: Option<String>,
    digest: bool,
}

fn feature_name(n: &Notice) -> String {
    let name = mask(n.feature.as_deref().unwrap_or("기능"));
    if name.contains(['/', '@', ':', '<', '>']) {
        "기능".into()
    } else {
        name.trim().into()
    }
}

fn sentence(n: &Notice) -> String {
    let name = feature_name(n);
    let count = |key: &str| n.metric[key].as_u64().unwrap_or(0);
    let mut line = match (n.event.as_str(), n.kind.as_deref()) {
        ("test", _) => "쉽앤핑 시험 알림이에요.".into(),
        ("resolved", _) => format!("업데이트 후 {name} 문제가 해결됐어요."),
        (_, Some("failure")) => format!(
            "{name} 최근 30분 {}건 중 {}건이 실패했어요.",
            count("total"),
            count("failures")
        ),
        (_, Some("slow")) if n.metric["window"].is_number() => {
            format!("{name} 기능이 느려졌어요. {}", metric_summary(n))
        }
        (_, Some("slow")) => {
            let mut text = format!("{name} 기능이 느려졌어요.");
            if let Some(ms) = n.metric["baseline"].as_f64() {
                text.push_str(&format!(" 평소 약 {:.1}초.", ms / 1000.0));
            }
            if let Some(ms) = n.metric["p50"].as_f64() {
                text.push_str(&format!(" 최근 30분 보통 약 {:.1}초.", ms / 1000.0));
            }
            format!("{text} ({}건)", count("total"))
        }
        _ => format!(
            "{name} 결과를 확인하지 못한 기록이 {}건이에요.",
            count("unconfirmed")
        ),
    };
    if n.event == "worse" {
        line.insert_str(0, "문제가 더 나빠졌어요. ");
    }
    line
}

fn app_name(n: &Notice) -> Option<String> {
    let clean: String = n
        .app_name
        .as_deref()?
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '\u{2028}' | '\u{2029}'))
        .collect();
    let masked = mask(&clean);
    let mut chars = masked.trim().chars();
    let mut name: String = chars.by_ref().take(40).collect();
    if chars.next().is_some() {
        name.push('…');
    }
    (!name.is_empty()).then_some(name)
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn event_title(n: &Notice) -> &'static str {
    match (n.event.as_str(), n.kind.as_deref()) {
        ("resolved", _) => "문제가 해결됐어요",
        ("worse", _) => "문제가 더 커졌어요",
        ("test", _) => "시험 알림이에요",
        (_, Some("failure")) => "실패가 늘었어요",
        (_, Some("slow")) => "느려졌어요",
        _ => "결과를 확인하지 못했어요",
    }
}

fn metric_summary(n: &Notice) -> String {
    let count = |key: &str| n.metric[key].as_u64().unwrap_or(0);
    match (n.event.as_str(), n.kind.as_deref()) {
        ("resolved", _) => "새 버전에서 5번 연속 성공했어요".into(),
        ("test", _) => "쉽앤핑 시험 알림이에요.".into(),
        (_, Some("failure")) => format!(
            "최근 30분 동안 {}건 중 {}건 실패",
            count("total"),
            count("failures")
        ),
        (_, Some("slow")) => {
            if let Some(window) = n.metric["window"].as_u64() {
                let mut parts = Vec::new();
                if let (Some(p50), Some(p95)) = (
                    n.metric["baseline_p50"].as_f64(),
                    n.metric["baseline_p95"].as_f64(),
                ) {
                    parts.push(format!(
                        "평소 약 {:.1}초 (보통 {:.1}초 안)",
                        p50 / 1000.0,
                        p95 / 1000.0
                    ));
                } else if let Some(ms) = n.metric["threshold"].as_f64() {
                    parts.push(format!("기준 {:.1}초", ms / 1000.0));
                }
                let mut recent = format!("최근 {window}분");
                if let Some(ms) = n.metric["p50"].as_f64() {
                    recent.push_str(&format!(" 보통 약 {:.1}초", ms / 1000.0));
                }
                if n.metric["baseline_p50"].is_number()
                    && let Some(ratio) = n.metric["severity"].as_f64()
                {
                    let ratio = (ratio * 10.0).round() / 10.0;
                    recent.push_str(&format!(", {ratio}배"));
                }
                recent.push_str(&format!(" ({}건)", count("total")));
                parts.push(recent);
                return parts.join(" → ");
            }
            let mut times = Vec::new();
            for (label, key) in [("평소", "baseline"), ("최근", "p50")] {
                if let Some(ms) = n.metric[key].as_f64() {
                    times.push(format!("{label} 약 {:.1}초", ms / 1000.0));
                }
            }
            if times.is_empty() {
                format!("최근 30분 동안 {}건", count("total"))
            } else {
                times.join(" → ")
            }
        }
        _ => format!(
            "최근 30분 동안 {}건의 결과를 확인하지 못했어요",
            count("unconfirmed")
        ),
    }
}

fn context(n: &Notice) -> String {
    let feature = feature_name(n);
    let label = if n.is_overflow {
        "기타 (따로 지켜보지 않는 기능 묶음)"
    } else {
        &feature
    };
    let mut context =
        app_name(n).map_or_else(|| label.to_owned(), |app| format!("{app} · {label}"));
    if let Some(version) = &n.version_label {
        context.push_str(&format!(" · 버전 {version}"));
    }
    context
}

fn web_origin(origin: Option<&str>) -> Option<String> {
    let url = url::Url::parse(origin?).ok()?;
    (url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none())
    .then(|| url.origin().ascii_serialization())
}

fn notice_link(n: &Notice, origin: &str) -> String {
    match n.incident {
        Some(id) => format!("{origin}/apps/{}/issues/{id}", n.app),
        None => format!("{origin}/apps/{}/notifications", n.app),
    }
}

pub(crate) struct Mail {
    subject: String,
    text: String,
    html: String,
}

impl Mail {
    fn payload(&self, from: &str, to: &str) -> Value {
        json!({"from":from,"to":[to],"subject":self.subject,"text":self.text,"html":self.html})
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn login_code_mail(code: u32) -> Mail {
    let text = format!(
        "홈 화면의 쉽앤핑에서 {code:06}을 입력해 주세요. 코드는 10분 동안 유효하고 다섯 번 틀리면 새 코드가 필요해요."
    );
    Mail {
        subject: "쉽앤핑 홈 화면 앱 로그인 코드".into(),
        html: format!(
            "<html lang=\"ko\"><h1>홈 화면 앱 로그인</h1><p>홈 화면의 쉽앤핑에 아래 숫자를 입력해 주세요.</p><strong style=\"font-size:32px\">{code:06}</strong><p>10분 안에 입력해 주세요. 다섯 번 틀리면 새 코드를 받아 주세요.</p></html>"
        ),
        text,
    }
}

pub(crate) fn install_mail(origin: &str) -> Option<Mail> {
    let link = format!("{}/install", web_origin(Some(origin))?);
    Some(Mail {
        subject: "휴대폰으로 쉽앤핑 알림 받기".into(),
        text: format!(
            "아이폰에서는 Safari로 여세요. 홈 화면에 쉽앤핑을 추가하고 알림을 켜 주세요.\n{link}"
        ),
        html: include_str!("notify/install.html").replace("{{install_url}}", &link),
    })
}

struct MailContent {
    subject: String,
    title: String,
    subtitle: Option<String>,
    summary_html: String,
    link: Option<String>,
    guidance: &'static str,
    text: Vec<String>,
}

fn text_notice(n: &Notice, origin: Option<&str>) -> String {
    let mut line = sentence(n);
    if let Some(version) = &n.version_label {
        line.push_str(&format!("\n버전 {version}"));
    }
    if let Some(name) = app_name(n) {
        line = format!("{name} · {line}");
    }
    if let Some(origin) = origin {
        line.push_str(&format!("\n쉽앤핑에서 보기 {}", notice_link(n, origin)));
    }

    line
}

fn single_notice(n: &Notice, origin: Option<&str>) -> MailContent {
    let title = event_title(n);
    let subject = match app_name(n) {
        None => "[쉽앤핑] 앱 알림이에요".to_owned(),
        Some(app) if n.event == "open" && n.kind.as_deref() == Some("failure") => {
            format!("[쉽앤핑] {app}에서 {title}")
        }
        Some(app) => format!("[쉽앤핑] {app} · {title}"),
    };
    let advice = match n.event.as_str() {
        "open" | "worse" => "자세히 보기에서 AI에게 고쳐 달라고 할 요청문을 복사할 수 있어요.",
        "resolved" => "따로 하실 일은 없어요.",
        _ => "",
    };

    MailContent {
        subject,
        title: title.into(),
        subtitle: Some(context(n)),
        summary_html: escape(&metric_summary(n)),
        link: origin.map(|origin| notice_link(n, origin)),
        guidance: advice,
        text: vec![text_notice(n, origin)],
    }
}

fn digest(rows: &[Notice], extra: u32, origin: Option<&str>) -> MailContent {
    let shown = rows.len().min(10);
    let mut text = Vec::new();
    let mut details = Vec::new();
    for n in &rows[..shown] {
        text.push(text_notice(n, origin));
        details.push(format!(
            "<li><strong>{}</strong> · {}<br>{}</li>",
            escape(&context(n)),
            escape(event_title(n)),
            escape(&metric_summary(n))
        ));
    }
    let total = rows.len() as u64 + u64::from(extra);
    let title = format!("모아 둔 알림 {total}건이에요");
    let mut list = format!(
        "<ul style=\"margin:0;padding-left:20px\">{}</ul>",
        details.join("\n")
    );
    if total > shown as u64 {
        let overflow = format!("미뤄 둔 알림이 {}건 더 있어요.", total - shown as u64);
        list.push_str(&format!(
            "<p style=\"margin:12px 0 0\">{}</p>",
            escape(&overflow)
        ));
        text.push(overflow);
    }
    let link = origin.map(|origin| format!("{origin}/apps"));
    if let Some(link) = &link {
        text.push(format!("쉽앤핑에서 보기 {link}"));
    }

    MailContent {
        subject: format!("[쉽앤핑] {title}"),
        title,
        subtitle: None,
        summary_html: list,
        link,
        guidance: "",
        text,
    }
}

fn render_mail(rows: &[Notice], extra: u32, origin: Option<&str>) -> Mail {
    let origin = web_origin(origin);
    let mut mail = if rows[0].digest {
        digest(rows, extra, origin.as_deref())
    } else {
        single_notice(&rows[0], origin.as_deref())
    };
    let links = mail.link.map_or_else(String::new, |url| {
        format!(include_str!("notify/links.html"), url = escape(&url))
    });
    let subtitle = mail.subtitle.map_or_else(String::new, |label| {
        format!(
            "<p style=\"margin:6px 0 0;color:#CFC5E8;font-size:14px\">{}</p>",
            escape(&label)
        )
    });
    let guidance = if mail.guidance.is_empty() {
        String::new()
    } else {
        mail.text.push(mail.guidance.into());
        format!("<p style=\"margin:16px 0 0\">{}</p>", escape(mail.guidance))
    };
    let html = format!(
        include_str!("notify/frame.html"),
        title = escape(&mail.title),
        subtitle = subtitle,
        summary = mail.summary_html,
        links = links,
        guidance = guidance
    );
    Mail {
        subject: mail.subject,
        text: mail.text.join("\n\n"),
        html,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "https://web.test";
    const APP: &str = "00000000-0000-4000-8000-000000000001";
    const ISSUE: &str = "00000000-0000-4000-8000-000000000002";

    fn notice(event: &str, kind: &str) -> Notice {
        serde_json::from_value(json!({
            "id": ISSUE, "claim_token": ISSUE, "app": APP, "incident": ISSUE,
            "event": event, "channel": "email", "kind": kind, "feature": "기타",
            "metric": {"total": 9, "failures": 9, "baseline": 1100, "p50": 3400},
            "app_name": "트루바", "digest": false
        }))
        .unwrap()
    }

    #[test]
    fn push_uses_only_display_fields_and_the_issue_route() {
        let mut n = notice("open", "slow");
        n.feature = Some("장소 목록 보기".into());
        n.metric = json!({"baseline_p50":200,"p50":1400,"error":"private diagnostic"});
        let body: Value = serde_json::from_str(&push::payload(&n)).unwrap();
        assert_eq!(
            body,
            json!({"title":"[쉽앤핑] 트루바 · 장소 목록 보기가 느려졌어요","body":"평소 약 0.2초 → 지금 약 1.4초","url":format!("/apps/{APP}/issues/{ISSUE}")})
        );
    }

    #[test]
    fn subjects_identify_app_and_event() {
        for (event, kind, subject) in [
            ("open", "failure", "[쉽앤핑] 트루바에서 실패가 늘었어요"),
            ("open", "slow", "[쉽앤핑] 트루바 · 느려졌어요"),
            ("worse", "slow", "[쉽앤핑] 트루바 · 문제가 더 커졌어요"),
            ("resolved", "failure", "[쉽앤핑] 트루바 · 문제가 해결됐어요"),
        ] {
            let payload = render_mail(&[notice(event, kind)], 0, Some(ORIGIN));
            assert_eq!(payload.subject, subject);
        }
    }

    #[test]
    fn subject_names_are_single_line_masked_and_bounded() {
        let mut row = notice("open", "slow");
        for (input, expected) in [
            (" 트\r\n루\u{0000}바\u{2028}\u{0085} ", "트루바"),
            ("owner@example.invalid", "[가림]"),
            ("\r\n", ""),
        ] {
            row.app_name = Some(input.into());
            assert_eq!(app_name(&row).as_deref().unwrap_or_default(), expected);
        }
        row.app_name = Some("양".repeat(40));
        assert_eq!(app_name(&row), row.app_name);
        row.app_name = Some("양".repeat(41));
        assert_eq!(app_name(&row), Some(format!("{}…", "양".repeat(40))));
        row.app_name = None;
        assert_eq!(
            render_mail(&[row], 0, None).subject,
            "[쉽앤핑] 앱 알림이에요"
        );
    }

    #[test]
    fn slow_mail_uses_the_detection_window_and_normal_range() {
        let mut n = notice("open", "slow");
        n.metric = json!({"baseline_p50":200,"baseline_p95":400,"p50":1400,"severity":7,"window":10,"total":12});
        let mail = render_mail(&[n], 0, Some(ORIGIN));
        for body in [&mail.html, &mail.text] {
            for expected in [
                "평소 약 0.2초",
                "보통 0.4초 안",
                "최근 10분",
                "약 1.4초",
                "7배",
                "12건",
            ] {
                assert!(body.contains(expected), "{expected} missing from {body}");
            }
        }
    }

    #[test]
    fn install_mail_contains_only_a_public_install_link() {
        let mail = install_mail("https://web.example.invalid").unwrap();
        let url = "https://web.example.invalid/install";
        assert_eq!(mail.html.matches("href=").count(), 1);
        assert!(mail.html.contains(&format!("href=\"{url}\"")));
        assert!(mail.text.ends_with(url));
        assert!(install_mail("https://web.example.invalid/?key=private").is_none());
    }

    #[test]
    fn resend_contains_safe_html_and_plain_text() {
        let mut row = notice("open", "failure");
        row.app_name = Some("<script>&\"'".into());
        row.metric["raw"] = json!("private-body");
        let payload = render_mail(&[row], 0, Some(ORIGIN)).payload("from", "to");
        let html = payload["html"].as_str().unwrap();
        let text = payload["text"].as_str().unwrap();
        assert!(html.contains("&lt;script&gt;&amp;&quot;&#39;"));
        assert!(!html.contains("<script>"));
        assert!(html.contains("최근 30분 동안 9건 중 9건 실패"));
        assert!(text.contains("<script>") && text.contains("9건 중 9건이 실패했어요."));
        let link = format!("{ORIGIN}/apps/{APP}/issues/{ISSUE}");
        assert!(text.contains(&link));
        assert_eq!(html.matches(&link).count(), 2);
        assert_eq!(html.matches(&format!("href=\"{link}\"")).count(), 2);
        assert!(!payload.to_string().contains("private-body"));
    }

    #[test]
    fn only_overflow_features_get_the_group_description() {
        let mut row = notice("open", "failure");
        assert_eq!(context(&row), "트루바 · 기타");
        row.is_overflow = true;
        assert_eq!(
            context(&row),
            "트루바 · 기타 (따로 지켜보지 않는 기능 묶음)"
        );
    }

    #[test]
    fn digest_counts_overflow_and_links_to_apps() {
        let rows: Vec<_> = (0..11)
            .map(|i| {
                let mut row = notice("open", "slow");
                row.digest = true;
                row.app_name = Some(format!("앱({i})<script>&\"'"));
                let feature = if i == 0 { "<script>&\"'" } else { "검색&\"'" };
                row.feature = Some(feature.into());
                row
            })
            .collect();
        let mail = render_mail(&rows, 2, Some(ORIGIN));
        assert_eq!(mail.subject, "[쉽앤핑] 모아 둔 알림 13건이에요");
        assert!(mail.html.contains("앱(9)") && !mail.html.contains("앱(10)"));
        let escaped_item = concat!(
            "<li><strong>앱(9)&lt;script&gt;&amp;&quot;&#39;",
            " · 검색&amp;&quot;&#39;</strong>"
        );
        assert!(mail.html.contains(escaped_item));
        assert!(!mail.html.contains("<script>"));
        assert!(
            mail.html
                .contains("앱(0)&lt;script&gt;&amp;&quot;&#39; · 기능</strong>")
        );
        assert!(
            mail.html.contains("3건 더") && mail.html.contains("평소 약 1.1초 → 최근 약 3.4초")
        );
        assert_eq!(mail.html.matches("쉽앤핑에서 자세히 보기").count(), 1);
        assert!(mail.html.contains("href=\"https://web.test/apps\""));
    }

    #[test]
    fn previews_match_rendered_mail() {
        fn assert_preview(rendered: &str, preview: &str) {
            assert_eq!(
                rendered.trim_end().replace("\r\n", "\n"),
                preview.trim_end().replace("\r\n", "\n")
            );
        }

        let kinds = [
            ("open", "failure", "기타", true),
            ("open", "slow", "검색", false),
            ("resolved", "failure", "결제", false),
        ];
        let mut rows = Vec::new();
        for ((event, kind, feature, is_overflow), preview) in kinds.into_iter().zip([
            include_str!("../../docs/design/mail/alert-preview/failure.html"),
            include_str!("../../docs/design/mail/alert-preview/slow.html"),
            include_str!("../../docs/design/mail/alert-preview/resolved.html"),
        ]) {
            let mut n = notice(event, kind);
            n.feature = Some(feature.into());
            n.is_overflow = is_overflow;
            assert_preview(
                &render_mail(std::slice::from_ref(&n), 0, Some(ORIGIN)).html,
                preview,
            );
            n.digest = true;
            rows.push(n);
        }
        assert_preview(
            &render_mail(&rows, 0, Some(ORIGIN)).html,
            include_str!("../../docs/design/mail/alert-preview/digest.html"),
        );
    }

    #[test]
    fn resolved_and_invalid_origin() {
        let mail = render_mail(
            &[notice("resolved", "failure")],
            0,
            Some("javascript:alert"),
        );
        assert!(mail.html.contains("새 버전에서 5번 연속 성공했어요"));
        assert!(mail.html.contains("따로 하실 일은 없어요."));
        assert!(!mail.html.contains("href="));
    }
}
