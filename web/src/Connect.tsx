import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Gateway, Label, Snapshot } from "./data";
import { buildConnectPrompt } from "./domain";
import { Hero } from "./Layout";

function Copy({
  text,
  title,
  secret = false,
  onCopy,
}: {
  text: string;
  title: string;
  secret?: boolean;
  onCopy?: () => void;
}) {
  const [result, setResult] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setResult("복사했어요");
      onCopy?.();
    } catch {
      setResult("자동 복사가 막혔어요. 아래 내용을 직접 선택해 복사하세요");
    }
  }
  const manual = result.startsWith("자동");
  useEffect(() => {
    if (manual) {
      area.current?.focus();
      area.current?.select();
    }
  }, [manual]);
  return (
    <>
      <button onClick={copy}>{title}</button>
      <span role="status">{result}</span>
      {(!secret || manual) && (
        <textarea
          aria-label={title + " 전문"}
          ref={area}
          className={secret ? "" : "preview"}
          readOnly
          value={text}
        />
      )}
    </>
  );
}

export function Connect({
  api,
  id,
  ingest,
  initialKey,
}: {
  api: Gateway;
  id: string;
  ingest: string;
  initialKey?: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [pollError, setPollError] = useState(false);
  const [error, setError] = useState("");
  const [pub, setPub] = useState(initialKey);
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [edits, setEdits] = useState<Record<string, Partial<Label>>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api.snapshot(id);
        if (active) {
          setSnapshot(result);
          setPollError(false);
        }
      } catch {
        if (active) setPollError(true);
      } finally {
        if (active) timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, api]);
  async function issue(kind: "pub" | "srv") {
    setBusy(true);
    setError("");
    try {
      const key = await api.issue(id, kind);
      if (kind === "pub") setPub(key);
      else setServer(key);
    } catch {
      setError("키를 만들지 못했어요. 다시 시도해 주세요");
    } finally {
      setBusy(false);
    }
  }
  const identity = (l: Label) => l.method + " " + l.route;
  const labels = (snapshot?.labels ?? []).map((l) => ({
    ...l,
    ...edits[identity(l)],
  }));
  function change(l: Label, patch: Partial<Label>) {
    setSaved(false);
    setEdits((prev) => ({
      ...prev,
      [identity(l)]: { ...prev[identity(l)], ...patch },
    }));
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      for (const l of labels.filter((l) => l.id))
        await api.save(id, { ...l, name: l.name.trim() });
      setSaved(true);
    } catch {
      setError(
        "이름을 모두 저장하지 못했어요. 고친 이름은 그대로예요. 다시 확인해 주세요",
      );
    } finally {
      setBusy(false);
    }
  }
  const arrived = !!snapshot?.app.first_record_at;
  const late =
    snapshot &&
    !arrived &&
    Date.now() - Date.parse(snapshot.app.created_at) >= 1800000;
  return (
    <>
      <h1 tabIndex={-1}>연결하기</h1>
      {pollError && (
        <p role="alert">
          잠시 연결이 끊겼어요. 앱 접근 권한을 확인해 주세요. 5초 뒤 다시
          확인해요.
        </p>
      )}
      {snapshot && (
        <>
          <Hero
            title={arrived ? "기록이 도착했어요" : "첫 기록을 기다리고 있어요"}
            detail={
              arrived
                ? "기능 " + labels.length + "개를 찾았어요"
                : snapshot.app.name + "에서 보낸 기록을 5초마다 확인해요."
            }
            arrived={arrived}
          />
          {arrived && (
            <section className="panel">
              <h2>기능 이름표 확인</h2>
              <p>여기서 고른 이름을 알림에 사용해요.</p>
              {!labels.length && <p>기능 이름표를 기다리고 있어요.</p>}
              {labels.map((l, i) => (
                <fieldset key={identity(l)} disabled={busy}>
                  <label>
                    기능 이름 {i + 1}
                    <input
                      value={l.name}
                      maxLength={300}
                      onChange={(e) => change(l, { name: e.target.value })}
                    />
                  </label>
                  <details>
                    <summary>주소 자세히</summary>
                    <code>{identity(l)}</code>
                  </details>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={l.hidden}
                      onChange={(e) => change(l, { hidden: e.target.checked })}
                    />
                    이 기능 숨기기
                  </label>
                  {!l.id && (
                    <p>이 기능을 한 번 사용하면 이름을 저장할 수 있어요.</p>
                  )}
                </fieldset>
              ))}
              <button
                disabled={
                  busy ||
                  !labels.some((l) => l.id) ||
                  labels.some((l) => l.id && !l.name.trim())
                }
                onClick={confirm}
              >
                {busy ? "처리하는 중" : "모두 확인"}
              </button>
              {saved && (
                <p role="status">
                  기록이 도착한 기능의 이름을 저장했어요.{" "}
                  <Link to="/apps">내 앱 보기</Link>
                </p>
              )}
            </section>
          )}
          <div className="cols">
            <section className="panel">
              <h2>연결 요청문</h2>
              {pub ? (
                <>
                  <p>
                    요청문에는 비밀 키가 들어가지 않아요. 복사하기 전에 전체
                    내용을 확인할 수 있어요.
                  </p>
                  <Copy
                    text={buildConnectPrompt(pub, ingest)}
                    title="연결 요청 복사"
                    onCopy={() => setCopied(true)}
                  />
                  <p>코딩 AI가 바꾼 코드는 배포 전에 한 번 확인해 주세요.</p>
                </>
              ) : (
                <>
                  <p>
                    발급한 키는 이 화면을 떠나면 다시 볼 수 없어요. 새 키를
                    만들면 이전 키는 24시간 뒤에 멈춰요.
                  </p>
                  <button disabled={busy} onClick={() => issue("pub")}>
                    새 수집 키 발급
                  </button>
                </>
              )}
              <h3>서버가 있는 앱</h3>
              <p>
                서버 키는 배포 설정(환경변수 SHIPPING_SERVER_KEY)에 직접
                넣으세요. 코딩 AI 대화나 코드에 붙여넣지 마세요.
              </p>
              {server ? (
                <Copy text={server} title="서버 키 복사" secret />
              ) : (
                <>
                  <p>서버 키를 발급하면 이전 서버 키는 24시간 뒤에 멈춰요.</p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => issue("srv")}
                  >
                    서버 키 발급
                  </button>
                </>
              )}
            </section>
            <aside className="panel">
              <h2>연결 4단계</h2>
              <ol>
                <li>연결 요청 복사 {copied && "✓"}</li>
                <li>코딩 AI 대화창에 붙여넣기</li>
                <li>바뀐 코드 확인 후 배포</li>
                <li>배포한 앱 한 번 써 보기</li>
              </ol>
              {late && (
                <details open>
                  <summary>기록이 안 와요?</summary>
                  <p>
                    고친 코드를 배포했나요? 배포한 앱에서 기능을 한 번 써
                    봤나요?
                  </p>
                  <p>코딩 AI에 이 문장을 붙여넣어 보세요.</p>
                  <Copy
                    title="확인 문장 복사"
                    text="쉽앤핑 연결이 동작하는지 확인해 줘. 배포한 앱을 쓸 때 /v1/ingest 응답이 202인지 확인해 줘. 키 값은 출력하지 마."
                  />
                </details>
              )}
            </aside>
          </div>
        </>
      )}
      {!snapshot && !pollError && <p role="status">앱을 불러오는 중</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
