import { useContext, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
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
const when = (s: string) => new Date(s).toLocaleString("ko-KR");
const time = (ms: number | string | null) =>
  typeof ms === "string" ? displayText(ms) : ms == null
    ? "기록 없음"
    : ms === Infinity
      ? "30초 초과"
      : +(ms / 1000).toFixed(2) + "초";
const status = {
  open: "진행 중",
  resolved: "해결됐어요",
  quiet: "잠잠해졌어요",
  dismissed: "문제 아님으로 닫음",
};
const title = (f: Feature | undefined, i: Incident) =>
  displayText(f?.name ?? "기능") +
  {
    slow: "이 느려졌어요",
    failure: "에서 실패가 늘었어요",
    unconfirmed: "의 결과 기록이 끊겼을 수 있어요",
  }[i.kind];
const route = (f: Feature) =>
  displayText(
    [f.method, sanitizeRoute(f.route ?? "")].filter(Boolean).join(" "),
  );
function details(i: Incident) {
  const m = i.metric_worst ?? i.metric_at_open;
  if (!m) return when(i.opened_at) + "부터";
  if (i.kind === "unconfirmed")
    return "사용 결과를 확인하지 못했어요 · " + when(i.opened_at) + "부터";
  if (i.kind === "slow")
    return (
      "평소 " +
      time(m.baseline ?? null) +
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
  useEffect(() => {
    let active = true;
    setError(false);
    api
      .monitor(id, feature, issue)
      .then((result) => {
        if (active) {
          setData(result);
          heading({ id, name: result.name });
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
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView?.();
    else document.querySelector<HTMLElement>(".monitor h1")?.focus();
  }, [data]);
  const retry = () => setAttempt((n) => n + 1);
  const base = "/apps/" + encodeURIComponent(id);
  if (error)
    return (
      <section role="alert">
        <h1 tabIndex={-1}>기록을 불러오지 못했어요</h1>
        <button onClick={retry}>다시 불러오기</button>{" "}
        <Link to="/apps">내 앱</Link>
      </section>
    );
  if (!data) return <p role="status">기록을 불러오는 중</p>;
  const incident = data.incidents.find((i) => i.id === issue);
  const selected = data.features.find(
    (f) => f.id === (feature ?? incident?.feature_id),
  );
  return (
    <div className="monitor">
      {(feature || issue) && (
        <Link to={base}>{displayText(data.name)} 홈으로</Link>
      )}
      {selected && incident ? (
        <Issue
          data={data}
          feature={selected}
          issue={incident}
          dismiss={async () => {
            await api.dismiss(id, incident.id);
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
function Home({ data, base }: { data: Monitor; base: string }) {
  const open = data.incidents.filter((i) => i.status === "open");
  const find = (i: Incident) =>
    data.features.find((f) => f.id === i.feature_id);
  const rows = data.features
    .map((f) => ({
      f,
      s: summarize(data.stats.filter((r) => r.feature_id === f.id)),
    }))
    .sort((a, b) => b.s.total - a.s.total);
  const latest = data.versions[0];
  const updated =
    latest &&
    data.incidents.find(
      (i) => Date.parse(i.opened_at) < Date.parse(latest.first_seen_at),
    );
  return (
    <>
      <h1 tabIndex={-1}>{displayText(data.name)}</h1>
      <Hero
        title={
          open.length
            ? title(find(open[0]), open[0])
            : latest
              ? "모두 괜찮아요"
              : "첫 기록을 기다리고 있어요"
        }
        detail={open.length ? details(open[0]) : "열린 문제가 없어요"}
      />
      {latest &&
        data.versions.every(
          (v) => Date.parse(v.last_seen_at) < data.now - day,
        ) && (
          <p>
            하루 동안 기록이 없어요 — 사용자가 없었거나 연결이 끊겼을 수 있어요
          </p>
        )}
      {latest && (
        <p className="panel">
          새 버전 {displayVersion(latest.version)} 감지 (
          {when(latest.first_seen_at)}){" "}
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
            <p key={i.id}>
              <Link to={base + "/issues/" + i.id}>
                {title(find(i), i)} · {status[i.status]}
              </Link>{" "}
              {details(i)}
            </p>
          ))
        ) : (
          <p>열린 문제가 없어요.</p>
        )}
      </section>
      <section id="features">
        <h2>기능 · 최근 24시간</h2>
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
                <span>
                  {issue
                    ? title(f, issue)
                    : s.total
                      ? "괜찮아요"
                      : "사용을 기다려요"}
                </span>
                <p>
                  사용 {s.total}건 · 실패 {s.failures}건 · 보통 {time(s.median)}
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
}: {
  rows: Stat[];
  days: number;
  now: number;
}) {
  const count = days === 1 ? 24 : 7,
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
  const max = Math.max(1, ...points.map((p) => p.total));
  const speed = (n: number) => Math.min(n, 30001);
  const peak = Math.max(1, ...points.map((p) => speed(p.median ?? 0)));
  const x = (i: number) => (i * 600) / count + 300 / count;
  return (
    <>
      <p>막대는 사용·실패 건수, 선은 보통 시간이에요.</p>
      <svg
        viewBox="0 0 600 110"
        width="100%"
        role="img"
        aria-label="사용·실패 건수와 보통 시간 추이. 아래 표에서 수치를 확인할 수 있어요."
      >
        {points.map((p, i) => (
          <g key={i}>
            <rect
              x={x(i) - 180 / count}
              y={105 - (100 * p.total) / max}
              width={360 / count}
              height={(100 * p.total) / max}
              fill="var(--sp-primary, #6941ad)"
            />
            <rect
              x={x(i) - 180 / count}
              y={105 - (100 * p.failures) / max}
              width={360 / count}
              height={(100 * p.failures) / max}
              fill="var(--sp-bad-ink, #b43846)"
            />
            {p.median !== null && (
              <circle
                cx={x(i)}
                cy={105 - (100 * speed(p.median)) / peak}
                r="2"
                fill="currentColor"
              />
            )}
            {p.median !== null && i > 0 && points[i - 1].median !== null && (
              <line
                x1={x(i - 1)}
                x2={x(i)}
                y1={105 - (100 * speed(points[i - 1].median!)) / peak}
                y2={105 - (100 * speed(p.median)) / peak}
                stroke="currentColor"
                strokeWidth="2"
              />
            )}
          </g>
        ))}
      </svg>
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
        {[1, 7].map((d) => (
          <button key={d} aria-pressed={d === days} onClick={() => period(d)}>
            {d === 1 ? "24시간" : "7일"}
          </button>
        ))}
        <Chart rows={rows} days={days} now={data.now} />
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
                      {s.total ? Math.round((100 * s.failures) / s.total) : 0}%
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
        <button disabled={busy}>저장</button>
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
    [manual, setManual] = useState(""),
    [busy, setBusy] = useState(false);
  const fresh = data.versions.find(
    (v) =>
      Date.parse(v.first_seen_at) > Date.parse(i.opened_at) &&
      (!i.resolved_version || v.version === i.resolved_version),
  );
  const after = summarize(
    data.stats.filter(
      (r) =>
        r.feature_id === f.id &&
        r.version === fresh?.version &&
        Date.parse(r.bucket) + 300000 > Date.parse(i.opened_at),
    ),
  );
  const slow =
    i.kind === "slow" &&
    after.median !== null &&
    after.median >
      (f.baselines?.p50_ms ? f.baselines.p50_ms * 1.5 : f.slow_threshold_ms);
  const again = (!!after.failures || slow) && i.status === "open";
  const events = [
    {
      at: i.opened_at,
      text: "처음 감지 · " + displayVersion(i.opened_version),
    },
    ...i.notifications
      .filter((n) => n.ok)
      .map((n) => ({
        at: n.sent_at,
        text: n.event === "worse" ? "더 나빠짐 · 알림 보냄" : "알림 보냄",
      })),
  ];
  if (fresh)
    events.push({
      at: fresh.first_seen_at,
      text: "새 버전 감지 · " + displayVersion(fresh.version),
    });
  if (i.closed_at) events.push({ at: i.closed_at, text: status[i.status] });
  const versions = fresh
    ? [fresh.version, i.opened_version]
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
    errors: data.samples.map(
      (s) =>
        new Date(s.at).toISOString().slice(11, 16) +
        " " +
        (s.error_kind ? s.error_kind + ": " : "") +
        (s.message ?? ""),
    ),
  };
  const prompt = buildIssuePrompt(input);
  async function copy(all: boolean) {
    const text = buildIssuePrompt(input, all).text;
    try {
      await navigator.clipboard.writeText(text);
      setManual("");
      setFeedback("복사했어요");
    } catch {
      setManual(text);
      setFeedback("아래 내용을 직접 선택해 복사해 주세요.");
    }
  }
  async function close() {
    setBusy(true);
    try {
      await dismiss();
      setFeedback("문제 아님으로 닫았어요");
    } catch {
      setFeedback("닫지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1 tabIndex={-1}>{title(f, i)}</h1>
      <Hero title={status[i.status]} detail={details(i)} />
      <p>
        현재 상태 · {status[i.status]}　시작 {when(i.opened_at)}
      </p>
      <h2>지금까지 흐름</h2>
      <ol>
        {events
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
          .map((e, n) => (
            <li key={n}>
              {when(e.at)} · {e.text}
            </li>
          ))}
      </ol>
      <section id="verification" className="panel">
        <h2>업데이트 후 확인</h2>
        <p>
          {i.status === "resolved"
            ? "업데이트 후 해결됐어요" +
              (after.total ? " · 확인한 사용 " + after.total + "건" : "")
            : !fresh
              ? "고친 버전을 배포하면 여기서 확인해 드려요"
              : !after.total
                ? "업데이트 후 첫 사용을 기다리고 있어요"
                : slow && again
                  ? "업데이트 후에도 보통 시간이 " +
                    time(after.median) +
                    "로 느려요"
                  : again
                    ? "업데이트 후에도 " +
                      after.total +
                      "건 중 " +
                      after.failures +
                      "건 실패했어요"
                    : "업데이트 후 " +
                      after.successes +
                      "건 성공, " +
                      (after.successes < 5
                        ? 5 - after.successes + "건 더 확인할게요"
                        : "해결 판정을 기다리고 있어요")}
        </p>
      </section>
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
            <p>
              외부 주소나 명령어가 들어간 오류 기록이 {prompt.weakCount}줄
              있어요. 보통은 정상 오류 메시지라 그대로 넣어요.
            </p>
          )
        )}
        {prompt.lines.map(
          (s, n) =>
            prompt.levels[n] !== "normal" && (
              <p key={n}>
                <mark>{s}</mark>
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
        <button onClick={() => copy(false)}>
          {prompt.strongCount
            ? "그 줄 빼고 복사"
            : again
              ? "AI에 다시 보낼 내용 복사"
              : "AI에 보낼 내용 복사"}
        </button>{" "}
        {prompt.strongCount > 0 && (
          <button className="secondary" onClick={() => copy(true)}>
            그대로 복사
          </button>
        )}
        {manual && (
          <textarea
            aria-label="직접 복사할 내용"
            readOnly
            value={manual}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </section>
      <details>
        <summary>자세히</summary>
        <p>{route(f)}</p>
        <Samples data={data} />
      </details>
      {i.status === "open" && (
        <section>
          <p>닫으면 같은 기능의 같은 문제는 24시간 동안 다시 열리지 않아요.</p>
          <button disabled={busy} onClick={close}>
            문제 아님으로 닫기
          </button>
        </section>
      )}
      <p role="status">{feedback}</p>
    </>
  );
}
