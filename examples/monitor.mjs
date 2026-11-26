const route = "/registrations";
const labels = [
  { route, method: "POST", name: "독서 모임 신청" },
  { route, method: "GET", name: "신청 수 조회" },
];

export function monitor(config, platform) {
  if (
    !config?.endpoint ||
    !config.publicKey ||
    !/^[a-zA-Z0-9._-]{1,64}$/.test(config.version ?? "")
  )
    return { record() {}, flush() {} };

  function post(path, data, key) {
    return fetch(config.endpoint + path, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify(data),
    }).catch(() => {});
  }
  void post("/v1/feature-map", labels, config.publicKey);
  const records = [];
  function flush() {
    if (!records.length) return;
    // Only these fixed routes, statuses, methods and integer durations enter a batch.
    // 50 such records with a validated build identifier fit comfortably in 64 KiB.
    return post(
      "/v1/ingest",
      {
        spec: "sp-1",
        batch_id: crypto.randomUUID(),
        app_version: config.version,
        platform,
        sent_at: new Date().toISOString(),
        records: records.splice(0),
      },
      config.serverKey ?? config.publicKey,
    );
  }
  const timer = setInterval(flush, 30_000);
  timer.unref?.();
  function record(method, status, start) {
    records.push({
      type: "request",
      route,
      method,
      status,
      duration_ms: Math.round(performance.now() - start),
      ts: new Date().toISOString(),
      ...(status >= 500 && {
        error_kind: "storage_failed",
        error_message: "StorageError",
      }),
    });
    if (records.length >= 50) void flush();
  }
  return { record, flush };
}
