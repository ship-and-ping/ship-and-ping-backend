import { useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Gateway, Label, Snapshot } from "./data";
import { buildConnectPrompt, connectRestriction, keyWarning } from "./domain";
import { displayText, sanitizeRoute } from "./normalize";
import { Hero, CurrentAppName } from "./Layout";

function copyWithEvent(text: string) {
  let written = false;
  const handler = (event: ClipboardEvent) => {
    if (event.clipboardData) {
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      written = true;
    }
  };
  document.addEventListener("copy", handler);
  try {
    return document.execCommand?.("copy") && written;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", handler);
  }
}

export function Copy({
  text,
  title,
  secret = false,
  previewKey,
  onCopy,
  compact = false,
}: {
  text: string;
  title: string;
  secret?: boolean;
  previewKey?: string;
  onCopy?: () => void;
  compact?: boolean;
}) {
  const [state, setState] = useState<"ready" | "busy" | "done" | "fail" | "revealed">(
    "ready",
  );
  const area = useRef<HTMLTextAreaElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const fallbackOpen = state === "fail" || state === "revealed";
  const locked = useRef(false);
  const preview = previewKey
    ? text.replaceAll(previewKey, "••••")
    : text;
  useEffect(() => {
    if (state !== "done") return;
    const timer = setTimeout(() => {
      locked.current = false;
      setState("ready");
    }, 2600);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (state === "revealed" || (state === "fail" && !previewKey)) {
      area.current?.focus();
      area.current?.select();
    }
  }, [state, previewKey]);
  async function copy() {
    if (locked.current) return;
    locked.current = true;
    setState("busy");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      if (!copyWithEvent(text)) {
        locked.current = false;
        setState("fail");
        return;
      }
    }
    setState("done");
    onCopy?.();
  }
  return (
    <div className="sp-copy">
      <button
        ref={copyButton}
        className={secret ? "secondary" : undefined}
        data-state={state}
        aria-busy={state === "busy"}
        aria-disabled={state === "busy" || state === "done"}
        onClick={copy}
      >
        {state === "done"
          ? "복사했어요"
          : fallbackOpen
            ? "다시 복사"
            : state === "busy" ? "복사하는 중" : title}
      </button>
      <span role="status">
        {state === "done"
          ? secret
            ? "복사했어요. 배포 설정에 넣으세요."
            : "복사했어요. 코딩 AI 대화창에 붙여넣으세요."
          : fallbackOpen
            ? "자동 복사가 막혔어요. 주소창 옆 사이트 설정에서 클립보드 권한을 허용한 뒤 다시 복사해 주세요."
            : ""}
      </span>
      {fallbackOpen && previewKey && (
        <>
          <p>화면을 공유 중이라면 먼저 공유를 멈춰 주세요. 이 글에는 앱 키가 들어 있어요.</p>
          <div className="actions">
            {state === "fail" && (
              <button type="button" className="secondary" onClick={() => setState("revealed")}>키 포함해서 보기</button>
            )}
            <button type="button" className="secondary" onClick={() => {
              setState("ready");
              copyButton.current?.focus();
            }}>닫기</button>
          </div>
        </>
      )}
      {!secret && (!compact || fallbackOpen) && (
        <textarea
          aria-label={title + " 전문"}
          ref={area}
          className="preview"
          readOnly
          value={state === "revealed" ? text : preview}
          onFocus={(e) => {
            if (fallbackOpen) e.target.select();
          }}
          onClick={(e) => {
            if (fallbackOpen) e.currentTarget.select();
          }}
        />
      )}
    </div>
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
  const setAppName = useContext(CurrentAppName);
  const appName = snapshot?.app.name;
  useEffect(() => {
    if (appName !== undefined) setAppName({ id, name: appName });
  }, [appName, id, setAppName]);
  const [pollError, setPollError] = useState(false);
  const revision = useRef(0);
  const [error, setError] = useState("");
  const [pub, setPub] = useState(initialKey);
  const [server, setServer] = useState("");
  const [kind, setKind] = useState<"pub" | "srv">("pub");
  const appKey = kind === "pub" ? pub : server;
  const keyTitle = kind === "pub" ? "수집 키" : "서버 키";
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [edits, setEdits] = useState<Record<string, Label>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const started = revision.current;
        const result = await api.snapshot(id);
        if (active && started === revision.current) {
          setSnapshot({
            ...result,
            labels: result.labels.map((label) => ({ ...label, name: displayText(label.name) })),
          });
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
  const identity = (l: Pick<Label, "method" | "route">) => l.method + " " + l.route;
  const labels = snapshot?.labels ?? [];
  const groups: Record<string, Label[]> = {
    "찾은 기능": [],
    "이름 없는 기능": [],
    기타: [],
    "숨긴 기능": [],
  };
  for (const label of labels) {
    const group = label.hidden
      ? "숨긴 기능"
      : label.method === "*"
        ? "기타"
        : label.name && label.name !== "이름 없는 기능"
          ? "찾은 기능"
          : "이름 없는 기능";
    groups[group].push(label);
  }
  const selected = Object.values(edits);
  function deselect(l: Label) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[identity(l)];
      return next;
    });
  }
  function change(l: Label, patch: Partial<Label>) {
    setSaved(false);
    setEdits((prev) => ({
      ...prev,
      [identity(l)]: { ...l, ...prev[identity(l)], ...patch },
    }));
  }
  async function confirm() {
    setError("");
    const normalized = selected.map((l) => ({ ...l, name: displayText(l.name).trim() }));
    if (normalized.some((l) => !l.name || l.name === "이름 없는 기능" || [...l.name].length > 300)) {
      setError("기능 이름을 1~300자로 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const skipped = new Set((await api.save(id, normalized)).map(identity));
      const confirmed = new Map(normalized.map((l) => [identity(l), l]));
      revision.current++;
      setSnapshot(
        (current) =>
          current && {
            ...current,
            labels: current.labels
              .filter((label) => !skipped.has(identity(label)))
              .map((label) => confirmed.get(identity(label)) ?? label),
          },
      );
      setEdits({});
      setSaved(skipped.size === 0);
      if (skipped.size) setError(`기능 이름표 ${skipped.size}개는 200개를 넘어 저장하지 못했어요.`);
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
                ? "기능 " + groups["찾은 기능"].length + "개를 찾았어요"
                : displayText(snapshot.app.name) +
                  "에서 보낸 기록을 5초마다 확인해요."
            }
            arrived={arrived}
            mood={arrived ? "relieved" : "waiting"}
          />
          {(arrived || labels.length > 0) && (
            <section className="panel">
              <h2>기능 이름표 확인</h2>
              <p>
                알림에 쓸 이름을 골라 주세요. 이름을 고치거나 숨기면 확인할
                항목에 포함돼요.
              </p>
              {!labels.length && <p>기능 이름표를 기다리고 있어요.</p>}
              {Object.entries(groups).map(
                ([group, rows]) =>
                  rows.length > 0 && (
                    <div key={group}>
                      <h3>
                        {group} {rows.length}개
                      </h3>
                      {rows.map((original) => {
                        const l = edits[identity(original)] ?? original;
                        const index = labels.indexOf(original) + 1;
                        return (
                          <fieldset
                            key={identity(l)}
                            disabled={busy || l.method === "*"}
                          >
                            <label>
                              기능 이름 {index}
                              <input
                                value={l.name}
                                placeholder="이름 없는 기능"
                                maxLength={300}
                                onChange={(e) =>
                                  change(l, { name: e.target.value })
                                }
                              />
                            </label>
                            <details>
                              <summary>주소 자세히</summary>
                              <code>{displayText(l.method)} {displayText(sanitizeRoute(l.route))}</code>
                            </details>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={l.hidden}
                                onChange={(e) =>
                                  change(l, { hidden: e.target.checked })
                                }
                              />
                              이 기능 숨기기
                            </label>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={!!edits[identity(l)]}
                                disabled={!l.name.trim() && !edits[identity(l)]}
                                onChange={(e) =>
                                  e.target.checked ? change(l, {}) : deselect(l)
                                }
                              />
                              이 이름 확인
                            </label>
                          </fieldset>
                        );
                      })}
                    </div>
                  ),
              )}
              <button
                disabled={
                  busy ||
                  !selected.length ||
                  selected.some(
                    (l) => !l.name.trim() || l.name.trim() === "이름 없는 기능",
                  )
                }
                onClick={confirm}
              >
                {busy ? "처리하는 중" : "모두 확인"}
              </button>
              {saved && (
                <p role="status">
                  확인한 기능의 이름을 저장했어요.{" "}
                  <Link to="/apps">내 앱 보기</Link>
                </p>
              )}
            </section>
          )}
          <div className="cols">
            <section className="panel">
              <h2>연결 요청문</h2>
              <p>휴대폰 앱(플레이스토어·앱스토어)이라면 앱 서버에서 기록을 보내도록 <a href="#server-key"><strong>서버 있음</strong></a>을 골라 주세요. 휴대폰 앱 코드는 바꾸지 않아도 돼요.</p>
              <div id="server-key" className="actions" role="group" aria-label="기록을 보내는 곳">
                {(["pub", "srv"] as const).map(option => (
                  <button key={option} className="secondary" disabled={busy} aria-pressed={kind === option}
                    onClick={() => { setKind(option); setCopied(false); }}>
                    {option === "srv" ? "서버 있음" : "브라우저만"}
                  </button>
                ))}
              </div>
              {appKey ? (
                <div className="key-instructions" key={kind}>
                  <p className="key-notice">{keyWarning}</p>
                  <Copy text={buildConnectPrompt(appKey, ingest)} title="연결 요청문 복사(키 포함)"
                    previewKey={appKey} onCopy={() => setCopied(true)} />
                  <Copy text={appKey} title={keyTitle + " 복사"} secret />
                </div>
              ) : (
                <>
                  <p>키를 다시 받아야 해요. 새 키를 만들면 이전 키는 24시간 뒤에 멈춰요.</p>
                  <button disabled={busy} onClick={() => issue(kind)}>{keyTitle} 재발급</button>
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
                    text={`쉽앤핑 연결이 동작하는지 확인해 줘. 배포한 앱을 쓸 때 /v1/ingest 응답이 202인지 확인해 줘. 키 값은 출력하지 마.\n\n${connectRestriction}`}
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
