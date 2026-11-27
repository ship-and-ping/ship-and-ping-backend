import type { SupabaseClient } from "@supabase/supabase-js";

export interface Feature {
  kind?: "auto" | "deep";
  hidden?: boolean;
  id: string;
  name: string;
  method: string | null;
  route: string | null;
  slow_threshold_ms: number;
  baselines: {
    p50_ms: number | null;
    sample_count: number;
    observed_min_ms: number | null;
    observed_max_ms: number | null;
  } | null;
}
export interface Stat {
  attemptStatus?: string;
  feature_id: string;
  version: string;
  bucket: string;
  total: number;
  failures: number;
  client_errors?: number;
  hist: number[];
}
interface Metric {
  unconfirmed?: number;
  consecutive?: boolean;
  total?: number;
  failures?: number;
  p50?: number;
  baseline?: number;
}
export interface Incident {
  id: string;
  feature_id: string;
  kind: "slow" | "failure" | "unconfirmed";
  status: "open" | "resolved" | "quiet" | "dismissed";
  opened_version: string;
  resolved_version: string | null;
  opened_at: string;
  closed_at: string | null;
  metric_at_open: Metric | null;
  metric_worst: Metric | null;
  notifications: { event: string; sent_at: string; ok: boolean }[];
}
export interface Monitor {
  verificationIncidentId?: string;
  verification?: {
    version: string | null;
    consecutive_successes: number;
    latest_duration_ms: number | null;
    latest_success: boolean | null;
  };
  name: string;
  features: Feature[];
  incidents: Incident[];
  stats: Stat[];
  versions: { version: string; first_seen_at: string; last_seen_at: string }[];
  samples: { at: string; error_kind: string | null; message: string | null }[];
  errorKinds: Monitor["samples"];
  step?: string;
  now: number;
}
type Result<T> = { data: T | null; error: unknown };
function read<T>(r: Result<T>): T {
  if (r.error || r.data == null) throw r.error ?? Error("조회 실패");
  return r.data;
}
async function pages<T>(
  fetch: (from: number, to: number) => PromiseLike<Result<T[]>>,
) {
  const result: T[] = [];
  for (;;) {
    const page = read(await fetch(result.length, result.length + 499));
    result.push(...page);
    if (page.length < 500) return result;
  }
}
export async function loadMonitor(
  client: SupabaseClient,
  app: string,
  featureId?: string,
  issueId?: string,
): Promise<Monitor> {
  const now = Date.now();
  const [header, features, incidents, versions] = await Promise.all([
    client.from("apps").select("name").eq("id", app).single(),
    client
      .from("features")
      .select(
        "id,kind,name,method,route,hidden,slow_threshold_ms,baselines(p50_ms,sample_count,observed_min_ms,observed_max_ms)",
      )
      .eq("app_id", app)
      .order("id")
      .returns<Feature[]>(),
    pages<Incident>((a, b) =>
      client
        .from("incidents")
        .select(
          "id,feature_id,kind,status,opened_at,closed_at,opened_version,resolved_version,metric_at_open,metric_worst,notifications(event,sent_at,ok)",
        )
        .eq("app_id", app)
        .order("opened_at", { ascending: false })
        .order("id")
        .range(a, b)
        .returns<Incident[]>(),
    ),
    pages<Monitor["versions"][number]>((a, b) =>
      client
        .from("app_versions")
        .select("version,first_seen_at,last_seen_at")
        .eq("app_id", app)
        .order("first_seen_at", { ascending: false })
        .order("version")
        .range(a, b),
    ),
  ]);
  const selected = issueId
    ? incidents.find((i) => i.id === issueId)?.feature_id
    : featureId;
  if ((issueId || featureId) && !read(features).some((f) => f.id === selected))
    throw Error("상세 기록을 찾지 못했어요");
  const incident = incidents.find((i) => i.id === issueId);
  const verificationIssue = incident?.status === "open" ? incident : !selected
    ? incidents.find((i) => i.status === "open" && versions.some((v) =>
        v.version !== i.opened_version && Date.parse(v.last_seen_at) > Date.parse(i.opened_at)))
    : undefined;
  const cutoff = new Date(
    incident
      ? Date.parse(incident.opened_at) - (incident.kind === "unconfirmed" ? 3600000 : 1800000)
      : now - (selected ? 7 : 1) * 86400000,
  ).toISOString();
  const stats = pages<Stat>((a, b) => {
    let q = client
      .from("stats_5m")
      .select("feature_id,version,bucket,total,failures,client_errors,hist")
      .eq("app_id", app)
      .gte("bucket", cutoff);
    if (selected) q = q.eq("feature_id", selected);
    return q.order("bucket").order("feature_id").order("version").range(a, b);
  });
  type Attempt = {
    feature_id: string;
    version: string;
    started_at: string | null;
    ended_at: string | null;
    duration_ms: number | null;
    status: string;
  };
  const deep = read(features).filter(
    (f) => f.kind === "deep" && (!selected || selected === f.id),
  );
  const attempts = deep.length
    ? pages<Attempt>((a, b) =>
        client
          .from("attempts")
          .select("feature_id,version,started_at,ended_at,duration_ms,status")
          .eq("app_id", app)
          .in(
            "feature_id",
            deep.map((f) => f.id),
          )
          .or(
            "ended_at.gte." +
              cutoff +
              ",and(ended_at.is.null,started_at.gte." +
              cutoff +
              ")",
          )
          .order("attempt_id")
          .range(a, b),
      )
    : [];
  const sampleQuery = selected
    ? client
        .from("error_samples")
        .select("at,error_kind,message")
        .eq("app_id", app)
        .eq("feature_id", selected)
    : null;
  if (incident) sampleQuery?.gte("at", cutoff).lte("at", incident.closed_at ?? new Date(now).toISOString());
  const kindRows = featureId
    ? pages<Monitor["samples"][number]>((a, b) =>
        client
          .from("error_samples")
          .select("at,error_kind,message")
          .eq("app_id", app)
          .eq("feature_id", featureId)
          .gte("at", cutoff)
          .order("at")
          .order("id")
          .range(a, b),
      )
    : [];
  const [rows, deepRows, errorKinds, samples, steps, proof] = await Promise.all([
    stats,
    attempts,
    kindRows,
    sampleQuery
      ? sampleQuery.order("at", { ascending: false }).order("id").limit(5)
      : { data: [], error: null },
    selected && deep.length
      ? client
          .from("attempts")
          .select("step")
          .eq("app_id", app)
          .eq("feature_id", selected)
          .eq("status", "failure")
          .gte("ended_at", cutoff)
          .lte("ended_at", incident?.closed_at ?? new Date(now).toISOString())
          .not("step", "is", null)
          .order("ended_at", { ascending: false })
          .limit(1)
      : { data: [], error: null },
    verificationIssue
      ? client.rpc("incident_verification", { incident_id: verificationIssue.id })
      : undefined,
  ]);
  const deepIds = new Set(deep.map((f) => f.id));
  const visibleRows = rows.filter((row) => !deepIds.has(row.feature_id));
  for (const attempt of deepRows) {
    if (attempt.status === "pending") continue;
    const bucket = attempt.ended_at ?? attempt.started_at;
    if (!bucket) continue;
    const hist = bounds.map(() => 0);
    if (attempt.status === "success" && attempt.duration_ms != null)
      hist[bounds.findIndex((n) => attempt.duration_ms! <= n)]++;
    visibleRows.push({
      attemptStatus: attempt.status,
      feature_id: attempt.feature_id,
      version: attempt.version,
      bucket,
      total: 1,
      failures: Number(attempt.status === "failure"),
      client_errors: Number(!["success", "failure"].includes(attempt.status)),
      hist,
    });
  }
  return {
    name: read(header).name,
    verificationIncidentId: verificationIssue?.id,
    verification: proof ? read<NonNullable<Monitor["verification"]>>(proof) : undefined,
    features: read(features),
    incidents,
    versions,
    errorKinds,
    stats: visibleRows,
    samples: read(samples),
    step: read(steps)[0]?.step,
    now,
  };
}
const bounds = [
  50,
  100,
  200,
  300,
  500,
  750,
  1000,
  1500,
  2000,
  3000,
  5000,
  7500,
  10000,
  20000,
  30000,
  Infinity,
];
export function summarize(rows: Stat[]) {
  let abandoned = 0, unconfirmed = 0;
  let total = 0,
    failures = 0,
    excluded = 0;
  const hist = bounds.map(() => 0);
  for (const row of rows) {
    if (row.attemptStatus === "abandon") abandoned++;
    if (row.attemptStatus === "unconfirmed") unconfirmed++;
    excluded += row.client_errors ?? 0;
    total += row.total;
    failures += row.failures;
    row.hist.forEach((n, i) => (hist[i] += n));
  }
  const measured = hist.reduce((sum, n) => sum + n, 0);
  let left = Math.ceil(measured / 2);
  const index = hist.findIndex((n) => (left -= n) <= 0);
  return {
    abandoned, unconfirmed,
    total,
    failures,
    successes: total - failures - excluded,
    eligible: total - excluded,
    median: measured ? bounds[index] : null,
    min: measured ? (bounds[hist.findIndex((n) => n > 0) - 1] ?? 0) : null,
    max: measured ? bounds[hist.map((n) => n > 0).lastIndexOf(true)] : null,
  };
}

export function formatDuration(ms: number | null) {
  if (ms === null) return "기록 없음";
  return ms === Infinity ? "30초 초과" : +(ms / 1000).toFixed(2) + "초";
}
