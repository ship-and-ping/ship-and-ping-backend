using Workerd = import "/workerd/workerd.capnp";
const ingestModules :List(Workerd.Worker.Module) = [
    (name = "index.js", esModule = embed "../build/index.js"),
    (name = "index_bg.wasm", wasm = embed "../build/index_bg.wasm")
];
const config :Workerd.Config = (
  services = [
    (name = "ingest", worker = (
      compatibilityDate = "2026-11-24",
      modules = .ingestModules,
      bindings = [
        (name = "SUPABASE_URL", text = "https://rpc.test"),
        (name = "SUPABASE_SECRET_KEY", text = "fixture")
      ],
      globalOutbound = "rpc"
    )),
    (name = "unconfigured", worker = (compatibilityDate = "2026-11-24", modules = .ingestModules)),
    (name = "local", worker = (compatibilityDate = "2026-11-24", modules = .ingestModules,
      bindings = [(name = "INGEST_DRY_RUN", text = "true")])),
    (name = "rpc", worker = (
      compatibilityDate = "2026-11-24",
      modules = [(name = "rpc.js", esModule = embed "rpc.js")]
    ))
  ],
  sockets = [
    (name = "http", http = (), service = "ingest"),
    (name = "unconfigured", http = (), service = "unconfigured"),
    (name = "local", http = (), service = "local")
  ]
);
