use serde_json::{Value, json};
use ship_ping_ingest::ingest::{ApiError, prepare};
const NOW: i64 = 1_800_000_000_000;
const AT: &str = "2027-01-15T08:00:00Z";
const ID: &str = "badcafe0-0000-4000-8000-000000000001";
const KEY: &str = "Bearer sp_pub_fixture";
fn request() -> Value {
    json!({"type":"request","route":"/a/12","method":"GET","status":200,"duration_ms":50,"ts":AT})
}
fn batch(records: Vec<Value>) -> Value {
    json!({"spec":"sp-1","batch_id":ID,"platform":"browser","app_version":"v1","sent_at":AT,"records":records})
}
fn run(input: Value) -> Result<Value, ApiError> {
    let (rpc, _) = prepare(KEY, &serde_json::to_vec(&input).unwrap(), NOW)?;
    Ok(serde_json::from_slice(&rpc).unwrap())
}
#[test]
fn masks_identifiers_and_private_text_before_rpc() {
    let mut r = request();
    r["route"] = json!(format!("/a/123/{ID}/a123456789012345/short?email=x"));
    r["status"] = json!(500);
    r["error_message"] = json!(format!(
        "a@example.test 010-1234-5678 Bearer example.token sk_private eyJabc.def.ghi {}",
        "가".repeat(400)
    ));
    let rpc = run(batch(vec![r])).unwrap();
    assert_eq!(rpc["payload"]["stats"][0]["route"], "/a/:id/:id/:id/short");
    let msg = rpc["payload"]["error_samples"][0]["message"]
        .as_str()
        .unwrap();
    assert!(msg.starts_with("[가림] [가림] [가림] [가림] [가림] "));
    assert_eq!(msg.chars().count(), 300);
    assert_eq!(rpc["app_key_hash"].as_str().unwrap().len(), 64);
}
#[test]
fn limits_inclusive() {
    let mut data = serde_json::to_vec(&batch(vec![request(); 100])).unwrap();
    data.resize(65536, b' ');
    assert_eq!(prepare(KEY, &data, NOW).unwrap().1.accepted, 100);
    data.push(b' ');
    assert_eq!(prepare(KEY, &data, NOW).unwrap_err(), ApiError::TooLarge);
    assert_eq!(
        run(batch(vec![request(); 101])).unwrap_err(),
        ApiError::TooLarge
    );
}
#[test]
fn validates_envelope_fields_and_records() {
    for (k, v) in [
        ("spec", json!("old")),
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
        ("ts", json!("bad")),
        ("error_kind", json!("a".repeat(81))),
        ("type", json!("unknown")),
    ] {
        let mut r = request();
        r[k] = v;
        assert_eq!(run(batch(vec![r])).unwrap_err(), ApiError::Invalid);
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
    let (bytes, count) = prepare(KEY, &serde_json::to_vec(&batch(rows)).unwrap(), NOW).unwrap();
    assert_eq!((count.accepted, count.dropped), (5, 1));
    let rpc: Value = serde_json::from_slice(&bytes).unwrap();
    let stats = rpc["payload"]["stats"].as_array().unwrap();
    assert_eq!(stats.len(), 2);
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
fn timestamps_include_both_24h_edges() {
    let mut rows = Vec::new();
    for offset in [-86_400_001, -86_400_000, 86_400_000, 86_400_001] {
        let mut row = request();
        row["ts"] = json!(chrono::DateTime::from_timestamp_millis(NOW + offset).unwrap());
        rows.push(row);
    }
    let (_, counts) = prepare(KEY, &serde_json::to_vec(&batch(rows)).unwrap(), NOW).unwrap();
    assert_eq!((counts.accepted, counts.dropped), (2, 2));
}

#[test]
fn deep_results_enforce_server_source() {
    let row = json!({"type":"attempt_result","attempt_id":ID,"feature_key":"join","source":"server","result":"success","ts":AT});
    let data = serde_json::to_vec(&batch(vec![row])).unwrap();
    assert_eq!(prepare(KEY, &data, NOW).unwrap_err(), ApiError::Invalid);
    assert_eq!(
        prepare("Bearer sp_srv_fixture", &data, NOW)
            .unwrap()
            .1
            .accepted,
        1
    );
}
