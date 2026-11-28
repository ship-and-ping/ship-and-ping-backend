import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { monitor } from "../../monitor.mjs";
const telemetry = monitor(
  {
    endpoint: process.env.INGEST_URL,
    serverKey: process.env.SHIP_AND_PING_KEY,
    version: process.env.BUILD_VERSION,
  },
  "server",
);

let total = 0;
createServer(async (req, res) => {
  const received = performance.now();
  if (req.url === "/registrations" && ["GET", "POST"].includes(req.method)) {
    const start = performance.now();
    // Enable only behind an ingress that overwrites the client header.
    const header = process.env.TRUST_REQUEST_START === "true" && req.headers["x-request-start"];
    const epoch = typeof header === "string" && (/^t=\d{10}\.\d{3}$/.test(header)
      ? Number(header.slice(2)) * 1000 : /^\d{13}$/.test(header) ? Number(header) : NaN);
    const proxyWait = epoch ? Math.round(Date.now() - epoch) : NaN;
    const queue = proxyWait >= 0 && proxyWait <= 600000 ? proxyWait : Math.round(start - received);
    const limit = Number(process.env.RESPONSE_TIMEOUT_MS);
    const timeout = Number.isSafeInteger(limit) && limit > 0 && limit <= 600000 ? limit : 10000;
    let recorded = false;
    function record(kind) {
      if (recorded) return;
      recorded = true;
      clearTimeout(timer);
      telemetry.record(req.method, kind ? 0 : res.statusCode, start - queue, {
        queue_ms: queue, timeout_ms: timeout, ...(kind && {error_kind: kind}),
      });
    }
    const timer = setTimeout(() => record("timeout"), Math.max(0, timeout - queue + 1));
    timer.unref();
    res.once("finish", () => record());
    res.once("close", () => { if (!res.writableFinished) record("aborted"); });
    if (req.method === "POST") total++;
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ total }));
    return;
  }
  const asset = {
    "/": "index.html",
    "/app.mjs": "app.mjs",
    "/display.mjs": "../../display.mjs",
  }[req.url];
  if (typeof asset !== "string" || req.method !== "GET")
    return res.writeHead(404).end();
  try {
    const body = await readFile(new URL(asset, import.meta.url));
    res
      .writeHead(200, {
        "Content-Type": asset.endsWith("html")
          ? "text/html;charset=utf-8"
          : "text/javascript",
      })
      .end(body);
  } catch {
    res.writeHead(500).end();
  }
}).listen(58782, "127.0.0.1");
