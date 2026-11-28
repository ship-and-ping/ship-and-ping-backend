import { errorKind, errorName, stepName } from "./normalize";
import { useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Copy } from "./Connect";
import { status, StatusBadge, Timeline, IssueListItem } from "./IncidentSummary";
import type { Gateway } from "./data";
import { Hero, CurrentAppName } from "./Layout";
import { Chart } from "./Chart";
import { IncidentServerSummary, SilentIssue } from "./ServerIncident";
import { MonitorToolbar, periodName } from "./MonitorToolbar";
import { SpeedInsights } from "./SpeedInsights";
import "./styles/dashboard.css";
import { displayText, sanitizeRoute } from "./normalize";
import { buildIssuePrompt, displayVersion, noErrorSamples, queueDescription } from "./issue-prompt";
import {
  summarize,
  formatDuration,
  approximateDuration,
  usualDuration,
  concurrentIssues,
  type Monitor,
  type Feature,
  type Incident,
} from "./monitor-data";

const day = 86400000;
const kindName = { failure: "실패", slow: "느림", unconfirmed: "결과 미확인", silent: "기록 끊김" };
const when = (s: string) => new Date(s).toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" });
const time = (ms: number | string | null) =>
  typeof ms === "string" ? displayText(ms) : formatDuration(ms);

function observedAt(v: Monitor["versions"][number], i?: Incident) {
  return i && Date.parse(v.first_seen_at) <= Date.parse(i.opened_at) ? v.last_seen_at : v.first_seen_at;
}
const title = (f: Feature | undefined, i: Incident) =>
  (i.kind === "silent" ? "" : displayText(f?.name ?? "기능")) +
  {
    silent: "기록이 끊겼어요",
    slow: "이 느려졌어요",
    failure: i.metric_at_open?.interruptions ? "의 응답이 잠시 멈췄어요" : i.metric_at_open?.consecutive ? "에서 3건 연속 실패했어요" : "에서 실패가 늘었어요",
    unconfirmed: "의 기록 전송이 끊겼을 수 있어요",
  }[i.kind];
const route = (f: Feature) =>
  displayText(
    [f.method, sanitizeRoute(f.route ?? "")].filter(Boolean).join(" "),
  );
function details(i: Incident, m: Incident["metric_at_open"], f?: Feature) {
  if (i.kind === "silent") return "평소 기록이 오던 시간에 10분 이상 기록이 없어요.";
  if (!m) return when(i.opened_at) + "부터";
  if (i.kind === "unconfirmed")
    return "사용 결과를 확인하지 못했어요 · " + when(i.opened_at) + "부터";
  if (i.kind === "slow") {
    const baseline = m.baseline_p50 ?? m.baseline;
    return (
      (baseline == null ? "기준 " + time(m.threshold ?? f?.slow_threshold_ms ?? 5000) : usualDuration(baseline, m.baseline_p95)) +
      " → 최근 " + (m.window === 10 ? 10 : 30) + "분 " +
      approximateDuration(m.p50 ?? null) +
      (m.total == null ? "" : " (" + displayText(String(m.total)) + "건)")
    );
  }
  return (
    "최근 30분 " + displayText(String(m.total ?? 0)) + "건 중 실패 " + displayText(String(m.failures ?? 0)) + "건"
  );
}
export function MonitorRoute({ api }: { api: Gateway }) {
  const { id = "", feature, issue } = useParams();
  return (
    <MonitorPage
      key={[id, feature, issue].join("/")}
      api={api}
      id={id}
      feature={feature}
      issue={issue}
    />
  );
}
function MonitorPage({
  api,
  id,
  feature,
  issue,
}: {
  api: Gateway;
  id: string;
  feature?: string;
  issue?: string;
}) {
  const [data, setData] = useState<Monitor>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [interval, setIntervalSeconds] = useState(60);
  const [days, setDays] = useState(1);
  const [updated, setUpdated] = useState(0);
  const currentDays = useRef(1);
  const pending = useRef(false);
  const mounted = useRef(false);
  const heading = useContext(CurrentAppName);
  const { hash } = useLocation();
  const reload = useCallback(async (range = currentDays.current) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await api.monitor(id, feature, issue, range);
      if (!mounted.current) return;
      setData(result);
      currentDays.current = range;
      setDays(range);
      setUpdated(Date.now());
      setError(false);
      heading({id,name:result.name,issues:result.incidents.filter(i => i.status === "open").length});
    } catch {
      if (mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [api,id,feature,issue,heading]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; };
  }, [reload]);
  useEffect(() => {
    if (issue || !interval) return;
    let stop: AbortController | undefined;
    function cancel() {
      stop?.abort();
    }
    function schedule() {
      cancel();
      if (document.visibilityState !== "visible") return;
      stop = new AbortController();
      const { signal } = stop;
      function poll(focusedOnly = false) {
        return new Promise<void>(resolve => {
          if (signal.aborted) { resolve(); return; }
          const timer = window.setInterval(() => {
            if (!focusedOnly || document.hasFocus()) void reload();
          }, interval * 1000);
          signal.addEventListener("abort", () => {
            window.clearInterval(timer);
            resolve();
          }, { once: true });
        });
      }
      if (navigator.locks) {
        // Keep the lock between ticks. The next visible window takes over on release.
        void navigator.locks.request("ship-and-ping:monitor:" + id, { signal }, () => poll())
          .catch(() => { if (!signal.aborted) void poll(true); });
      } else void poll(true);
    }
    schedule();
    document.addEventListener("visibilitychange",schedule);
    window.addEventListener("pagehide",cancel);
    window.addEventListener("pageshow",schedule);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange",schedule);
      window.removeEventListener("pagehide",cancel);
      window.removeEventListener("pageshow",schedule);
    };
  }, [id,interval,issue,reload]);
  const loaded = Boolean(data);
  useEffect(() => {
    if (!loaded) return;
    const target = hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView?.();
    else document.querySelector<HTMLElement>(".monitor h1")?.focus();
  }, [loaded, hash]);
  const retry = () => void reload();
  const base = "/apps/" + encodeURIComponent(id);
  async function loadPrompt(issueId: string) {
    const detail = await api.monitor(id, undefined, issueId);
    const incident = detail.incidents.find(item => item.id === issueId);
    const feature = detail.features.find(item => item.id === incident?.feature_id);
    if (!incident || !feature) throw Error("문제 기록을 찾지 못했어요");
    return buildIssuePrompt(issueContext(detail, feature, incident).input).text;
  }
  if (error && !data)
    return (
      <section className="load-state" role="alert">
        <h1 tabIndex={-1}>기록을 불러오지 못했어요</h1>
        <p>연결 상태를 확인한 뒤 다시 불러와 주세요.</p>
        <button onClick={retry}>다시 불러오기</button>{" "}
        <Link to="/apps">내 앱</Link>
      </section>
    );
  if (!data) return <section role="status" aria-busy="true" className="monitor-loading"><h1>기록을 불러오는 중</h1><div aria-hidden="true" /><div aria-hidden="true" /></section>;
  const incident = data.incidents.find((i) => i.id === issue);
  const selected = data.features.find(
    (f) => f.id === (feature ?? incident?.feature_id),
  );
  const toolbar = <MonitorToolbar days={days} interval={interval} onInterval={setIntervalSeconds}
    refresh={retry} busy={busy} updated={updated} onPeriod={range => {
      if (selected) { currentDays.current = range; setDays(range); }
      else if (range !== days) void reload(range);
    }} />;
  return (
    <div className="monitor">
      {error && <p className="refresh-error" role="alert">새 기록을 불러오지 못했어요. 마지막으로 확인한 내용이에요. {issue && <button onClick={retry}>다시 불러오기</button>}</p>}
      {(feature || issue) && (
        <Link to={base}>{displayText(data.name)} 홈으로</Link>
      )}
      {incident?.kind === "silent" ? <SilentIssue issue={incident} context={data.serverContext} dismiss={async () => {await api.dismiss(incident.id); retry();}} /> : selected && incident ? (
        <Issue
          data={data}
          feature={selected}
          issue={incident}
          dismiss={async () => {
            await api.dismiss(incident.id);
            retry();
          }}
        />
      ) : selected ? (
        <FeaturePage
          loadPrompt={loadPrompt}
          days={days} toolbar={toolbar}
          data={data}
          feature={selected}
          save={(ms) => api.threshold(id, selected.id, ms)}
        />
      ) : (
        <Home data={data} base={base} days={days} toolbar={toolbar} loadPrompt={loadPrompt} />
      )}
    </div>
  );
}
function Outcomes({stats}: {stats:ReturnType<typeof summarize>}) {
  const rate = stats.eligible ? Math.round(stats.failures / stats.eligible * 100) + "%" : "기록 없음";
  return <p>성공 {stats.successes}건 · 실패 {stats.failures}건 · 중단 {stats.abandoned}건 · 결과 미확인 {stats.unconfirmed}건 · 실패율 {rate}</p>;
}
function Home({ data, base, days, toolbar, loadPrompt }: { data: Monitor; base: string; days:number; toolbar:ReactNode; loadPrompt: (id: string) => Promise<string> }) {
  const [showSpeed, setShowSpeed] = useState(false);
  const open = data.incidents.filter((i) => i.status === "open");
  const find = (i: Incident) =>
    data.features.find((f) => f.id === i.feature_id);
  const problems = new Set(open.map((i) => i.feature_id));
  const rows = data.features.filter((f) => !f.hidden)
    .map((f) => ({
      f,
      s: summarize(data.stats.filter((r) => r.feature_id === f.id)),
    }))
    .sort((a, b) => Number(problems.has(b.f.id)) - Number(problems.has(a.f.id)) || b.s.total - a.s.total);
  const updated = open.find((i) => i.id === data.verificationIncidentId && data.verification?.version != null);
  const latest = updated ? data.versions.find((v) => v.version === data.verification?.version) : data.versions[0];
  const bannerVersion = updated ? data.verification?.version : latest?.version;
  const first = open[0];
  const total = rows.reduce((sum, row) => sum + row.s.total, 0);
  const hasRecords = total > 0;
  const sparse = total < 4 && (hasRecords || !!latest);
  const stateTitle = first ? title(find(first), first) : sparse ? "최근 사용 기록이 적어요"
    : hasRecords ? "모두 괜찮아요" : "첫 기록을 기다리고 있어요";
  const action = first ? {to:base + "/issues/" + first.id, label:"문제 보기"}
    : hasRecords ? {to:base + "#features", label:"기능별 상태 보기"} : {to:base + "/connect", label:"연결 확인하기"};
  const visible = new Map(rows.map(({f}) => [f.id, f]));
  const samples = new Map<string, Monitor["stats"]>();
  for (const row of data.stats) {
    if (!visible.has(row.feature_id) || !row.total) continue;
    const key = row.feature_id + "/" + row.bucket;
    const group = samples.get(key);
    if (group) group.push(row);
    else samples.set(key, [row]);
  }
  const recent = Array.from(samples.values(), group => ({
    at:Date.parse(group[0].bucket), feature:group[0].feature_id, ...summarize(group),
  })).sort((a,b) => b.at - a.at);
  const last = recent[0];
  const earlier = recent.filter(row => Math.floor(row.at / 3600000) !== Math.floor(last.at / 3600000));
  const slowest = earlier.sort((a,b) => (b.median ?? 0) - (a.median ?? 0))[0];
  const events = slowest ? [last, slowest] : recent.slice(0,1);
  return (
    <>
      <div className="dashboard-title"><div><small>앱 홈</small><h1 tabIndex={-1}>{displayText(data.name)}</h1></div>
        {toolbar}</div>
      {first ? <section className="panel status-overview" aria-label="앱 상태 요약">
        <div className="problem-count"><dl><dt>열린 문제 수</dt><dd><strong>{open.length}</strong>개</dd></dl><h2>{stateTitle}</h2></div>
        <div className="incident-tickets">{open.map(issue => <div className="incident-ticket" key={issue.id}>
          <div className="ticket-heading"><span className="ticket-symbol" aria-hidden="true">⚠</span><div>
            <small>{issue.kind === "silent" ? "앱 전체" : displayText(find(issue)?.name ?? "기능")} · 감지 당시</small>
            {issue.kind === "failure" && issue.metric_at_open?.failures != null ? <dl><dt>실패 건수</dt><dd>{issue.metric_at_open.failures}건</dd></dl> : <p>{details(issue, issue.metric_at_open, find(issue))}</p>}
          </div></div>
          <p>처음 감지 · <time dateTime={issue.opened_at}>{when(issue.opened_at)}</time></p>
          <div className="incident-actions">
            {issue.kind !== "silent" && <Copy compact text={() => loadPrompt(issue.id)} title={kindName[issue.kind] + " AI 조사 요청문 복사"} />}
            <Link className="dashboard-primary" to={base + "/issues/" + issue.id}>문제 보기</Link>
          </div>
        </div>)}</div>
      </section> : <section className="panel dashboard-state hero-card" aria-label="앱 상태 요약">
        {sparse ? <span className="status-badge waiting">기록 적음</span> : <StatusBadge state={hasRecords ? "healthy" : "waiting"} />}<h2>{stateTitle}</h2>
        <p role="status">{sparse ? "최근 " + periodName(days) + " 사용 " + total + "건 · 열린 문제가 없어요." : hasRecords ? "열린 문제가 없어요." : "연결한 앱을 한 번 사용하면 첫 기록을 확인할 수 있어요."}</p>
        <Link className="button dashboard-primary" to={action.to}>{action.label}</Link>
      </section>}
      <DashboardPanels data={data} days={days} />
      <div className="dashboard-lower">
        <section className="panel feature-list" id="features">
          <header><h2>기능별 상태</h2><small>최근 {periodName(days)} · 문제 있는 기능 먼저</small></header>
          {rows.length ? rows.map(({f,s}) => {
            const problem = open.find(i => i.feature_id === f.id);
            const baseline = f.baselines;
            const low = baseline?.observed_min_ms ?? s.min;
            const high = baseline?.observed_max_ms ?? s.max;
            return <Link key={f.id} className="feature-row" to={base + "/features/" + f.id}>
              <h3>{displayText(f.name)}</h3>
              <span className={"row-state " + (problem ? "problem" : s.total ? "healthy" : "waiting")}>
                <span aria-hidden="true">{problem ? "⚠" : s.total ? "✓" : "◷"}</span> {problem ? "문제 있어요" : s.total ? "괜찮아요" : "사용을 기다려요"}
              </span>
              <span>{s.total}건 사용</span>{f.kind !== "deep" && <span>{s.failures}건 실패</span>}<span aria-hidden="true" className="row-next">›</span>
              {showSpeed && <span className="row-metrics">보통 걸린 시간은 {approximateDuration(s.median)}예요.{" "}
                {baseline?.p50_ms != null ? usualDuration(baseline.p50_ms, baseline.p95_ms) : low != null && high != null
                  ? "지금까지 " + (baseline?.sample_count ?? s.total) + "건, " + time(low) + "~" + time(high) : "평소 속도를 알아가는 중이에요"}</span>}
              {f.kind === "deep" && <Outcomes stats={s} />}
            </Link>;
          }) : <p>아직 기록된 기능이 없어요.</p>}
          {rows.length > 0 && <button className="speed-toggle secondary" aria-expanded={showSpeed}
            onClick={() => setShowSpeed(value => !value)}>기능별 속도 {showSpeed ? "접기" : "보기"}</button>}
        </section>
        <section className="panel other-hours"><h2>다른 시간대 기록</h2>
          {events.length ? events.map(row => <div className="hour-row" key={row.at}>
            <time dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Seoul"})}</time>
            <div><strong>{displayText(visible.get(row.feature)?.name ?? "기능")} · {row.failures ? "실패 " + row.failures + "건" : "사용 " + row.total + "건"}</strong>
            <p>{row.median === null ? "시간 측정값이 없어요." : "보통 " + approximateDuration(row.median)}</p></div></div>) : <p>사용 기록이 도착하면 여기에 보여요.</p>}
        </section>
      </div>
      <section id="issues" className="panel dashboard-history"><h2>문제 기록</h2>
        {data.incidents.length ? data.incidents.map(i => <IssueListItem key={i.id} href={base + "/issues/" + i.id}
          summary={title(find(i), i)} state={i.status} metric={(i.metric_worst ? "가장 나빴을 때 · " : "감지 당시 · ") + details(i, i.metric_worst ?? i.metric_at_open, find(i))} />) : <p>열린 문제가 없어요.</p>}
      </section>
      {latest && data.versions.every(v => Date.parse(v.last_seen_at) < data.now - day) &&
        <p>하루 동안 기록이 없어요 — 사용자가 없었거나 연결이 끊겼을 수 있어요</p>}
      {bannerVersion != null && <p>새 버전 {displayVersion(bannerVersion)} 감지
        {latest && " (" + when(observedAt(latest, updated)) + ")"}{" "}
        {updated && <Link to={base + "/issues/" + updated.id + "#verification"}>업데이트 후 확인</Link>}</p>}
      <div className="actions"><Link to={base + "/features/deep/new"}>깊게 볼 기능 추가</Link>
        <Link to={base + "/connect"}>연결과 기능 이름 보기</Link></div>
      <div className="dashboard-dock"><Link className="button" to={action.to}>{action.label}</Link></div>
    </>
  );
}
function DashboardPanels({data,days,feature}: {data:Monitor; days:number; feature?:Feature}) {
  const [filter,setFilter] = useState("");
  const visible = feature ? [feature] : data.features.filter(f => !f.hidden);
  const selected = feature ?? visible.find(f => f.id === filter) ?? (visible.length === 1 ? visible[0] : undefined);
  const features = selected ? [selected] : visible;
  const ids = new Set(features.map(f => f.id));
  const rows = data.stats.filter(r => ids.has(r.feature_id));
  const thresholds = new Map(features.flatMap(f => f.baselines?.p95_ms == null ? [] : [[f.id,f.baselines.p95_ms] as const]));
  return <section className="usage-panel metrics-board" aria-label="사용 흐름">
    <header className="board-heading"><h2>사용 흐름</h2>{!feature && visible.length > 1 &&
      <select aria-label="그래프에 표시할 기능" value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="">모든 기능</option>{visible.map(f => <option key={f.id} value={f.id}>{displayText(f.name)}</option>)}
      </select>}</header>
    <Chart key={days + "/" + (selected?.id ?? "")} rows={rows} days={days} now={data.now} resources={data.serverSeries?.[days]}
      baseline={selected?.baselines?.p50_ms ?? null} p95={selected?.baselines?.p95_ms ?? null}
      thresholds={thresholds} aggregate={!selected && visible.length > 1} learnsRange={selected?.method !== "*"}
      samples={selected?.baselines?.sample_count ?? summarize(rows).successes}/>
    <SpeedInsights data={data} featureId={feature?.id ?? (filter || undefined)} />
  </section>;
}
function FeaturePage({
  data,
  feature: f,
  save,
  loadPrompt,
  days, toolbar,
}: {
  data: Monitor;
  feature: Feature;
  save: (ms: number) => Promise<void>;
  loadPrompt: (id: string) => Promise<string>;
  days:number; toolbar:ReactNode;
}) {
  const [seconds, setSeconds] = useState(String(f.slow_threshold_ms / 1000)),
    [result, message] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = data.stats.filter(
    (r) =>
      r.feature_id === f.id && Date.parse(r.bucket) >= data.now - days * day,
  );
  const summary = summarize(rows);
  const {id = ""} = useParams();
  const open = data.incidents.filter(i => i.feature_id === f.id && i.status === "open");
  const problem = open[0];
  const base = "/apps/" + encodeURIComponent(id);
  const destination = problem ? base + "/issues/" + problem.id : base + "#features";
  const action = problem ? "문제 보기" : "기능 목록 보기";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await save(Math.round(Number(seconds) * 1000));
      message("느림 기준을 저장했어요");
    } catch {
      message("저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  const kinds = new Map<string, number>();
  data.errorKinds
    .filter((s) => Date.parse(s.at) >= data.now - days * day)
    .forEach((s) => {
      const kind = errorKind(s.error_kind) ?? errorName(s.message) ?? "종류 미상";
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    });
  return (
    <>
      <div className="dashboard-title"><div><small>기능 상세</small><h1 tabIndex={-1}>{displayText(f.name)}</h1></div>{toolbar}</div>
      {f.kind === "deep" && <><Outcomes stats={summary} /><Link to={"../deep/" + encodeURIComponent(f.id)} relative="path">추가 연결 요청과 첫 결과 보기</Link></>}
      <section className="panel dashboard-state">
        <StatusBadge state={problem ? "open" : summary.total ? "healthy" : "waiting"} />
        <h2>{problem ? title(f, problem) : summary.total ? displayText(f.name) + " 기능은 괜찮아요" : "이 기간에는 사용 기록이 없어요"}</h2>
        <p>최근 {periodName(days)} 사용 {summary.total}건 중 {summary.failures}건 실패 · 보통 시간 {approximateDuration(summary.median)}</p>
        {f.baselines?.p50_ms != null && <p>{usualDuration(f.baselines.p50_ms, f.baselines.p95_ms)}</p>}
        {problem ? <div className="incident-actions">
          {open.map(issue => <Copy key={issue.id} compact text={() => loadPrompt(issue.id)} title={kindName[issue.kind] + " AI 조사 요청문 복사"} />)}
          <Link className="dashboard-primary" to={destination}>{action}</Link>
        </div> : <Link className="button dashboard-primary" to={destination}>{action}</Link>}
      </section>
      <DashboardPanels data={data} days={days} feature={f} />
      <section>
        <h2>최근 버전 비교</h2>
        <table>
          <caption>선택 기간의 버전별 결과</caption>
          <thead>
            <tr>
              {["버전", "사용", "실패율", "보통 시간"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.versions
              .filter((v) => rows.some((r) => r.version === v.version))
              .slice(0, 3)
              .map((v) => {
                const s = summarize(
                  rows.filter((r) => r.version === v.version),
                );
                return (
                  <tr key={v.version}>
                    <th>{displayVersion(v.version)}</th>
                    <td>{s.total}건</td>
                    <td>
                      {s.eligible ? Math.round((100 * s.failures) / s.eligible) + "%" : "기록 없음"}
                    </td>
                    <td>{approximateDuration(s.median)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>
      <details>
        <summary>자세히</summary>
        <p>{route(f)}</p>
        <h3>오류 종류별 기록</h3>
        {stepName(data.step) && <p>실패한 단계 · {stepName(data.step)}</p>}
        {[...kinds].map(([k, n]) => (
          <p key={k}>
            {k} {n}건
          </p>
        ))}
        <h3>최근 오류 예시 {data.samples.length}개</h3>
        <Samples data={data} />
      </details>
      <form className="panel" onSubmit={submit}>
        <label>
          느림 기준 (초)
          <input
            type="number"
            min=".001"
            max="2147483.647"
            step=".001"
            required
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </label>
        <small>보통 걸린 시간이 이 기준을 넘으면 느림으로 알려드려요.</small>
        <button disabled={busy} aria-busy={busy}>{busy ? "저장하는 중" : "저장"}</button>
        <p role="status">{result}</p>
      </form>
      <div className="dashboard-dock"><Link className="button" to={destination}>{action}</Link></div>
    </>
  );
}
function Samples({ data }: { data: Monitor }) {
  return data.samples.length ? (
    <ul>
      {data.samples.slice(0,5).map((s, i) => (
        <li key={i}>
          {when(s.at)} {errorKind(s.error_kind) ?? errorName(s.message) ?? "(내용 저장 안 함)"}
        </li>
      ))}
    </ul>
  ) : (
    <p>{noErrorSamples}</p>
  );
}
function issueContext(data: Monitor, f: Feature, i: Incident) {
  const proof = data.verification;
  const version = i.resolved_version ?? proof?.version;
  const fresh = data.versions.find((v) => v.version === version);
  const after = summarize(
    data.stats.filter(
      (r) =>
        r.feature_id === f.id &&
        r.version === version &&
        Date.parse(r.bucket) + 300000 > Date.parse(i.opened_at),
    ),
  );
  const streak = proof?.consecutive_successes ?? 0;
  const duration = proof?.latest_duration_ms;
  const normal = f.method === "*" ? null : f.baselines;
  const opening = i.metric_at_open;
  const p95 = (opening?.timing_basis ? opening.baseline_p95 : normal?.p95_ms) ?? Infinity;
  const p50 = (opening?.timing_basis ? opening.baseline_p50 : normal?.p50_ms) ?? Infinity;
  const threshold = opening?.slow_rule === "absolute" ? Math.min(f.slow_threshold_ms, opening.threshold ?? Infinity)
    : Math.min(f.slow_threshold_ms, p95 + 500, Math.max(p95, p50 + 499));
  const slow = i.kind === "slow" && duration != null && duration > threshold;
  const again = (proof?.latest_success === false || slow) && i.status === "open";
  const versions = version != null
    ? [version, i.opened_version]
    : [
        i.opened_version,
        ...data.versions
          .filter(
            (v) =>
              v.version !== i.opened_version &&
              Date.parse(v.first_seen_at) < Date.parse(i.opened_at),
          )
          .slice(0, 1)
          .map((v) => v.version),
      ];
  const metric = i.metric_worst ?? i.metric_at_open;
  const opening = i.metric_at_open ?? metric;
  const input = {
    feature: f.name,
    route: f.route ?? "",
    versions,
    step: data.step,
    kind: i.kind === "silent" ? undefined : i.kind,
    consecutive: i.metric_at_open?.consecutive,
    unconfirmed: opening?.unconfirmed,
    interruptions: metric?.interruptions ?? i.metric_at_open?.interruptions,
    queueMs: metric?.queue_ms,
    queuePct: metric?.queue_pct,
    cpuPct: data.serverContext?.peaks?.system_cpu_pct,
    stealPct: data.serverContext?.peaks?.steal_pct,
    opened: i.opened_at,
    closed: i.closed_at,
    versionFirstSeen: data.versions.find(v => v.version === i.opened_version)?.first_seen_at,
    now: data.now,
    context: data.promptContext,
    related: concurrentIssues(i, data.promptContext?.incident_start ?? data.promptContext?.slow_start ?? i.opened_at, data.incidents, data.features),
    mode: again
      ? ("again" as const)
      : i.notifications.some((n) => n.event === "worse")
        ? ("worse" as const)
        : ("first" as const),
    total: opening?.total,
    failures: opening?.failures,
    p50: opening?.p50,
    worst: i.metric_worst?.p50,
    baseline: opening?.baseline_p50 ?? opening?.baseline,
    baselineP95: opening?.baseline_p95,
    window: opening?.window,
    errors: data.samples,
  };
  return { proof, version, fresh, after, streak, duration, slow, again, metric, input };
}
function Issue({
  data,
  feature: f,
  issue: i,
  dismiss,
}: {
  data: Monitor;
  feature: Feature;
  issue: Incident;
  dismiss: () => Promise<void>;
}) {
  const [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState(false);
  const { proof, version, fresh, after, streak, duration, slow, again, metric, input } = issueContext(data, f, i);
  function verificationMessage() {
    if (i.status === "resolved") {
      const result = i.kind === "slow" ? "평소 속도로 끝났어요." : "성공했어요.";
      return "업데이트 후 " + displayText(f.name) + " 최근 5건이 모두 " + result;
    }
    if (version == null) return "고친 버전을 배포하면 여기서 확인해 드려요";
    if (proof?.latest_success == null) return "업데이트 후 첫 사용을 기다리고 있어요";
    if (slow) return "업데이트 후에도 최근 사용이 " + time(duration ?? null) + " 걸렸어요.";
    if (!proof.latest_success) {
      return after.failures
        ? "업데이트 후에도 " + after.eligible + "건 중 " + after.failures + "건 실패했어요"
        : "업데이트 후 최근 사용이 실패했어요";
    }
    return "업데이트 후 " + streak + "건 성공, " +
      (streak < 5 ? 5 - streak + "건 더 확인할게요" : "해결 판정을 기다리고 있어요");
  }
  const events = [
    {
      at: i.opened_at,
      text: "버전 " + displayVersion(i.opened_version) + "에서 처음 감지했어요",
    },
    ...i.notifications
      .filter((n) => n.ok)
      .map((n) => ({
        at: n.sent_at,
        text: n.event === "worse" ? "더 나빠짐 · 알림 보냄" : "알림 보냄",
      })),
  ];
  const observed = fresh && observedAt(fresh, i);
  if (fresh && observed && (!i.closed_at || Date.parse(observed) <= Date.parse(i.closed_at)))
    events.push({
      at: observed,
      text: "새 버전 감지 · " + displayVersion(fresh.version),
    });
  if (i.closed_at) events.push({ at: i.closed_at, text: status[i.status] +
    (i.resolved_version != null ? " · 버전 " + displayVersion(i.resolved_version) : "") });
  const prompt = buildIssuePrompt(input);
  const copyTitle = prompt.strongCount ? "그 줄 빼고 요청문 복사" : again ? "다시 보낼 요청문 복사" : "AI 조사 요청문 복사";
  const hasFailureCounts = i.kind === "failure" && metric?.total != null && metric.failures != null;
  function summaryTitle() {
    if (i.status === "resolved") return verificationMessage();
    if (input.interruptions) return displayText(f.name) + "의 응답이 잠시 멈췄어요";
    if (hasFailureCounts && !i.metric_at_open?.consecutive) {
      return displayText(f.name) + " " + displayText(String(metric.total)) + "건 중 " +
        displayText(String(metric.failures)) + "건 실패";
    }
    return title(f, i);
  }
  function summaryDetail() {
    if (i.status === "dismissed" && i.closed_at)
      return when(new Date(Date.parse(i.closed_at) + day).toISOString()) + "까지 다시 알리지 않아요.";
    if (i.status === "resolved") return "해결 전 기록 · " + details(i, metric, f);
    if (input.interruptions) return "10초 동안 완료 응답 0건 · 끊김 또는 시간 초과 " + input.interruptions + "건";
    if (i.kind === "unconfirmed" && metric?.unconfirmed != null)
      return "사용 결과를 확인하지 못한 기록 " + displayText(String(metric.unconfirmed)) + "건";
    return hasFailureCounts && !i.metric_at_open?.consecutive ? "감지 구간 · 최근 30분" : details(i, metric, f);
  }
  async function close() {
    setBusy(true);
    try {
      await dismiss();
      setDismissed(true);
      setFeedback("문제 아님으로 닫았어요");
    } catch {
      setFeedback("닫지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1 tabIndex={-1}>{displayText(f.name)} · {kindName[i.kind]} 문제 상세</h1>
      <section aria-label="문제 상태" className="panel issue-overview">
      <Hero showSheep={false} badge={<StatusBadge state={i.status} />}
        mood={i.status === "open" ? "worried" : "relieved"} arrived={i.status === "resolved"}
        title={summaryTitle()} detail={summaryDetail()} />
      {queueDescription(input.queueMs, input.queuePct) && <p>{queueDescription(input.queueMs, input.queuePct)}</p>}
      <div className="issue-copy">
        <div className="incident-actions"><Copy compact text={prompt.text} title={copyTitle} />
          <span>코딩 AI에 붙여 넣으세요</span></div>
        <ol aria-label="요청문 복사 후 다음 단계" className="issue-steps">
          <li>요청문 붙여 넣기</li><li>고친 뒤 배포</li><li>새 버전에서 5번 연속 정상이면 해결</li>
        </ol>
      </div>
      </section>
      {f.kind === "deep" && <section><h2>문제 감지 구간부터의 결과</h2><Outcomes stats={summarize(data.stats.filter(r => r.feature_id === f.id && Date.parse(r.bucket) <= Date.parse(i.closed_at ?? new Date(data.now).toISOString())))} /></section>}
      <IncidentServerSummary context={data.serverContext}/>
      <div className="issue-columns">
        <div className="issue-history">
          <section>
            <h2>지금까지 흐름</h2>
            <Timeline events={events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
              .map(event => ({ ...event, date: when(event.at) }))} />
          </section>
          {(i.status === "open" || i.status === "resolved") && <section id="verification" className="panel">
            <h2>업데이트 후 확인</h2>
            {version != null && <p>{i.status === "resolved" ? "해결 버전" : "확인 버전"} · {displayVersion(version)}</p>}
            <p>{i.status === "resolved" ? "업데이트 후 최근 5건의 사용 기록으로 해결을 확인했어요." : verificationMessage()}</p>
            {i.status === "resolved" && <div className="resolved-fill" aria-hidden="true" />}
          </section>}
        </div>
        <div className="issue-actions">
          <section className="panel">
            <h2>코딩 AI에 맡기기</h2>
            <p>
              요청문에는 비밀 키가 들어가지 않아요. 이메일·전화번호 같은 개인정보는
              가린 뒤 복사돼요.
            </p>
            <p>
              복사하기 전에 전체 내용을 확인할 수 있어요. 코딩 AI가 바꾼 코드는 배포
              전에 한 번 확인해 주세요.
            </p>
            {prompt.invalid && (
              <p role="status">
                앱이 보낸 버전 값이 형식에 맞지 않아 가렸어요.
              </p>
            )}
            {prompt.strongCount > 0 ? (
              <p role="alert">
                오류 기록에 지시처럼 보이는 문장이 {prompt.strongCount}줄 있어요. 앱
                사용자가 일부러 넣었을 수 있어요.
              </p>
            ) : (
              prompt.weakCount > 0 && (
                <p role="status">
                  외부 주소나 명령어가 들어간 오류 기록이 {prompt.weakCount}줄
                  있어요. 보통은 정상 오류 메시지라 그대로 넣어요.
                </p>
              )
            )}
            {prompt.lines.map(
              (s, n) =>
                prompt.levels[n] !== "normal" && (
                  <p key={n}>
                    <mark>{prompt.levels[n] === "strong" ? "강함" : "약함"} · {s}</mark>
                  </p>
                ),
            )}
            <details>
              <summary>보낼 내용 미리 보기</summary>
              <pre>{prompt.text}</pre>
              {prompt.strongCount > 0 && (
                <details>
                  <summary>그대로 복사할 내용</summary>
                  <pre>{buildIssuePrompt(input, true).text}</pre>
                </details>
              )}
            </details>
            {prompt.strongCount > 0 && (
              <><p>그대로 복사하면 강함으로 표시한 줄도 데이터 블록에 포함돼요.</p>
              <Copy compact text={buildIssuePrompt(input, true).text} title="그대로 복사" /></>
            )}
          </section>
          <details>
            <summary>자세히</summary>
            <p>{route(f)}</p>
            {stepName(data.step) && <p>실패한 단계 · {stepName(data.step)}</p>}
            <Samples data={data} />
          </details>
          {i.status === "open" && !dismissed && (
            <section>
              <p>닫으면 같은 기능의 같은 문제는 24시간 동안 다시 열리지 않아요.</p>
              <button className="secondary" disabled={busy} aria-busy={busy} onClick={close}>
                {busy ? "닫는 중" : "문제 아님으로 닫기"}
              </button>
            </section>
          )}
          <p role="status">{feedback}</p>
        </div>
      </div>
      <div className="dashboard-dock issue-dock"><Copy compact text={prompt.text} title={copyTitle} /></div>
    </>
  );
}
