import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

let total = 0;
createServer(async (req, res) => {
  if (req.url === "/registrations" && ["GET", "POST"].includes(req.method)) {
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
