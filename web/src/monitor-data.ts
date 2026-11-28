import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight } from "./insights";
import type { ServerContext, ServerSlot } from "./server-data";

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
    p95_ms: number | null;
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
  success_durations?: Record<string, number>;
}
interface Metric {
  timing_basis?: "handler" | "inclusive" | "mixed" | "deep";
  slow_rule?: "relative" | "absolute";
  queue_ms?: number;
  queue_pct?: number;
  interruptions?: number;
  unconfirmed?: number;
  consecutive?: boolean;
  total?: number;
  failures?: number;
  p50?: number;
  baseline?: number;
  baseline_p50?: number;
  baseline_p95?: number;
  threshold?: number;
  window?: number;
}
export interface Incident {
  id: string;
  feature_id: string | null;
  kind: "slow" | "failure" | "unconfirmed" | "silent";
  status: "open" | "resolved" | "quiet" | "dismissed";
  opened_version: string;
  resolved_version: string | null;
  opened_at: string;
  closed_at: string | null;
  metric_at_open: Metric | null;
  metric_worst: Metric | null;
  notifications: { event: string; sent_at: string; ok: boolean }[];
}
export interface PromptContext {
  slow_start: string | null;
  incident_start?: string;
  usual_rpm: number | null;
  incident_rpm: number | null;
  client_errors: number | null;
  server_errors: number | null;
  client_partial?: boolean;
  server_partial?: boolean;
  related_server_errors?: number | null;
  related_server_partial?: boolean;
  feature_rpm?: number | null;
  single_feature_spike?: boolean | null;
  client_spike?: boolean | null;
  auth_spike?: boolean;
  key_changed?: boolean;
  repeated_server_error?: boolean;
  timeout_step?: boolean;
  external_slow?: boolean;
  cpu_high?: boolean;
  db_slow?: boolean;
  memory_rising?: boolean;
  metrics_guide?: string | null;
}

export function concurrentIssues(issue: Incident, start: string, incidents: Incident[], features: Pick<Feature, "id" | "name">[]) {
  const distance = (i: Incident) => Math.abs(Date.parse(i.opened_at) - Date.parse(start));
  const candidates = incidents.filter(i => i.kind !== "silent" && i.feature_id !== issue.feature_id && distance(i) <= 600_000)
    .sort((a,b) => distance(a)-distance(b) || a.opened_at.localeCompare(b.opened_at) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  return candidates.flatMap(i => {
    if (i.feature_id == null || seen.has(i.feature_id)) return [];
    seen.add(i.feature_id);
    return [{ name: features.find(f => f.id === i.feature_id)?.name ?? "기능", kind: i.kind,
      opening: i.metric_at_open, worst: i.metric_worst }];
  }).slice(0,5);
}
export interface Monitor {
  serverSeries?: Record<number,ServerSlot[]>;
  serverContext?: ServerContext;
  promptContext?: PromptContext;
  insights?: Insight[];
  verificationIncidentId?: string;
  verification?: {
    opening_rpm?: number;
    current_rpm?: number;
    volume_quiet?: boolean;
    volume_recovering?: boolean;
    volume_unverified?: boolean;
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
  samples: { at: string; error_kind: string | null; message: string | null; http_status?: number | null }[];
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
  enough?: (rows: T[]) => boolean,
) {
  const result: T[] = [];
  for (;;) {
    const page = read(await fetch(result.length, result.length + 499));
    result.push(...page);
    if (page.length < 500 || enough?.(result)) return result;
  }
}

export function slowErrorCandidate(sample: Monitor["samples"][number], context?: PromptContext) {
  if (sample.http_status != null) return sample.http_status < 400 || sample.http_status >= 500;
  const kind = sample.error_kind ?? "";
  if (/^(?:HTTP[._-]?)?5\d\d(?:$|[._-])/i.test(kind)) return true;
  if (/(?:^|[^0-9])4\d\d(?:$|[^0-9])|^(?:UNAUTHORIZED|FORBIDDEN|NOT[_-]?FOUND|BAD[_-]?REQUEST|TOO[_-]?MANY[_-]?REQUESTS)$/i.test(kind)) return false;
  // Legacy names alone cannot identify a client error in a mixed window.
  return !(context?.client_errors || context?.client_partial);
}
export async function loadMonitor(
  client: SupabaseClient,
  app: string,
  featureId?: string,
  issueId?: string,
  days = 1,
): Promise<Monitor> {
  const now = Date.now();
  const [header, features, incidents, versions, context, server] = await Promise.all([
    client.from("apps").select("name").eq("id", app).single(),
    client
      .from("features")
      .select(
        "id,kind,name,method,route,hidden,slow_threshold_ms,baselines(p50_ms,p95_ms,sample_count,observed_min_ms,observed_max_ms)",
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
    issueId ? client.rpc("incident_prompt_context", { incident_id: issueId }) : undefined,
    issueId ? client.rpc("incident_server_context",{incident_id:issueId}) : undefined,
  ]);
  const promptContext = context ? read<PromptContext>(context) : undefined;
  const serverContext = server ? read<ServerContext>(server) : undefined;
  const incident = incidents.find((i) => i.id === issueId);
  if (incident?.kind === "silent") {
    return { name: read(header).name, features: read(features), incidents, versions, promptContext, now,
      serverContext, stats: [], samples: [], errorKinds: [] };
  }
  const selected = issueId ? incident?.feature_id : featureId;
  if ((issueId || featureId) && !read(features).some((f) => f.id === selected))
    throw Error("상세 기록을 찾지 못했어요");
  const verificationIssue = incident && incident.status !== "dismissed" ? incident : !selected
    ? incidents.find((i) => i.kind !== "silent" && i.status === "open" && versions.some((v) =>
        v.version !== i.opened_version && Date.parse(v.last_seen_at) > Date.parse(i.opened_at)))
    : undefined;
  const cutoff = new Date(
    incident
      ? Date.parse(incident.opened_at) - (incident.kind === "unconfirmed" ? 3600000 : 1800000)
      : now - (selected ? 7 : days) * 86400000,
  ).toISOString();
  const stats = pages<Stat>((a, b) => {
    let q = client
      .from("stats_5m")
      .select("feature_id,version,bucket,total,failures,client_errors,hist,success_durations")
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
        .select("at,error_kind,message,http_status")
        .eq("app_id", app)
        .eq("feature_id", selected)
        .order("at", { ascending: false }).order("id")
    : null;
  if (incident) {
    const since = Date.parse(promptContext?.incident_start ?? promptContext?.slow_start ?? incident.opened_at) - 600_000;
    sampleQuery?.gte("at", new Date(since).toISOString()).lte("at", incident.closed_at ?? new Date(now).toISOString());
    if (incident.kind === "slow") sampleQuery?.or("http_status.is.null,http_status.lt.400,http_status.gte.500");
  }
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
  const [rows, deepRows, errorKinds, samples, steps, proof, insights, serverSeries] = await Promise.all([
    stats,
    attempts,
    kindRows,
    sampleQuery ? (incident?.kind === "slow"
      ? pages<Monitor["samples"][number]>((a,b) => sampleQuery.range(a,b),
          rows => rows.filter(s => slowErrorCandidate(s, promptContext)).length >= 5)
      : sampleQuery.limit(5).then(read<Monitor["samples"]>))
      : [],
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
    issueId ? undefined : client.rpc("demo_insights", {target_app:app}),
    issueId ? undefined : Promise.all((featureId ? [1/24,1,7] : [days]).map(async range => {
      const result = await client.rpc("server_series", {
        target_app:app, since:new Date(now-range*86400000).toISOString(), until_at:new Date(now).toISOString(),
        slices: range < 1 ? 12 : range === 1 ? 24 : 7,
      });
      return [range,read<ServerSlot[]>(result)] as const;
    })),
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
      success_durations: attempt.status === "success" && attempt.duration_ms != null ? { [attempt.duration_ms]: 1 } : {},
    });
  }
  return {
    promptContext,
    name: read(header).name,
    serverSeries: serverSeries ? Object.fromEntries(serverSeries) : undefined,
    serverContext,
    insights: insights ? read<Insight[]>(insights) : [],
    verificationIncidentId: verificationIssue?.id,
    verification: proof ? read<NonNullable<Monitor["verification"]>>(proof) : undefined,
    features: read(features),
    incidents,
    versions,
    errorKinds,
    stats: visibleRows,
    samples,
    step: read(steps)[0]?.step,
    now,
  };
}
const legacyBounds = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 30000, Infinity];
const bounds = [
  ...legacyBounds.slice(0, 10),
  3300, 3600, 3900, 4200, 4500, 4800, 5000, 5100, 5400, 5700, 6000, 6300, 6600, 6900, 7200,
  ...legacyBounds.slice(11),
];
function intervals(edges: number[]) {
  return edges.map((upper, i) => ({ lower: edges[i - 1] ?? 0, index: bounds.indexOf(upper) }));
}
const legacyIntervals = intervals(legacyBounds);
const refinedIntervals = intervals(bounds);
const mixedIntervals = [...refinedIntervals, ...legacyIntervals.slice(10, 12)];
export function summarize(rows: Stat[], thresholds?: ReadonlyMap<string, number>) {
  let abandoned = 0, unconfirmed = 0;
  let total = 0,
    failures = 0,
    excluded = 0;
  const hist = bounds.map(() => 0);
  const durations = new Map<number, number>();
  let measuredForScore = 0, fast = 0;
  let min = Infinity;
  for (const row of rows) {
    if (row.attemptStatus === "abandon") abandoned++;
    if (row.attemptStatus === "unconfirmed") unconfirmed++;
    excluded += row.client_errors ?? 0;
    total += row.total;
    failures += row.failures;
    const bins = row.hist.length === legacyBounds.length ? legacyIntervals : mixedIntervals;
    const threshold = thresholds?.get(row.feature_id);
    function addDuration(ms:number, n:number) {
      durations.set(ms, (durations.get(ms) ?? 0) + n);
      if (threshold !== undefined) {
        measuredForScore += n;
        if (ms <= threshold) fast += n;
      }
    }
    for (const [ms, n] of Object.entries(row.success_durations ?? {})) {
      addDuration(Number(ms), n);
    }
    row.hist.forEach((n, i) => {
      if (n > 0) {
        min = Math.min(min, bins[i].lower);
        hist[bins[i].index] += n;
        if (!row.success_durations) {
          const ms = bounds[bins[i].index];
          addDuration(ms,n);
        }
      }
    });
  }
  const measured = hist.reduce((sum, n) => sum + n, 0);
  const ordered = [...durations].sort(([a], [b]) => a - b);
  const count = ordered.reduce((sum, [, n]) => sum + n, 0);
  function middle(rank: number) {
    for (const [ms, n] of ordered) {
      if (rank < n) return ms;
      rank -= n;
    }
    return Infinity;
  }
  return {
    satisfaction: measuredForScore ? Math.round(100*fast/measuredForScore) : null,
    abandoned, unconfirmed,
    total,
    failures,
    successes: total - failures - excluded,
    eligible: total - excluded,
    median: count ? (middle(Math.floor((count - 1) / 2)) + middle(Math.floor(count / 2))) / 2 : null,
    min: measured ? min : null,
    max: measured ? bounds[hist.map((n) => n > 0).lastIndexOf(true)] : null,
  };
}

export function formatDuration(ms: number | null) {
  if (ms === null) return "기록 없음";
  return ms === Infinity ? "30초 초과" : +(ms / 1000).toFixed(2) + "초";
}

export function approximateDuration(ms: number | null) {
  return (ms !== null && Number.isFinite(ms) ? "약 " : "") + formatDuration(ms);
}

export function usualDuration(p50: number, p95?: number | null) {
  return "평소 " + approximateDuration(p50) + (p95 == null ? "" : " (보통 " + formatDuration(p95) + " 안)");
}
