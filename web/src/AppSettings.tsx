import { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CurrentAppName } from "./Layout";
import { Copy } from "./Connect";
import { displayText, sanitizeRoute } from "./normalize";
import { validateApp } from "./domain";
import type { Gateway, KeySummary, Label, Snapshot } from "./data";

export function AppSettings({ api }: { api: Gateway }) {
  const { id = "" } = useParams();
  return <Settings key={id} id={id} api={api} />;
}

function Settings({ api, id }: { api: Gateway; id: string }) {
  const navigate = useNavigate();
  const setHeading = useContext(CurrentAppName);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [keys, setKeys] = useState<KeySummary[]>([]);
  const [attempt, reload] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [issued, setIssued] = useState<Partial<Record<KeySummary["kind"], {
    raw: string;
    copied: boolean;
  }>>>({});
  useEffect(() => {
    let active = true;
    Promise.all([api.snapshot(id), api.appKeys(id)])
      .then(([next, rows]) => {
        if (!active) return;
        setSnapshot(next);
        setHeading(next.app);
        setName(displayText(next.app.name));
        setUrl(displayText(next.app.url ?? ""));
        setKeys(rows);
      })
      .catch(() => {
        if (active) setError("앱 설정을 불러오지 못했어요.");
      });
    return () => {
      active = false;
    };
  }, [api, id, attempt, setHeading]);
  useEffect(() => {
    if (!Object.values(issued).some(key => !key.copied)) return;
    function unload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function leave(event: MouseEvent) {
      const link = (event.target as Element).closest("a[href]");
      if (
        link &&
        !window.confirm("키를 아직 복사하지 않았어요. 화면을 떠날까요?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", leave, true);
    };
  }, [issued]);
  async function change(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await work();
    } catch {
      setError("변경을 마치지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  const visible = displayText(snapshot?.app.name ?? "");
  return (
    <div className="sp-body narrow">
      <h1 tabIndex={-1}>앱 설정</h1>
      {error && (
        <p role="alert">
          {error}{" "}
          {!snapshot && (
            <button
              onClick={() => {
                setError("");
                reload(attempt + 1);
              }}
            >
              다시 불러오기
            </button>
          )}
        </p>
      )}
      <p role="status">
        {status || (!snapshot && !error ? "앱 설정을 불러오는 중" : "")}
      </p>
      {snapshot && (
        <fieldset className="settings-sections" disabled={busy}>
          <section className="panel">
            <h2>앱 정보</h2>
            <label>
              앱 이름
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              앱 주소
              <input value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <button
              onClick={() =>
                change(async () => {
                  const nextName =
                    name === visible ? snapshot.app.name : name.trim();
                  const nextUrl =
                    url === displayText(snapshot.app.url ?? "")
                      ? (snapshot.app.url ?? "")
                      : url.trim();
                  const invalid = validateApp(nextName, nextUrl);
                  if (invalid.name || invalid.url) {
                    setError(invalid.name || invalid.url || "");
                    return;
                  }
                  await api.editApp(id, nextName, nextUrl);
                  const app = { ...snapshot.app, name: nextName, url: nextUrl };
                  setSnapshot({ ...snapshot, app });
                  setHeading(app);
                  setName(displayText(nextName));
                  setUrl(displayText(nextUrl));
                  setConfirmation("");
                  setStatus("앱 정보를 저장했어요.");
                })
              }
            >
              앱 정보 저장
            </button>
          </section>
          <section className="panel">
            <h2>기능 이름표</h2>
            <p>주소 형태가 200개를 넘으면 새 주소를 ‘기타’로 모아요.</p>
            {!snapshot.labels.some((l) => l.hidden) && (
              <p>숨긴 기능이 없어요.</p>
            )}
            {snapshot.labels
              .filter((l) => l.method !== "*")
              .map((l) => (
                <LabelEditor
                  key={l.method + " " + l.route}
                  label={l}
                  save={(name, hidden) =>
                    change(async () => {
                      const updated = { ...l, name, hidden };
                      const skipped = await api.save(id, [updated]);
                      if (skipped.length) {
                        setError("주소 형태가 200개를 넘어 기타로 모았어요.");
                        return;
                      }
                      setSnapshot({
                        ...snapshot,
                        labels: snapshot.labels.map((row) =>
                          row === l ? updated : row,
                        ),
                      });
                      setStatus("기능 이름표를 저장했어요.");
                    })
                  }
                />
              ))}
          </section>
          {(["pub", "srv"] as const).map((kind) => {
            const title = kind === "srv" ? "서버 키" : "수집 키";
            return (
              <section className="panel" key={kind}>
                <h2>{title}</h2>
                <p>
                  새 키를 만들면 이전 키는 24시간 뒤에 멈춰요. 그 안에 새 키로
                  배포하세요.
                </p>
                <p>폐기하면 최대 5분 안에 이 키로 기록 받기가 멈춰요.</p>
                {keys
                  .filter((k) => k.kind === kind)
                  .map((k) => (
                    <div className="actions" key={k.id}>
                      <code>{displayText(k.prefix, "key-prefix")}····</code>
                      {k.expires_at && (
                        <small>
                          교체 중 ·{" "}
                          {new Date(k.expires_at).toLocaleString("ko-KR")}까지
                        </small>
                      )}
                      <button
                        className="secondary"
                        onClick={() => {
                          if (
                            window.confirm(
                              "폐기하면 최대 5분 안에 이 키로 기록 받기가 멈춰요. 폐기할까요?",
                            )
                          )
                            void change(async () => {
                              await api.revokeKey(id, k.id);
                              setKeys(keys.filter((row) => row.id !== k.id));
                              if (!k.expires_at) setIssued(current => {
                                const next = {...current};
                                delete next[k.kind];
                                return next;
                              });
                              setStatus("키를 폐기했어요.");
                            });
                        }}
                      >
                        폐기
                      </button>
                    </div>
                  ))}
                <button
                  className="secondary"
                  onClick={() => {
                    if (
                      window.confirm(
                        "새 키를 만들면 이전 키는 24시간 뒤에 멈춰요. 재발급할까요?",
                      )
                    )
                      void change(async () => {
                        const raw = await api.issue(id, kind);
                        setIssued(current => ({...current,[kind]:{raw,copied:false}}));
                        setKeys(await api.appKeys(id));
                      });
                  }}
                >
                  {title} 재발급
                </button>
                {kind === "srv" && (
                  <p>
                    배포 설정의 환경변수 SHIPPING_SERVER_KEY에 직접 넣으세요.
                    코딩 AI 대화나 코드에 붙여넣지 마세요.
                  </p>
                )}
                {issued[kind] && (
                  <div>
                    <p>
                      새 키를 만들었어요. 이 화면을 떠나면 다시 볼 수 없어요.
                    </p>
                    <Copy key={issued[kind].raw} text={issued[kind].raw} title={title+" 복사"} secret
                      onCopy={()=>setIssued(current=> current[kind]===issued[kind]
                        ? {...current,[kind]:{...issued[kind],copied:true}} : current)}/>
                  </div>
                )}
              </section>
            );
          })}
          <section className="panel">
            <h2>앱 삭제</h2>
            <p>모든 기록이 바로 지워지고 되돌릴 수 없어요.</p>
            <p>
              “{visible}”를 똑같이 적어 주세요.{" "}
              {visible.includes("[가림]")
                ? "이름 일부가 [가림]으로 가려져 있어요. 화면에 보이는 그대로([가림] 포함) 입력해 주세요."
                : "화면에 보이는 그대로 입력해 주세요."}
            </p>
            <label>
              앱 이름 다시 입력
              <input
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <button
              className="secondary danger"
              disabled={!confirmation || confirmation !== visible}
              onClick={() =>
                change(async () => {
                  await api.removeApp(id);
                  navigate("/apps", { replace: true });
                })
              }
            >
              앱 삭제
            </button>
          </section>
        </fieldset>
      )}
    </div>
  );
}

function LabelEditor({
  label,
  save,
}: {
  label: Label;
  save: (name: string, hidden: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(displayText(label.name));
  return (
    <div>
      <label>
        {displayText(label.method)} {displayText(sanitizeRoute(label.route))}{" "}
        기능 이름
        <input
          value={name}
          maxLength={300}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="actions">
        <button
          className="secondary"
          disabled={!name.trim()}
          onClick={() => save(displayText(name).trim(), label.hidden)}
        >
          이름 저장
        </button>
        <button
          className="secondary"
          disabled={!name.trim()}
          onClick={() => save(displayText(name).trim(), !label.hidden)}
        >
          {label.hidden ? "숨긴 기능 되살리기" : "기능 숨기기"}
        </button>
      </div>
    </div>
  );
}
