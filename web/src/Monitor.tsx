import { useContext, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Copy } from "./Connect";
import { status, StatusBadge, Timeline, IssueListItem } from "./IncidentSummary";
import type { Gateway } from "./data";
import { Hero, CurrentAppName } from "./Layout";
import { displayText, sanitizeRoute } from "./normalize";
import { buildIssuePrompt, displayVersion } from "./issue-prompt";
import {
  summarize,
  type Monitor,
  type Feature,
  type Incident,
  type Stat,
} from "./monitor-data";

const day = 86400000;
const when = (s: string) => new Date(s).toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const time = (ms: number | string | null) =>
  typeof ms === "string" ? displayText(ms) : ms == null
    ? "기록 없음"
    : ms === Infinity
      ? "30초 초과"
      : +(ms / 1000).toFixed(2) + "초";

function observedAt(v: Monitor["versions"][number], i?: Incident) {
  return i && Date.parse(v.first_seen_at) <= Date.parse(i.opened_at) ? v.last_seen_at : v.first_seen_at;
}
const title = (f: Feature | undefined, i: Incident) =>
  displayText(f?.name ?? "기능") +
  {
    slow: "이 느려졌어요",
    failure: i.metric_at_open?.consecutive ? "에서 3건 연속 실패했어요" : "에서 실패가 늘었어요",
    unconfirmed: "의 기록 전송이 끊겼을 수 있어요",
  }[i.kind];
const route = (f: Feature) =>
  displayText(
    [f.method, sanitizeRoute(f.route ?? "")].filter(Boolean).join(" "),
  );
function details(i: Incident, f?: Feature) {
  const m = i.metric_worst ?? i.metric_at_open;
  if (!m) return when(i.opened_at) + "부터";
  if (i.kind === "unconfirmed")
    return "사용 결과를 확인하지 못했어요 · " + when(i.opened_at) + "부터";
  if (i.kind === "slow")
    return (
      (m.baseline == null ? "기준 " + time(f?.slow_threshold_ms ?? 5000) : "평소 " + time(m.baseline)) +
      " → 최근 30분 " +
      time(m.p50 ?? null) +
      (m.total == null ? "" : " (" + displayText(String(m.total)) + "건)")
    );
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
  const [attempt, setAttempt] = useState(0);
  const heading = useContext(CurrentAppName);
  const { hash } = useLocation();
  useEffect(() => {
    let active = true;
    setError(false);
    api
      .monitor(id, feature, issue)
      .then((result) => {
        if (active) {
          setData(result);
          heading({ id, name: result.name, issues: result.incidents.filter((i) => i.status === "open").length });
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [api, id, feature, issue, attempt, heading]);
  useEffect(() => {
    if (!data) return;
    const target = hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView?.();
    else document.querySelector<HTMLElement>(".monitor h1")?.focus();
  }, [data, hash]);
  const retry = () => setAttempt((n) => n + 1);
  const base = "/apps/" + encodeURIComponent(id);
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
  return (
    <div className="monitor">
      {error && <p role="alert">새 기록을 불러오지 못했어요. 마지막으로 확인한 내용이에요. <button onClick={retry}>다시 불러오기</button></p>}
      {(feature || issue) && (
        <Link to={base}>{displayText(data.name)} 홈으로</Link>
      )}
      {selected && incident ? (
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
          data={data}
          feature={selected}
          save={(ms) => api.threshold(id, selected.id, ms)}
        />
      ) : (
        <Home data={data} base={base} />
      )}
    </div>
  );
}
function Outcomes({stats}: {stats:ReturnType<typeof summarize>}) {
  const rate = stats.eligible ? Math.round(stats.failures / stats.eligible * 100) + "%" : "기록 없음";
  return <p>성공 {stats.successes}건 · 실패 {stats.failures}건 · 중단 {stats.abandoned}건 · 결과 미확인 {stats.unconfirmed}건 · 실패율 {rate}</p>;
}
function Home({ data, base }: { data: Monitor; base: string }) {
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
  return (
    <>
      <h1 tabIndex={-1}>{displayText(data.name)}</h1>
      <Hero
        badge={<StatusBadge state={open.length ? "open" : data.versions.length ? "healthy" : "waiting"} />}
        mood={open.length ? "worried" : latest ? "relieved" : "waiting"}
        title={
          open.length
            ? title(find(open[0]), open[0])
            : latest
              ? "모두 괜찮아요"
              : "첫 기록을 기다리고 있어요"
        }
        detail={open.length ? details(open[0], find(open[0])) : latest ? "열린 문제가 없어요" : "연결한 앱을 한 번 사용하면 첫 기록을 확인할 수 있어요."}
      />
      {latest &&
        data.versions.every(
          (v) => Date.parse(v.last_seen_at) < data.now - day,
        ) && (
          <p>
            하루 동안 기록이 없어요 — 사용자가 없었거나 연결이 끊겼을 수 있어요
          </p>
        )}
      {bannerVersion != null && (
        <p className="panel">
          새 버전 {displayVersion(bannerVersion)} 감지
          {latest && " (" + when(observedAt(latest, updated)) + ")"}{" "}
          {updated && (
            <Link to={base + "/issues/" + updated.id + "#verification"}>
              업데이트 후 확인
            </Link>
          )}
        </p>
      )}
      <section id="issues">
        <h2>문제</h2>
        {data.incidents.length ? (
          data.incidents.map((i) => (
            <IssueListItem key={i.id} href={base + "/issues/" + i.id}
              summary={title(find(i), i)} state={i.status} metric={details(i, find(i))} />
          ))
        ) : (
          <p>열린 문제가 없어요.</p>
        )}
      </section>
      <section id="features">
        <h2>기능 · 최근 24시간</h2>
        <Link className="button" to={base + "/features/deep/new"}>깊게 볼 기능 추가</Link>
        {rows.length ? (
          rows.map(({ f, s }) => {
            const issue = open.find((i) => i.feature_id === f.id);
            const b = f.baselines;
            const low = b?.observed_min_ms ?? s.min,
              high = b?.observed_max_ms ?? s.max;
            return (
              <Link
                className="panel app-card"
                key={f.id}
                to={base + "/features/" + f.id}
              >
                <h3>{displayText(f.name)}</h3>
                {f.kind === "deep" && <Outcomes stats={s} />}
                <span className={"feature-status " + (issue ? "problem" : s.total ? "healthy" : "")}>
                  <span aria-hidden="true">{issue ? "⚠ " : s.total ? "✓ " : "◷ "}</span>
                  {issue
                    ? title(f, issue)
                    : s.total
                      ? "괜찮아요"
                      : "사용을 기다려요"}
                </span>
                <p>
                  사용 {s.total}건 중 {s.failures}건이 실패했어요. 보통 걸린 시간은 {time(s.median)}예요.
                </p>
                {b?.p50_ms != null
                  ? "평소 " + time(b.p50_ms)
                  : low != null && high != null
                    ? "지금까지 " +
                      (b?.sample_count ?? s.total) +
                      "건, " +
                      time(low).replace(/초$/, "") +
                      "~" +
                      time(high)
                    : "평소 속도를 알아가는 중이에요"}
              </Link>
            );
          })
        ) : (
          <p>아직 기록된 기능이 없어요.</p>
        )}
      </section>
      <Link to={base + "/connect"}>연결과 기능 이름 확인</Link>
    </>
  );
}
function Chart({
  rows,
  days,
  now,
  baseline,
}: {
  rows: Stat[];
  days: number;
  now: number;
  baseline: number | null;
}) {
  const count = days === 1 ? 12 : 7,
    width = (days * day) / count,
    start = now - days * day;
  const points = Array.from({ length: count }, (_, i) => ({
    label: new Date(start + i * width).toLocaleString(
      "ko-KR",
      days === 1
        ? { hour: "numeric", minute: "2-digit" }
        : { month: "numeric", day: "numeric" },
    ),
    ...summarize(
      rows.filter(
        (r) =>
          Date.parse(r.bucket) >= start + i * width &&
          Date.parse(r.bucket) < start + (i + 1) * width,
      ),
    ),
  }));
  const current = points.slice().reverse().find((p) => p.median != null)?.median;
  const max = Math.max(1, ...points.map((p) => p.total));
  const speed = (n: number) => Math.min(n, 30001);
  const peak = Math.max(1, speed(baseline ?? 0), ...points.map((p) => speed(p.median ?? 0)));
  const failureHeight = (n: number) => n ? Math.max(4, 45 * n / max) : 0;
  const x = (i: number) => (i * 600) / count + 300 / count;
  return (
    <>
      <p>지금 {time(current ?? null)}{baseline != null && " · 평소 " + time(baseline)}</p>
      <svg
        viewBox="0 0 600 210"
        width="100%"
        role="img"
        aria-label="사용·실패 건수와 보통 시간 추이. 아래 표에서 수치를 확인할 수 있어요."
      >
        {points.map((p, i) => (
          <g key={i}>
            <rect
              x={x(i) - 180 / count}
              y={105 - failureHeight(p.failures) - (p.failures ? 2 : 0) - (45 * p.total) / max}
              width={360 / count}
              height={(45 * p.total) / max}
              fill="var(--sp-chart)"
            />
            <rect
              x={x(i) - 180 / count}
              y={105 - failureHeight(p.failures)}
              width={360 / count}
              height={failureHeight(p.failures)}
              fill="var(--sp-chart-failure)"
            />
            {p.median !== null && (
              <circle
                cx={x(i)}
                cy={205 - (90 * speed(p.median)) / peak}
                r="2"
                fill="var(--sp-chart-time)"
              />
            )}
            {p.median !== null && i > 0 && points[i - 1].median !== null && (
              <line
                x1={x(i - 1)}
                x2={x(i)}
                y1={205 - (90 * speed(points[i - 1].median!)) / peak}
                y2={205 - (90 * speed(p.median)) / peak}
                stroke="var(--sp-chart-time)"
                strokeWidth="2.5"
              />
            )}
          </g>
        ))}
        {baseline != null && <line x1="0" x2="600" y1={205 - 90 * speed(baseline) / peak}
          y2={205 - 90 * speed(baseline) / peak} stroke="var(--sp-chart-usual)" strokeDasharray="5 4" strokeWidth="2.5" />}
      </svg>
      <p className="chart-legend"><span>사용</span> <span>실패</span> <span className="time-line">보통 시간</span> {baseline != null && <span className="usual-line">평소 속도</span>} · {when(new Date(start).toISOString())} ~ {when(new Date(now).toISOString())}</p>
      <details>
        <summary>표로 보기</summary>
        <table>
          <caption>최근 {days === 1 ? "24시간" : "7일"} 기록</caption>
          <thead>
            <tr>
              {["시작 시각", "사용", "실패", "보통 시간"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <th>{p.label}</th>
                <td>{p.total}</td>
                <td>{p.failures}</td>
                <td>{time(p.median)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
function FeaturePage({
  data,
  feature: f,
  save,
}: {
  data: Monitor;
  feature: Feature;
  save: (ms: number) => Promise<void>;
}) {
  const [days, period] = useState(1),
    [seconds, setSeconds] = useState(String(f.slow_threshold_ms / 1000)),
    [result, message] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = data.stats.filter(
    (r) =>
      r.feature_id === f.id && Date.parse(r.bucket) >= data.now - days * day,
  );
  const summary = summarize(rows);
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
      const kind = displayText(s.error_kind ?? "종류 미상");
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    });
  return (
    <>
      <h1 tabIndex={-1}>{displayText(f.name)}</h1>
      {f.kind === "deep" && <><Outcomes stats={summary} /><Link to={"../deep/" + encodeURIComponent(f.id)} relative="path">추가 연결 요청과 첫 결과 보기</Link></>}
      <Hero
        title={
          summary.total
            ? "사용 " +
              summary.total +
              "건 중 " +
              summary.failures +
              "건 실패했어요"
            : "이 기간에는 사용 기록이 없어요"
        }
        detail={"보통 걸린 시간 " + time(summary.median)}
      />
      <section className="panel">
        <h2>사용 흐름</h2>
        <div className="chart-period" role="group" aria-label="조회 기간">{[1, 7].map((d) => (
          <button key={d} aria-pressed={d === days} onClick={() => period(d)}>
            {d === 1 ? "24시간" : "7일"}
          </button>
        ))}</div>
        <Chart rows={rows} days={days} now={data.now} baseline={f.baselines?.p50_ms ?? null} />
      </section>
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
                    <td>{time(s.median)}</td>
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
        {data.step && <p>실패한 단계 · {displayText(data.step)}</p>}
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
        <small>평소 속도가 없을 때만 사용해요.</small>
        <button disabled={busy} aria-busy={busy}>{busy ? "저장하는 중" : "저장"}</button>
        <p role="status">{result}</p>
      </form>
    </>
  );
}
function Samples({ data }: { data: Monitor }) {
  return data.samples.length ? (
    <ul>
      {data.samples.map((s, i) => (
        <li key={i}>
          {when(s.at)} {displayText(s.error_kind ?? "")}{" "}
          {displayText(s.message ?? "")}
        </li>
      ))}
    </ul>
  ) : (
    <p>오류 예시가 없어요.</p>
  );
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
  const threshold = f.baselines?.p50_ms == null ? f.slow_threshold_ms : f.baselines.p50_ms * 1.5;
  const slow = i.kind === "slow" && duration != null && duration > threshold;
  const again = (proof?.latest_success === false || slow) && i.status === "open";
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
  const input = {
    feature: f.name,
    route: f.route ?? "",
    versions,
    step: data.step,
    kind: i.kind,
    consecutive: i.metric_at_open?.consecutive,
    unconfirmed: metric?.unconfirmed,
    opened: i.opened_at,
    mode: again
      ? ("again" as const)
      : i.notifications.some((n) => n.event === "worse")
        ? ("worse" as const)
        : ("first" as const),
    total: metric?.total,
    failures: metric?.failures,
    p50: metric?.p50,
    baseline: metric?.baseline,
    errors: data.samples,
  };
  const prompt = buildIssuePrompt(input);
  const hasFailureCounts = i.kind === "failure" && metric?.total != null && metric.failures != null;
  function summaryTitle() {
    if (i.status === "resolved") return verificationMessage();
    if (hasFailureCounts && !i.metric_at_open?.consecutive) {
      return displayText(f.name) + " " + displayText(String(metric.total)) + "건 중 " +
        displayText(String(metric.failures)) + "건 실패";
    }
    return title(f, i);
  }
  function summaryDetail() {
    if (i.status === "dismissed" && i.closed_at)
      return when(new Date(Date.parse(i.closed_at) + day).toISOString()) + "까지 다시 알리지 않아요.";
    if (i.status === "resolved") return "해결 전 기록 · " + details(i, f);
    if (i.kind === "unconfirmed" && metric?.unconfirmed != null)
      return "사용 결과를 확인하지 못한 기록 " + displayText(String(metric.unconfirmed)) + "건";
    return hasFailureCounts && !i.metric_at_open?.consecutive ? "감지 구간 · 최근 30분" : details(i, f);
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
      <h1 tabIndex={-1}>문제 상세</h1>
      {f.kind === "deep" && <section><h2>문제 감지 구간부터의 결과</h2><Outcomes stats={summarize(data.stats.filter(r => r.feature_id === f.id && Date.parse(r.bucket) <= Date.parse(i.closed_at ?? new Date(data.now).toISOString())))} /></section>}
      <Hero badge={<StatusBadge state={i.status} />}
        mood={i.status === "open" ? "worried" : "relieved"} arrived={i.status === "resolved"}
        title={summaryTitle()} detail={summaryDetail()} />
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
                앱이 보낸 버전 값이 형식에 맞지 않아요. 버전 줄은 데이터 표시 안에
                넣어 보내요.
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
            <Copy compact text={prompt.text} title={prompt.strongCount
                ? "그 줄 빼고 복사"
                : again
                  ? "AI에 다시 보낼 내용 복사"
                  : "AI에 보낼 내용 복사"} />
            {prompt.strongCount > 0 && (
              <><p>그대로 복사하면 강함으로 표시한 줄도 데이터 블록에 포함돼요.</p>
              <Copy compact text={buildIssuePrompt(input, true).text} title="그대로 복사" /></>
            )}
          </section>
          <details>
            <summary>자세히</summary>
            <p>{route(f)}</p>
            {data.step && <p>실패한 단계 · {displayText(data.step)}</p>}
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
    </>
  );
}
