use serde_json::{Value, json};
use std::{
    io::Write,
    net::TcpListener,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[test]
#[ignore = "requires release Wasm and workerd; run after worker-build"]
fn ingest_http_statuses() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let no_db = TcpListener::bind("127.0.0.1:0").unwrap();
    let local = TcpListener::bind("127.0.0.1:0").unwrap();
    let missing_addr = no_db.local_addr().unwrap();
    let dry_addr = local.local_addr().unwrap();
    drop((listener, no_db, local));
    let binary = std::env::var("WORKERD_BIN").unwrap_or_else(|_| {
        if cfg!(windows) {
            "target/workerd/node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe".into()
        } else {
            "target/workerd/node_modules/.bin/workerd".into()
        }
    });
    let mut server = Server(
        Command::new(binary)
            .args([
                "serve",
                "tests/http.capnp",
                "--experimental",
                &format!("--socket-addr=http={addr}"),
                &format!("--socket-addr=unconfigured={missing_addr}"),
                &format!("--socket-addr=local={dry_addr}"),
            ])
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while std::net::TcpStream::connect(addr).is_err() {
        assert!(server.0.try_wait().unwrap().is_none(), "workerd exited");
        assert!(Instant::now() < deadline, "workerd startup timeout");
        thread::sleep(Duration::from_millis(30));
    }
    let fixture = |path: &str, body: Option<Value>| {
        let mut curl = Command::new("curl");
        curl.args(["--silent", "--show-error", "--max-time", "5"]);
        if let Some(body) = body {
            curl.args([
                "-H",
                "Content-Type: application/json",
                "-H",
                "Authorization: Bearer fixture",
                "--data",
                &body.to_string(),
            ]);
        }
        let output = curl.arg(format!("http://{addr}{path}")).output().unwrap();
        serde_json::from_slice::<Value>(&output.stdout).unwrap()
    };
    let install = || fixture("/v1/slack/install", Some(json!({"app":"fixture"})));
    let callback = |state: Value, code: &str| {
        fixture(
            "/v1/slack/callback",
            Some(json!({"state":state,"code":code})),
        )
    };
    assert!(callback(json!("wrong"), "unused")["error"].is_string());
    let ticket = install();
    assert!(ticket["url"].as_str().unwrap().contains("incoming-webhook"));
    let redirect = Command::new("curl")
        .args([
            "--silent",
            "--include",
            &format!("http://{addr}/v1/slack/callback?code=fixture&state=ticket"),
        ])
        .output()
        .unwrap();
    let headers = String::from_utf8(redirect.stdout).unwrap().to_lowercase();
    assert!(
        headers.contains("302")
            && headers.contains("/apps/notifications#slack_code=fixture&slack_state=ticket")
    );
    assert!(headers.contains("no-store") && headers.contains("no-referrer"));
    assert!(
        callback(ticket["state"].clone(), "denied")["error"]
            .as_str()
            .unwrap()
            .contains("관리자")
    );
    let ticket = install();
    assert!(callback(ticket["state"].clone(), "valid")["app"].is_string());
    assert!(callback(ticket["state"].clone(), "valid")["error"].is_string());
    let broken = fixture("/fixture/cron", None);
    assert_eq!(broken["slack"], 1);
    assert_eq!(broken["broken"], 2);
    let digest = fixture("/fixture/cron", None);
    assert_eq!(
        digest,
        json!({"slack":1,"broken":2,"mail":1,"completed":1,"connected":1,"safe":true})
    );
    let no_origin = fixture("/fixture/no-origin", None);
    assert_eq!(no_origin["slack"], 2);
    assert_eq!(no_origin["safe"], true);
    let post = |addr: std::net::SocketAddr, mime: &str, auth: &str, data: &str| {
        let mut child = Command::new("curl")
            .args([
                "--silent",
                "--show-error",
                "--max-time",
                "5",
                "--write-out",
                "\n%{http_code}",
                "--header",
                &format!("Content-Type: {mime}"),
                "--header",
                &format!("Authorization: {auth}"),
                "--data-binary",
                "@-",
                &format!("http://{addr}/v1/ingest"),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(data.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let result = String::from_utf8(output.stdout).unwrap();
        let (body, status) = result.rsplit_once('\n').unwrap();
        (
            status.parse::<u16>().unwrap(),
            serde_json::from_str::<Value>(body).unwrap(),
        )
    };
    let send_to = |addr, auth: &str, data: &str| post(addr, "application/json", auth, data);
    let send = |auth: &str, data: &str| send_to(addr, auth, data);
    let auth = ["Bearer sp", "pub", "fixture"].join("_");
    let key = auth.as_str();
    assert_eq!(send("", "{}").0, 401);
    assert_eq!(send(key, "{").0, 400);
    assert_eq!(send(key, "{}").0, 400);
    assert_eq!(send(key, &" ".repeat(65537)).0, 413);
    let now = "2027-01-15T08:00:59Z";
    let mut batch = json!({"spec":"sp-1","batch_id":"badcafe0-0000-4000-8000-000000000001","app_version":"ok","platform":"server","sent_at":now,
        "records":[{"type":"request","ts":now,"method":"GET","route":"/a","status":200,"duration_ms":1},null]});
    assert_eq!(
        send(key, &batch.to_string()),
        (202, json!({"accepted":1,"dropped":1}))
    );
    assert_eq!(send_to(missing_addr, key, &batch.to_string()).0, 503);
    let mut beacon = batch.clone();
    beacon["key"] = json!(auth.strip_prefix("Bearer ").unwrap());
    let plain =
        |auth, data: &Value| post(addr, "text/plain;charset=UTF-8", auth, &data.to_string()).0;
    assert_eq!(plain("", &beacon), 202);
    assert_eq!(send("", &beacon.to_string()).0, 401);
    beacon["key"] = json!(["sp", "srv", "fixture"].join("_"));
    assert_eq!(plain("", &beacon), 400);
    assert_eq!(plain(key, &beacon), 202);
    assert_eq!(plain("Bearer malformed", &beacon), 401);
    for (suffix, status) in [
        ("missing", 401),
        ("missing", 401),
        ("outage", 503),
        ("outage", 503),
    ] {
        assert_eq!(
            send(&["Bearer sp", "pub", suffix].join("_"), &batch.to_string()).0,
            status
        );
    }
    assert_eq!(
        send_to(dry_addr, key, &batch.to_string()),
        (202, json!({"accepted":1,"dropped":1}))
    );
    for (version, status) in [
        ("revoked", 401),
        ("invalid", 400),
        ("unavailable", 503),
        ("disconnect", 503),
        ("apikey", 503),
        ("bad-json", 503),
        ("permission", 503),
        ("gateway", 503),
        ("bad-counts", 503),
    ] {
        batch["app_version"] = json!(version);
        assert_eq!(send(key, &batch.to_string()).0, status, "{version}");
    }
    let feature = |data: &str| {
        let result = Command::new("curl")
            .args([
                "--silent",
                "--output",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
                "--write-out",
                "%{http_code}",
                "--header",
                "Content-Type: text/plain",
                "--header",
                &format!("Authorization: {key}"),
                "--data-binary",
                data,
                &format!("http://{addr}/v1/feature-map"),
            ])
            .output()
            .unwrap();
        String::from_utf8(result.stdout).unwrap()
    };
    let item = json!({"route":"/a/42?q=x","method":"GET","name":"token=example"});
    assert_eq!(feature(&json!([item.clone()]).to_string()), "202");
    assert_eq!(feature("[{}]"), "400");
    assert_eq!(feature(&json!(vec![item.clone(); 200]).to_string()), "202");
    for (field, value) in [("route", "relative"), ("method", "get"), ("name", " ")] {
        let mut bad = item.clone();
        bad[field] = json!(value);
        assert_eq!(feature(&json!([item.clone(), bad]).to_string()), "400");
    }
    assert_eq!(feature(&json!(vec![item; 201]).to_string()), "413");
    let preflight = Command::new("curl")
        .args([
            "--silent",
            "--include",
            "--request",
            "OPTIONS",
            &format!("http://{addr}/v1/feature-map"),
        ])
        .output()
        .unwrap();
    let headers = String::from_utf8(preflight.stdout)
        .unwrap()
        .to_ascii_lowercase();
    assert!(
        headers.contains("204")
            && headers.contains("access-control-allow-origin: *")
            && headers.contains("authorization, content-type")
            && headers.contains("access-control-allow-methods: post, options")
            && headers.contains("access-control-expose-headers: retry-after")
    );
    batch["app_version"] = json!("quota");
    let mut limited = false;
    for _ in 0..21 {
        let r = Command::new("curl")
            .args([
                "--silent",
                "--include",
                "--header",
                "Content-Type: text/plain",
                "--header",
                &format!("Authorization: {key}"),
                "--data-binary",
                &batch.to_string(),
                &format!("http://{addr}/v1/ingest"),
            ])
            .output()
            .unwrap();
        let headers = String::from_utf8(r.stdout).unwrap().to_ascii_lowercase();
        if headers.lines().next().unwrap().contains("429") {
            assert!(headers.contains("retry-after: "));
            limited = true;
            break;
        }
        assert!(headers.lines().next().unwrap().contains("202"));
    }
    assert!(limited);
    let unknown = ["Bearer sp", "pub", "missing"].join("_");
    for _ in 2..100 {
        assert_eq!(send(&unknown, "{}").0, 401);
    }
    assert_eq!(send(&unknown, "{}").0, 429);
}
