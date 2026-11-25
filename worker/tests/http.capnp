using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "ingest", worker = (
      compatibilityDate = "2026-11-24",
      modules = [
        (name = "index.js", esModule = embed "../build/index.js"),
        (name = "index_bg.wasm", wasm = embed "../build/index_bg.wasm")
      ],
      bindings = [
        (name = "SUPABASE_URL", text = "https://rpc.test"),
        (name = "SUPABASE_SECRET_KEY", text = "fixture")
      ],
      globalOutbound = "rpc"
    )),
    (name = "rpc", worker = (
      compatibilityDate = "2026-11-24",
      modules = [(name = "rpc.js", esModule = embed "rpc.js")]
    ))
  ],
  sockets = [(name = "http", http = (), service = "ingest")]
);
