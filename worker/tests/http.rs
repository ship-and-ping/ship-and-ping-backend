use serde_json::{Value, json};
use std::{
    net::TcpListener,
    process::{Child, Command},
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
    drop(listener);
    let binary = std::env::var("WORKERD_BIN")
        .unwrap_or_else(|_| "target/workerd/node_modules/.bin/workerd".into());
    let mut server = Server(
        Command::new(binary)
            .args([
                "serve",
                "tests/http.capnp",
                "--experimental",
                &format!("--socket-addr=http={addr}"),
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
    let send = |auth: &str, data: &str| {
        let output = Command::new("curl")
            .args([
                "--silent",
                "--show-error",
                "--max-time",
                "5",
                "--write-out",
                "\n%{http_code}",
                "--header",
                "Content-Type: application/json",
                "--header",
                &format!("Authorization: {auth}"),
                "--data-binary",
                data,
                &format!("http://{addr}/v1/ingest"),
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        let result = String::from_utf8(output.stdout).unwrap();
        let (body, status) = result.rsplit_once('\n').unwrap();
        (
            status.parse::<u16>().unwrap(),
            serde_json::from_str::<Value>(body).unwrap(),
        )
    };
    let key = "Bearer sp_pub_fixture";
    assert_eq!(send("", "{}").0, 401);
    assert_eq!(send(key, "{").0, 400);
    assert_eq!(send(key, "{}").0, 400);
    assert_eq!(send(key, &" ".repeat(65537)).0, 413);
    let now: chrono::DateTime<chrono::Utc> = std::time::SystemTime::now().into();
    let mut batch = json!({"spec":"sp-1","batch_id":"badcafe0-0000-4000-8000-000000000001","app_version":"ok","platform":"server","sent_at":now,
        "records":[{"type":"request","ts":now,"method":"GET","route":"/a","status":200,"duration_ms":1},null]});
    assert_eq!(
        send(key, &batch.to_string()),
        (202, json!({"accepted":1,"dropped":1}))
    );
    for (version, status) in [
        ("revoked", 401),
        ("invalid", 400),
        ("unavailable", 503),
        ("disconnect", 503),
    ] {
        batch["app_version"] = json!(version);
        assert_eq!(send(key, &batch.to_string()).0, status, "{version}");
    }
}
