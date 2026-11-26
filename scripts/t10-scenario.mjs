// Executed in the disposable directory prepared by verify-local.py.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "playwright-core";

registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.startsWith(".") &&
      context.parentURL?.includes("/web/src/") &&
      !specifier.includes(".", 2)
    )
      return next(specifier + ".ts", context);
    return next(specifier, context);
  },
});
const { buildConnectPrompt } = await import("./web/src/domain.ts");
const { buildIssuePrompt } = await import("./web/src/issue-prompt.ts");
const { gateway } = await import("./web/src/data.ts");
const { createClient } = createRequire(
  new URL("./web/package.json", import.meta.url),
)("@supabase/supabase-js");
const [root, chrome] = process.argv.slice(2);
const keys = JSON.parse(await readFile("status.json"));
const db = "http://127.0.0.1:57421";
const endpoint = "http://127.0.0.1:58781";
assert.equal(keys.API_URL, db);
const client = (key) =>
  createClient(db, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const admin = client(keys.SECRET_KEY);
function data(result) {
  if (result.error) throw Error(result.error.message);
  return result.data;
}
async function owner(name) {
  const email = crypto.randomUUID() + "@example.invalid";
  const password = crypto.randomUUID();
  const user = data(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  ).user;
  const session = client(keys.PUBLISHABLE_KEY);
  const token = data(await session.auth.signInWithPassword({ email, password }))
    .session.access_token;
  const api = gateway(session);
  const id = await api.create(name, "");
  const publicKey = await api.issue(id, "pub");
  const serverKey =
    name === "with-server" ? await api.issue(id, "srv") : undefined;
  const prompt = buildConnectPrompt(publicKey, "https://127.0.0.1:58781");
  await writeFile(name + "-connect.txt", prompt, { mode: 0o600 });
  const saved = await readFile(
    root + "/examples/" + name + "/connect.txt",
    "utf8",
  );
  assert.equal(prompt.replace(publicKey, "<PUBLIC_KEY>") + "\n", saved);
  return { id, user, email, token, api, session, publicKey, serverKey };
}
async function post(path, key, body) {
  return fetch(endpoint + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const messages = [];
let hookStatus = 200;
const receiver = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  if (req.url === "/api/oauth.v2.access") {
    const hook = ["https:/", "hooks.slack.com", "services", "test-local"].join(
      "/",
    );
    return res.end(
      JSON.stringify({
        ok: true,
        team: { id: "test" },
        incoming_webhook: { url: hook, channel: "#test", channel_id: "test" },
      }),
    );
  }
  if (!["/services/test-local", "/emails"].includes(req.url))
    return res.writeHead(404).end();
  messages.push({ path: req.url, payload: JSON.parse(body) });
  res
    .writeHead(req.url === "/emails" ? 200 : hookStatus)
    .end(req.url === "/emails" ? "{}" : "ok");
});
const tick = async () =>
  assert.equal((await fetch(endpoint + "/test/tick")).status, 200);
function sql(query) {
  return execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_" + process.env.T10_PROJECT,
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      query,
    ],
    { encoding: "utf8" },
  ).trim();
}
let server, browser;
const owners = [];
try {
  await new Promise((resolve, reject) =>
    receiver.once("error", reject).listen(58783, "127.0.0.1", resolve),
  );
  for (const name of ["with-server", "browser-only"])
    owners.push(await owner(name));
  const [a, b] = owners;
  const version = execFileSync(
    "git",
    ["-C", root, "rev-parse", "--short", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  server = spawn(
    process.execPath,
    [root + "/examples/with-server/after/server.mjs"],
    {
      env: {
        ...process.env,
        INGEST_URL: endpoint,
        BUILD_VERSION: version,
        SHIPPING_PUBLIC_KEY: a.publicKey,
        SHIPPING_SERVER_KEY: a.serverKey,
      },
      stdio: "inherit",
    },
  );
  browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--disable-background-networking", "--disable-component-update"],
  });
  for (const [i, member] of owners.entries()) {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    if (i)
      await writeFile(
        "examples/browser-only/after/shipping-config.js",
        "globalThis.shippingConfig = " +
          JSON.stringify({ endpoint, publicKey: member.publicKey, version }),
      );
    await page.goto(
      i
        ? "http://127.0.0.1:58784/browser-only/after/"
        : "http://127.0.0.1:58782/",
    );
    for (const id of ["join", "count"]) {
      await page.click("#" + id);
      await page.waitForFunction(
        () => document.querySelector("#result").textContent === "신청 1건",
      );
    }
    if (i) {
      const sent = page.waitForResponse(endpoint + "/v1/ingest", {
        timeout: 40_000,
      });
      assert.equal((await sent).status(), 202);
    }
    await page.close();
  }
  for (const member of owners) {
    let snapshot;
    for (let i = 0; i < 90; i++) {
      snapshot = await member.api.snapshot(member.id);
      if (
        snapshot.app.first_record_at &&
        snapshot.labels.filter((l) => l.id && l.name).length === 2
      )
        break;
      await wait(500);
    }
    assert.ok(snapshot.app.first_record_at);
    assert.deepEqual(
      snapshot.labels
        .filter((l) => l.id && l.method !== "*")
        .map((l) => l.name)
        .sort(),
      ["독서 모임 신청", "신청 수 조회"].sort(),
    );
  }
  console.log(
    "C2 two browser clicks per app -> first_record_at and two named features per app",
  );
  for (const member of owners) {
    const init = await post("/v1/slack/install", member.token, {
      app: member.id,
    });
    assert.equal(init.status, 200);
    const state = (await init.json()).state;
    assert.equal(
      (await post("/v1/slack/callback", member.token, { state, code: "test" }))
        .status,
      200,
    );
    assert.equal(await member.api.testSlack(member.id), true);
    messages.length = 0;
    await tick();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].path, "/services/test-local");
    assert.match(messages[0].payload.text, /시험 알림/);
    // Leave one delivery pending for this app only. Move its local test cooldown back.
    sql(
      "update alert_channels set tested_at=now()-interval '2 minutes' where app_id='" +
        member.id +
        "'",
    );
    assert.equal(await member.api.testSlack(member.id), true);
    hookStatus = member === a ? 404 : 410;
    messages.length = 0;
    await tick();
    await tick();
    await tick();
    assert.deepEqual(
      messages.map((m) => m.path),
      ["/services/test-local", "/emails"],
    );
    assert.deepEqual(messages[1].payload.to, [member.email]);
    assert.match(messages[1].payload.text, /시험 알림/);
    assert.ok((await member.api.settings(member.id)).broken);
    console.log("C9 local OAuth/test, revoked", hookStatus, "-> one mail");
    hookStatus = 200;
  }
  function batch() {
    const ts = new Date().toISOString();
    return {
      spec: "sp-1",
      batch_id: crypto.randomUUID(),
      app_version: version,
      platform: "browser",
      sent_at: ts,
      records: Array.from({ length: 100 }, (_, i) => ({
        type: "request",
        route: "/benchmark",
        method: "GET",
        status: i % 5 === 0 ? 500 : 200,
        duration_ms: 10,
        ts,
      })),
    };
  }
  assert.equal(
    (await post("/v1/ingest", a.publicKey, { ...batch(), app_id: b.id }))
      .status,
    400,
  );
  const keyReader = client(a.publicKey);
  const denied = await keyReader.from("apps").select("id");
  assert.ok([401, 403].includes(denied.status), `unexpected read status ${denied.status}`);
  assert.equal(denied.data, null);
  console.log(
    "C3 explicit app_id rejected; collection key cannot read the member API",
  );
  for (const member of owners) {
    const sample = batch();
    Object.assign(sample.records[0], {
      error_kind: "write_failed",
      error_message: "WriteError: test-user@example.invalid",
      body: "ignored-body-marker",
      route: "/benchmark?ignored-query-marker",
    });
    const body = JSON.stringify(sample).padEnd(65536);
    const start = performance.now();
    const response = await fetch(endpoint + "/v1/ingest", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + member.publicKey,
        "Content-Type": "application/json",
      },
      body,
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: 100, dropped: 0 });
    console.log(
      "C5 65536 B / 100 records / DB included:",
      (performance.now() - start).toFixed(2),
      "ms RTT",
    );
    const samples = data(
      await member.session
        .from("error_samples")
        .select("*")
        .eq("app_id", member.id),
    );
    assert.ok(samples.some((s) => s.error_kind === "write_failed" && s.message === "WriteError"));
    const prompt = buildIssuePrompt({
      feature: "시험",
      route: "/benchmark",
      versions: [version],
      errors: samples,
    });
    assert.match(prompt.text, /write_failed/);
    assert.doesNotMatch(
      JSON.stringify([samples, prompt.text]),
      /test-user|ignored-body-marker|ignored-query-marker/,
    );
  }
  messages.length = 0;
  await tick();
  await tick();
  assert.equal(messages.length, 2);
  for (const [i, member] of owners.entries()) {
    const other = owners[1 - i];
    assert.equal(messages.filter((m) =>
      m.path === "/emails" && m.payload.to.length === 1 && m.payload.to[0] === member.email
    ).length, 1);
    assert.deepEqual(
      (await member.api.apps()).map((app) => app.id),
      [member.id],
    );
    await assert.rejects(member.api.snapshot(other.id));
    for (const [table, column] of [
      ["apps", "id"],
      ["stats_5m", "app_id"],
      ["incidents", "app_id"],
    ]) {
      assert.ok(
        data(await member.session.from(table).select("*").eq(column, member.id))
          .length,
      );
      assert.deepEqual(
        data(await member.session.from(table).select("*").eq(column, other.id)),
        [],
      );
    }
  }
  console.log(
    "C1 reciprocal gateway/PostgREST isolation; C6 two incidents and exactly one email per owner",
  );
  messages.length = 0;
  const repairVersion = "2026.11.26.1530";
  for (const member of owners) {
    const updated = batch();
    updated.app_version = repairVersion;
    updated.records = updated.records
      .slice(1, 6)
      .map((r) => ({ ...r, status: 200 }));
    assert.equal(
      (await post("/v1/ingest", member.publicKey, updated)).status,
      202,
    );
  }
  await tick();
  await tick();
  assert.equal(messages.length, 2);
  for (const member of owners) {
    const issues = data(
      await member.session
        .from("incidents")
        .select("status,resolved_version")
        .eq("app_id", member.id),
    );
    assert.deepEqual(issues, [
      { status: "resolved", resolved_version: repairVersion },
    ]);
    assert.ok(
      messages.some(
        (m) =>
          m.payload.to.includes(member.email) &&
          m.payload.text.includes("해결"),
      ),
    );
  }
  console.log(
    "C7 five successes in new version: resolved and one recovery email per owner",
  );
  const extra = await a.api.create("설정 시험", "");
  await a.api.editApp(extra, "바뀐 이름", "https://example.invalid");
  assert.equal((await a.api.snapshot(extra)).app.name, "바뀐 이름");
  const disposable = await a.api.issue(extra, "pub");
  const [key] = await a.api.appKeys(extra);
  await assert.rejects(b.api.revokeKey(extra, key.id));
  await a.api.revokeKey(extra, key.id);
  assert.equal((await post("/v1/ingest", disposable, batch())).status, 401);
  await a.api.removeApp(extra);
  await assert.rejects(a.api.snapshot(extra));
  assert.equal((await post("/v1/account/delete", a.token, {id:b.user.id})).status, 400);
  assert.equal((await post("/v1/account/delete", "invalid", {})).status, 401);
  for (const member of owners) {
    const secretId = sql("select slack_webhook_secret_id from public.alert_channels where app_id='" + member.id + "'");
    assert.ok(secretId);
    if (member === a) {
      // Only the disposable local Auth table is used. Fail the second deletion stage once.
      sql("create function private.t21_fail_auth() returns trigger language plpgsql as $$ begin raise exception 'local test'; end $$");
      sql("create trigger t21_fail before delete on auth.users for each row execute function private.t21_fail_auth()");
      try {
        assert.equal(await member.api.withdraw(endpoint), "failed");
        assert.equal(await member.api.checkAccount(), "exists");
        assert.deepEqual(await member.api.apps(), []);
        assert.equal((await post("/v1/ingest", member.publicKey, batch())).status, 401);
      } finally {
        sql("drop trigger t21_fail on auth.users");
      }
    }
    assert.equal(await member.api.withdraw(endpoint), "done");
    assert.equal(await member.api.checkAccount(), "deleted");
    assert.equal(sql("select count(*) from auth.users where id='" + member.user.id + "'"), "0");
    assert.equal(sql("select count(*) from vault.secrets where id='" + secretId + "'"), "0");
    assert.equal(
      (await post("/v1/ingest", member.publicKey, batch())).status,
      401,
    );
    for (const [table, column] of [
      ["apps", "id"],
      ["stats_5m", "app_id"],
      ["incidents", "app_id"],
      ["app_keys", "app_id"],
      ["alert_channels", "app_id"],
    ])
      assert.equal(
        sql(
          "select count(*) from " +
            table +
            " where " +
            column +
            "='" +
            member.id +
            "'",
        ),
        "0",
      );
  }
  console.log(
    "C13 member deletion resumes after Auth failure, removes Vault secrets and immediately rejects warmed keys with 401",
  );
} finally {
  await browser?.close();
  server?.kill();
  receiver.closeAllConnections();
  receiver.close();
}
