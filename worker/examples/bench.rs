use chrono::{DateTime, Utc};
use serde_json::json;
use ship_ping_ingest::ingest::{MAX_BYTES, prepare};
use std::{
    hint::black_box,
    io::{self, Write},
    time::{Instant, SystemTime},
};

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.iter().any(|v| v == "--body") {
        run(args.iter().any(|v| v == "--ascii"), true);
    } else {
        run(true, false);
        run(false, false);
    }
}
fn run(ascii: bool, emit: bool) {
    let padding = if ascii {
        "a".repeat(300)
    } else {
        "가".repeat(100)
    };
    let key = ["Bearer sp", "pub", "fixture"].join("_");
    let short = ["sk", "abcdefghijklmnop"].join("_");
    let at: DateTime<Utc> = SystemTime::now().into();
    let mut rows = Vec::new();
    for i in 0..100 {
        rows.push(json!({"type":"request","method":"GET","route":format!("/api/group-{}/item/{i}?q=value",i%20),
            "status":500,"duration_ms":i*50,"ts":at,"error_kind":"Timeout","error_message":format!("test@example.test 010-1234-5678 Bearer fixture {short} eyJabc.def.ghi {padding}")}));
    }
    let mut data=serde_json::to_vec(&json!({"spec":"sp-1","batch_id":"badcafe0-0000-4000-8000-000000000001","app_version":"bench","platform":"server","sent_at":at,"records":rows})).unwrap();
    assert!(data.len() <= MAX_BYTES);
    data.resize(MAX_BYTES, b' ');
    if emit {
        io::stdout().write_all(&data).unwrap();
        return;
    }
    let mut times = Vec::new();
    for i in 0..110 {
        let start = Instant::now();
        let (bytes, counts) = prepare(&key, black_box(&data), at.timestamp_millis()).unwrap();
        black_box(bytes);
        let elapsed = start.elapsed();
        assert_eq!((counts.accepted, counts.dropped), (100, 0));
        if i >= 10 {
            times.push(elapsed)
        }
    }
    times.sort();
    println!(
        "{} n=100 median={:?} max={:?}",
        if ascii { "ASCII" } else { "Korean" },
        (times[49] + times[50]) / 2,
        times[99]
    );
}
