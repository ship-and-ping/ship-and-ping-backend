use serde_json::{Value, json};
use ship_ping_ingest::ingest::{ApiError, prepare};
const NOW: i64 = 1_800_000_000_000;
const AT: &str = "2027-01-15T08:00:00Z";
const ID: &str = "badcafe0-0000-4000-8000-000000000001";
fn key() -> String {
    ["Bearer sp", "pub", "fixture"].join("_")
}
fn short_key() -> String {
    ["sk", "abcdefghijklmnop"].join("_")
}
fn request() -> Value {
    json!({"type":"request","route":"/a/12","method":"GET","status":200,"duration_ms":50,"ts":AT})
}
fn batch(records: Vec<Value>) -> Value {
    json!({"spec":"sp-1","batch_id":ID,"platform":"browser","app_version":"v1","sent_at":AT,"records":records})
}
fn run(input: Value) -> Result<Value, ApiError> {
    let (rpc, _) = prepare(&key(), &serde_json::to_vec(&input).unwrap(), NOW)?;
    Ok(serde_json::from_slice(&rpc).unwrap())
}
#[test]
fn app_version_preserves_build_times_and_masks_key_prefixes() {
    for (version, expected) in [
        ("2026.11.26.1530", "2026.11.26.1530"),
        ("1764120000", "1764120000"),
        ("1764120000123", "1764120000123"),
        ("2026.02.1530.0001", "2026.02.1530.0001"),
        ("v20261126-1530", "v20261126-1530"),
        ("1764120000-ＳＰ＿ＰＵＢ＿demo", "1764120000-[가림]"),
        ("v1-sk_abcdefghijklmnop", "v1-[가림]"),
        ("v1xsk_abcdefghijklmnop", "v1xsk_abcdefghijklmnop"),
    ] {
        let mut input = batch(vec![request()]);
        input["app_version"] = json!(version);
        assert_eq!(run(input).unwrap()["payload"]["app_version"], expected);
    }
}
#[test]
fn masks_identifiers_and_private_text_before_rpc() {
    let mut r = request();
    r["route"] = json!(format!("/a/123/{ID}/a123456789012345/short?email=x"));
    r["status"] = json!(500);
    r["error_message"] = json!(format!(
        "a@example.test 010-1234-5678 Bearer example.token {} eyJabc.def.ghi {}",
        short_key(),
        "가".repeat(400)
    ));
    let mut input = batch(vec![r]);
    input["app_version"] = json!(format!("v1-{}", ["sp", "srv", "fixture"].join("_")));
    let rpc = run(input).unwrap();
    assert_eq!(rpc["payload"]["app_version"], "v1-[가림]");
    assert_eq!(rpc["payload"]["stats"][0]["route"], "/a/:id/:id/:id/short");
    assert!(rpc["payload"]["error_samples"][0]["message"].is_null());
    assert_eq!(
        rpc["app_key_hash"],
        "4069827db68e902782e6c46c90b4dbcab15758c2183f7df1bc1ed7f6294acc53"
    );
}
#[test]
fn masks_session_paths_and_urlsafe_tokens() {
    let mut row = request();
    row["route"] = json!(
        "/team;jsessionid=private/path/abc123-def456_789/QUJDREVGR0hJSktMTU4=/view;mode=grid?q=private"
    );
    let out = run(batch(vec![row])).unwrap();
    assert_eq!(
        out["payload"]["stats"][0]["route"],
        "/team/path/:id/:id/view"
    );
}

#[test]
fn masks_credentials_in_attempt_results() {
    for message in [
        &["sp_pub", "sample"].join("_"),
        &["sp_srv", "sample"].join("_"),
        &["sb_secret", "sample"].join("_"),
        &["sb_publishable", "sample"].join("_"),
        "Basic YWJjZGVmZ2hpamts",
        "Cookie: sid=one; prefs=two",
        "Set-Cookie: sid=one; Secure; Path=/",
        "token=demo",
        "key=demo",
        "access_token=demo",
        "password=demo",
        "Bearer: fixture",
        "a%40example.test",
    ] {
        let row = json!({"type":"attempt_result","attempt_id":ID,"feature_key":"join","source":"browser","result":"failure","ts":AT,"error_message":message});
        let out = run(batch(vec![row])).unwrap();
        assert_eq!(
            out["payload"]["attempts"][0]["error_message"],
            Value::Null,
            "{message}"
        );
    }
}

#[test]
fn validates_path_after_removing_query_and_fragment() {
    let path200 = format!("/{}", "x/".repeat(99) + "x");
    let cases = [
        (
            format!("{path200}?q={}", "x".repeat(80)),
            Some(path200.as_str()),
        ),
        (format!("{path200}x"), None),
        ("relative".into(), None),
        (
            "/short/123456789abcdef/123456789abcdefg#fragment".into(),
            Some("/short/:id/:id"),
        ),
    ];
    for (route, expected) in cases {
        let mut row = request();
        row["route"] = json!(route);
        let (bytes, count) =
            prepare(&key(), &serde_json::to_vec(&batch(vec![row])).unwrap(), NOW).unwrap();
        assert_eq!(count.accepted, usize::from(expected.is_some()));
        let rpc: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(rpc["payload"]["stats"][0]["route"].as_str(), expected);
    }
}

#[test]
fn request_error_samples_and_status_bounds() {
    let mut rows = vec![];
    let short = short_key();
    for (status, kind) in [
        (99, None),
        (100, None),
        (200, None),
        (200, Some(short.as_str())),
        (404, Some(short.as_str())),
        (599, None),
        (600, None),
    ] {
        let mut r = request();
        r["status"] = json!(status);
        r["error_kind"] = json!(kind);
        r["error_message"] = json!("task_queue");
        rows.push(r);
    }
    let mut lower = request();
    lower["method"] = json!("get");
    rows.push(lower);
    let (bytes, count) = prepare(&key(), &serde_json::to_vec(&batch(rows)).unwrap(), NOW).unwrap();
    assert_eq!((count.accepted, count.dropped), (5, 3));
    let rpc: Value = serde_json::from_slice(&bytes).unwrap();
    let stats = &rpc["payload"]["stats"][0];
    assert_eq!(stats["failures"], 2);
    assert_eq!(stats["client_errors"], 1);
    let samples = rpc["payload"]["error_samples"].as_array().unwrap();
    assert_eq!(samples.len(), 3);
    assert_eq!(samples[0]["error_kind"], Value::Null);
    assert_eq!(samples[1]["error_kind"], Value::Null);
    assert!(samples.iter().all(|s| s["message"].is_null()));
}

#[test]
fn deep_events_validate_fields_and_mask_result_details() {
    let start = json!({"type":"attempt_start","feature_key":"join","attempt_id":ID,"ts":AT});
    let end = json!({"type":"attempt_result","feature_key":"join","attempt_id":ID,"ts":AT,"source":"browser","result":"failure",
        "step":"token=private","error_kind":short_key(),"error_message":"x%40example.test"});
    let mut empty = start.clone();
    empty["feature_key"] = json!(" ");
    let mut late = start.clone();
    late["ts"] = json!("2027-01-10T08:00:00Z");
    let mut invalid = end.clone();
    invalid["result"] = json!("unknown");
    let data = serde_json::to_vec(&batch(vec![start, empty, late, invalid, end])).unwrap();
    let (bytes, count) = prepare(&key(), &data, NOW).unwrap();
    assert_eq!((count.accepted, count.dropped), (2, 3));
    let rpc: Value = serde_json::from_slice(&bytes).unwrap();
    let attempts = rpc["payload"]["attempts"].as_array().unwrap();
    assert_eq!(attempts.len(), 2);
    assert_eq!(attempts[0]["type"], "attempt_start");
    assert_eq!(attempts[1]["step"], Value::Null);
    for field in ["error_kind", "error_message"] {
        assert_eq!(attempts[1][field], Value::Null);
    }
}

#[test]
fn limits_inclusive() {
    let mut data = serde_json::to_vec(&batch(vec![request(); 100])).unwrap();
    data.resize(65536, b' ');
    assert_eq!(prepare(&key(), &data, NOW).unwrap().1.accepted, 100);
    data.push(b' ');
    assert_eq!(prepare(&key(), &data, NOW).unwrap_err(), ApiError::TooLarge);
    assert_eq!(
        run(batch(vec![request(); 101])).unwrap_err(),
        ApiError::TooLarge
    );
}
#[test]
fn validates_envelope_fields_and_records() {
    for (k, v) in [
        ("spec", json!("old")),
        ("app_id", json!(ID)),
        ("batch_id", json!("x")),
        ("platform", json!("x")),
        ("sent_at", json!(0)),
        ("app_version", json!("a".repeat(65))),
    ] {
        let mut b = batch(vec![request()]);
        b[k] = v;
        assert_eq!(run(b).unwrap_err(), ApiError::Invalid);
    }
    for (k, v) in [
        ("route", json!("a".repeat(201))),
        ("method", json!("")),
        ("duration_ms", json!(-1)),
        ("duration_ms", json!(600001)),
        ("status", json!(5.5)),
        ("status", json!(600)),
        ("duration_ms", json!(2.5)),
        ("ts", json!("bad")),
        ("type", json!("unknown")),
    ] {
        let mut r = request();
        r[k] = v;
        let (body, counts) = prepare(
            &key(),
            &serde_json::to_vec(&batch(vec![request(), r, request()])).unwrap(),
            NOW,
        )
        .unwrap();
        assert_eq!((counts.accepted, counts.dropped), (2, 1));
        let rpc: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(rpc["payload"]["stats"][0]["total"], 2);
    }
    for key in ["", "Bearer sp_pub_", "Bearer sp_srv_a b", "Basic sp_pub_ok"] {
        assert_eq!(
            prepare(key, b"{}", NOW).unwrap_err(),
            ApiError::Unauthorized
        );
    }
}
#[test]
fn assigns_time_bins_and_classifies_errors() {
    let mut rows = vec![];
    for (status, ms) in [(200, 50), (500, 51), (404, 30000), (0, 600000)] {
        let mut r = request();
        if status != 200 {
            r["ts"] = json!("2027-01-15T08:04:59.999Z");
        }
        r["status"] = json!(status);
        r["duration_ms"] = json!(ms);
        rows.push(r);
    }
    let mut old = request();
    old["ts"] = json!("2027-01-14T07:59:59Z");
    rows.push(old);
    let mut next = request();
    next["ts"] = json!("2027-01-15T08:05:00Z");
    rows.push(next);
    let (bytes, count) = prepare(&key(), &serde_json::to_vec(&batch(rows)).unwrap(), NOW).unwrap();
    assert_eq!((count.accepted, count.dropped), (5, 1));
    let rpc: Value = serde_json::from_slice(&bytes).unwrap();
    let stats = rpc["payload"]["stats"].as_array().unwrap();
    assert_eq!(stats.len(), 2);
    assert_eq!(stats[0]["bucket"], AT);
    assert_eq!(stats[1]["bucket"], "2027-01-15T08:05:00Z");
    let row = stats.iter().find(|r| r["total"] == 4).unwrap();
    assert_eq!(row["duration_sum_ms"], 630101);
    assert_eq!(row["failures"], 2);
    assert_eq!(row["client_errors"], 1);
    assert_eq!(
        row["hist"],
        json!([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1])
    );
}
#[test]
fn refined_histogram_uses_inclusive_upper_bounds() {
    let rows = [3000, 3001, 3300, 5000, 5001, 6300, 6301, 7500, 7501]
        .into_iter()
        .map(|ms| {
            let mut row = request();
            row["duration_ms"] = json!(ms);
            row
        })
        .collect();
    let (bytes, _) = prepare(&key(), &serde_json::to_vec(&batch(rows)).unwrap(), NOW).unwrap();
    let rpc: Value = serde_json::from_slice(&bytes).unwrap();
    let hist = rpc["payload"]["stats"][0]["hist"].as_array().unwrap();
    let occupied: Vec<_> = hist
        .iter()
        .enumerate()
        .filter_map(|(i, n)| {
            let count = n.as_u64().unwrap();
            (count > 0).then_some((i, count))
        })
        .collect();
    assert_eq!(
        occupied,
        [
            (9, 1),
            (10, 2),
            (16, 1),
            (17, 1),
            (21, 1),
            (22, 1),
            (25, 1),
            (26, 1)
        ]
    );
}
#[test]
fn timestamps_include_both_24h_edges() {
    let mut rows = Vec::new();
    for offset in [-86_400_001, -86_400_000, 86_400_000, 86_400_001] {
        let mut row = request();
        row["ts"] = json!(chrono::DateTime::from_timestamp_millis(NOW + offset).unwrap());
        rows.push(row);
    }
    let (_, counts) = prepare(&key(), &serde_json::to_vec(&batch(rows)).unwrap(), NOW).unwrap();
    assert_eq!((counts.accepted, counts.dropped), (2, 2));
}

#[test]
fn deep_results_enforce_server_source() {
    let row = json!({"type":"attempt_result","attempt_id":ID,"feature_key":"join","source":"server","result":"success","ts":AT});
    let data = serde_json::to_vec(&batch(vec![row, request()])).unwrap();
    let (rpc, counts) = prepare(&key(), &data, NOW).unwrap();
    assert_eq!((counts.accepted, counts.dropped), (1, 1));
    let rpc: Value = serde_json::from_slice(&rpc).unwrap();
    assert_eq!(rpc["payload"]["attempts"], json!([]));
    assert_eq!(
        prepare(&["Bearer sp", "srv", "fixture"].join("_"), &data, NOW)
            .unwrap()
            .1
            .accepted,
        2
    );
}

#[test]
fn masks_overlaps_nested_prefixes_and_ascii_phone_neighbors() {
    let nested = format!("x{}_{}", short_key(), short_key());
    let cases = [
        (nested, format!("x{}_[가림]", short_key())),
        (format!("token={}", short_key()), "token=[가림]".into()),
        ("a01012345678z".into(), "a[가림]z".into()),
        ("1234567890123456 01012345678".into(), "[가림]".into()),
    ];
    for (message, _) in cases {
        let mut row = request();
        row["status"] = json!(500);
        row["error_message"] = json!(message);
        row["route"] = json!("/Bearer: abc/X-Key: demo/ordinary");
        let out = run(batch(vec![row])).unwrap();
        assert_eq!(out["payload"]["error_samples"][0]["message"], Value::Null);
        assert_eq!(out["payload"]["stats"][0]["route"], "/:id/:id/ordinary");
    }
}

#[test]
fn shared_sanitize_vectors() {
    #[derive(serde::Deserialize)]
    struct Case {
        input: String,
        expected: String,
    }
    #[derive(serde::Deserialize)]
    struct Diagnostic {
        input: String,
        message: Option<String>,
        kind: Option<String>,
        step: Option<String>,
    }
    #[derive(serde::Deserialize)]
    struct Matrix {
        names: Vec<String>,
        forms: Vec<String>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Cases {
        matrix: Matrix,
        omitted_messages: Vec<String>,
        diagnostics: Vec<Diagnostic>,
        route: Vec<Case>,
        version: Vec<Case>,
    }
    let mut cases: Cases =
        serde_json::from_str(include_str!("../../docs/specs/sanitize-vectors.json")).unwrap();
    for name in &cases.matrix.names {
        for form in &cases.matrix.forms {
            cases.omitted_messages.push(form.replace("{N}", name));
        }
    }
    for d in cases.diagnostics {
        let row = json!({"type":"attempt_result","feature_key":"join","attempt_id":ID,"source":"browser","result":"failure","ts":AT,
            "step": d.input, "error_kind": d.input, "error_message": d.input});
        let out = run(batch(vec![row])).unwrap();
        let record = &out["payload"]["attempts"][0];
        assert_eq!(record["step"], json!(d.step), "{}", d.input);
        assert_eq!(record["error_kind"], json!(d.kind), "{}", d.input);
        assert_eq!(record["error_message"], json!(d.message), "{}", d.input);
    }
    for case in cases.version {
        let mut row = batch(vec![request()]);
        row["app_version"] = json!(case.input);
        assert_eq!(run(row).unwrap()["payload"]["app_version"], case.expected);
    }
    for input in cases.omitted_messages {
        let mut row = request();
        row["status"] = json!(500);
        row["error_message"] = json!(input);
        let out = run(batch(vec![row])).unwrap();
        assert_eq!(
            out["payload"]["error_samples"][0]["message"],
            Value::Null,
            "{:?}",
            input
        );
    }
    for case in cases.route {
        let mut row = request();
        row["route"] = json!(case.input);
        let out = run(batch(vec![row])).unwrap();
        assert_eq!(
            out["payload"]["stats"][0]["route"], case.expected,
            "{:?}",
            case.input
        );
    }
}
