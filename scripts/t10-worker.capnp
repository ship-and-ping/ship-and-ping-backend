using W = import "/workerd/workerd.capnp";
const config :W.Config = (
  services = [
    (name = "worker", worker = (compatibilityDate = "2026-11-24",
      modules = [(name = "entry.js", esModule = embed "entry.js"),
        (name = "index.js", esModule = embed "index.js"),
        (name = "index_bg.wasm", wasm = embed "index_bg.wasm")],
      bindings = [(name = "SUPABASE_URL", text = "http://local-db.test"),
        (name = "SUPABASE_SECRET_KEY", text = embed "db-key"),
        (name = "WEB_ORIGIN", text = "https://web.test"),
        (name = "MAIL_FROM", text = "local@example.invalid"),
        (name = "RESEND_API_KEY", text = "fixture"),
        (name = "SLACK_CLIENT_ID", text = "fixture"),
        (name = "SLACK_CLIENT_SECRET", text = "fixture")],
      globalOutbound = "router")),
    (name = "router", worker = (compatibilityDate = "2026-11-24",
      modules = [(name = "router.js", esModule = embed "router.js")],
      bindings = [(name = "DB", service = "db"), (name = "RECEIVER", service = "receiver")])),
    (name = "db", external = (address = "127.0.0.1:57421", http = ())),
    (name = "receiver", external = (address = "127.0.0.1:58783", http = ()))
  ],
  sockets = [(name = "http", address = "127.0.0.1:58781", http = (), service = "worker")]
);
