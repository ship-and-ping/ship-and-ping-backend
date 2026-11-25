import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Copy } from "./Connect";
import type { Gateway } from "./data";
import {
  deepLabels,
  deepPrompt,
  fieldNames,
  resultKinds,
  type DeepFeature,
  type FirstResult,
} from "./deep";
import { displayText } from "./normalize";
import { Hero } from "./Layout";

const empty = { name: "", start: "", success: "" };
const examples = {
  name: "예: 모임 신청, 결제, 글쓰기",
  start: "사용자가 무엇을 하면 시작인가요? 예: 신청 버튼을 누를 때",
  success: "무엇이 끝나야 진짜 성공인가요? 예: 참가자 명단에 저장됐을 때",
};

function Arrival({
  api,
  app,
  feature,
}: {
  api: Gateway;
  app: string;
  feature: DeepFeature;
}) {
  const [result, setResult] = useState<FirstResult | null>(null);
  const [error, setError] = useState(false);
  const [counts, setCounts] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const first = await api.firstResult(app, feature.id);
        if (!active) return;
        setResult(first);
        const totals = await api.deepCounts(app, feature.id);
        if (!active) return;
        setCounts(totals);
        setError(false);
        if (first && (first.status !== "success" || first.duration_ms != null))
          return;
      } catch {
        if (active) setError(true);
      }
      if (active) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, app, feature.id]);
  const success = displayText(feature.success ?? "");
  const duration = result?.duration_ms;
  const detail = error
    ? "결과를 다시 확인하는 중이에요."
    : !result
      ? "코딩 AI에 요청문을 붙여넣고 배포한 뒤 앱에서 이 기능을 한 번 사용해 보세요."
      : result.status === "failure"
        ? "첫 시도는 실패했어요."
        : result.status === "abandon"
          ? "첫 시도는 중단됐어요."
          : duration == null
            ? "실제 성공을 확인했어요."
            : (/됐을 때$/.test(success)
                ? success.replace(/됐을 때$/, "되기까지")
                : "실제 성공까지") +
              " " +
              Math.round(duration / 10) / 100 +
              "초 걸렸어요.";
  return (
    <>
    <Hero
      arrived={result?.status === "success"}
      mood={!result ? "waiting" : result.status === "success" ? "relieved" : "worried"}
      title={
        result
          ? "첫 " + displayText(feature.name) + " 기록이 도착했어요."
          : "첫 결과를 기다리고 있어요"
      }
      detail={detail}
    />
    {!result && <section className="panel"><h2>남은 할 일</h2>
      <ol><li>추가 연결 요청 복사</li><li>코딩 AI가 코드 추가</li><li>배포</li><li>{displayText(feature.name)} 한 번 해 보기</li></ol>
    </section>}
    {counts.some(Boolean) && <section className="panel"><h2>지금까지 결과</h2>
      <dl className="deep-results">{resultKinds.map(([status, label, icon], index) =>
        <div key={status}><dt><span aria-hidden="true">{icon} </span>{label}</dt><dd>{counts[index]}건</dd></div>
      )}</dl>
    </section>}
    </>
  );
}

export function DeepPage({ api, ingest }: { api: Gateway; ingest: string }) {
  const { id = "", tracking = "new" } = useParams();
  return (
    <DeepForm
      key={id + "/" + tracking}
      api={api}
      ingest={ingest}
      app={id}
      tracking={tracking}
    />
  );
}
function DeepForm({
  api,
  ingest,
  app,
  tracking,
}: {
  api: Gateway;
  ingest: string;
  app: string;
  tracking: string;
}) {
  const navigate = useNavigate();
  const base = "/apps/" + encodeURIComponent(app);
  const [features, setFeatures] = useState<DeepFeature[]>();
  const [raw, setRaw] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const storageKey = "deep-create:" + app;
  const [request] = useState(() => sessionStorage.getItem(storageKey) ?? crypto.randomUUID());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    api
      .deepFeatures(app)
      .then((list) => {
        if (!active) return;
        const recovered = tracking === "new" && list.find((f) => f.create_request_id === request);
        if (recovered) {
          sessionStorage.removeItem(storageKey);
          navigate(base + "/features/deep/" + encodeURIComponent(recovered.id), { replace: true });
        }
        else setFeatures(list);
      })
      .catch(() => {
        if (active) setError("기능 목록을 불러오지 못했어요.");
      });
    return () => {
      active = false;
    };
  }, [api, app, attempt, base, navigate, request, storageKey, tracking]);
  const saved = features?.find((f) => f.id === tracking);
  const fields = saved
    ? {
        name: saved.name,
        start: saved.start ?? "",
        success: saved.success ?? "",
      }
    : raw;
  const prompt = deepPrompt(fields, saved?.feature_key, ingest);
  const invalid = Object.keys(prompt.errors).length > 0;
  async function save() {
    setBusy(true);
    try {
      sessionStorage.setItem(storageKey, request);
      const feature = await api.saveDeep(app, prompt.fields, request);
      sessionStorage.removeItem(storageKey);
      navigate(base + "/features/deep/" + encodeURIComponent(feature.id), {
        replace: true,
      });
    } catch {
      setError(
        "추가 결과를 확인하지 못했어요. 기능 추가를 다시 눌러 주세요.",
      );
      retry((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!saved || !confirmDelete) return;
    setBusy(true);
    try {
      await api.deleteDeep(app, saved.id);
      navigate(base + "/features/deep/new", { replace: true });
    } catch {
      setError("삭제 결과를 확인하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="narrow deep-page">
      <Link to={base}>앱 홈으로</Link>
      <h1 tabIndex={-1}>
        {saved ? displayText(saved.name) + " 깊게 보기" : "깊게 볼 기능 추가"}
      </h1>
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              retry((n) => n + 1);
            }}
          >
            다시 확인
          </button>
        </p>
      )}
      {!features ? (
        <p role="status">등록된 기능을 확인하는 중이에요.</p>
      ) : !saved && tracking !== "new" ? (
        <p>기능을 찾을 수 없어요.</p>
      ) : (
        <>
          {saved && <Arrival api={api} app={app} feature={saved} />}
          <p>
            앱마다 최대 5개까지 깊게 볼 수 있어요. 남은 자리 {5 - features.length}개
          </p>
          {saved || features.length < 5 ? (
            <>
              <section className="panel">
                {fieldNames.map((k) => (
                  <div key={k}>
                    <label htmlFor={"deep-" + k}>
                      {deepLabels[k]}
                    </label>
                    {!saved && <small id={"help-" + k}>{examples[k]}</small>}
                      <input
                        id={"deep-" + k}
                        aria-describedby={saved ? undefined : "help-" + k}
                        readOnly={!!saved}
                        disabled={busy}
                        value={saved ? displayText(fields[k]) : raw[k]}
                        onChange={(e) =>
                          setRaw({ ...raw, [k]: e.target.value })
                        }
                      />
                    {fields[k] && prompt.errors[k] && (
                      <small role="alert">{prompt.errors[k]}</small>
                    )}
                  </div>
                ))}
                {!saved && (
                  <button disabled={busy || invalid} onClick={save}>
                    기능 추가
                  </button>
                )}
              </section>
              <section className="panel">
                <h2>코딩 AI에 추가 연결 요청하기</h2>
                <p>
                  요청문에는 비밀 키가 들어가지 않아요. 복사하기 전에 전체
                  내용을 확인할 수 있어요. 코딩 AI가 바꾼 코드는 배포 전에 한 번
                  확인해 주세요.
                </p>
                <details open={!saved}>
                  <summary>보낼 내용 미리 보기</summary>
                  <pre>{prompt.text}</pre>
                </details>
                {saved && !invalid ? (
                  <Copy
                    compact
                    text={prompt.text}
                    title="추가 연결 요청 복사"
                  />
                ) : (
                  <><button disabled aria-describedby="copy-reason">추가 연결 요청 복사</button>
                    <p id="copy-reason">{invalid ? "세 칸을 모두 올바르게 입력하면 기능을 추가할 수 있어요." : "기능을 추가하면 연결 요청을 복사할 수 있어요."}</p></>
                )}
              </section>
              {saved && <section className="panel">
                {confirmDelete ? <>
                  <p>{displayText(saved.name)} 기능과 수집한 기록을 삭제할까요?</p>
                  <button disabled={busy} onClick={() => setConfirmDelete(false)}>취소</button>
                  <button disabled={busy} onClick={remove}>삭제 확인</button>
                </> : <button onClick={() => setConfirmDelete(true)}>기능 삭제</button>}
              </section>}
            </>
          ) : (
            <p>이미 5개를 등록했어요.</p>
          )}
          {!saved &&
            features.map((f) => (
              <p key={f.id}>
                <Link to={base + "/features/deep/" + encodeURIComponent(f.id)}>
                  {displayText(f.name)} 연결 확인
                </Link>
              </p>
            ))}
        </>
      )}
    </div>
  );
}
