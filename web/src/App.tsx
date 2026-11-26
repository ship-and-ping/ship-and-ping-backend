import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import type { AppSummary, Gateway } from "./data";
import { validateApp } from "./domain";
import { displayText } from "./normalize";
import { Hero, Landing, Shell } from "./Layout";
import { AuthPage } from "./AuthPage";
import { MonitorRoute } from "./Monitor";
import { DeepPage } from "./DeepPage";
import { Notifications } from "./Notifications";
import { Connect } from "./Connect";
import { Account } from "./Account";
import { AppSettings } from "./AppSettings";

function useApps(api: Gateway) {
  const [apps, setApps] = useState<AppSummary[]>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    api
      .apps()
      .then((rows) => {
        if (active) setApps(rows);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [api, attempt]);
  return { apps, error, retry: () => setAttempt((n) => n + 1) };
}

function LoadError({ retry }: { retry: () => void }) {
  return (
    <div role="alert">
      앱 목록을 불러오지 못했어요.{" "}
      <button onClick={retry}>다시 불러오기</button>
    </div>
  );
}
function AfterLogin({ api }: { api: Gateway }) {
  const [target, setTarget] = useState("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function resolve() {
      const apps = await api.apps();
      if (!active) return;
      const first = await api.firstVisit();
      if (active) setTarget(first && !apps.length ? "/apps/new" : "/apps");
    }
    setError(false);
    resolve().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
    };
  }, [api, attempt]);
  if (error) return <LoadError retry={() => setAttempt((n) => n + 1)} />;
  return target ? (
    <Navigate replace to={target} />
  ) : (
    <p role="status">내 앱을 확인하는 중</p>
  );
}
function relative(date: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 60000),
  );
  if (minutes < 1) return "방금";
  if (minutes < 60) return minutes + "분 전";
  if (minutes < 1440) return Math.floor(minutes / 60) + "시간 전";
  return new Date(date).toLocaleDateString("ko-KR");
}
function Apps({ api }: { api: Gateway }) {
  const { apps, error, retry } = useApps(api);
  return (
    <>
      <h1 tabIndex={-1}>내 앱</h1>
      {error ? (
        <LoadError retry={retry} />
      ) : apps ? (
        <>
          <Hero
            mood={apps.length ? "relieved" : "waiting"}
            title={
              apps.length
                ? "등록한 앱을 지켜보고 있어요"
                : "아직 등록한 앱이 없어요"
            }
            detail={
              apps.length
                ? "등록한 앱 " + apps.length + "개 / 3개"
                : "앱을 등록하면 연결 요청문을 드려요."
            }
          />
          <div className="actions">
            {apps.length < 3 ? (
              <Link className="button" to="/apps/new">
                앱 등록하기
              </Link>
            ) : (
              <button disabled>앱 등록하기</button>
            )}
            <small>무료 베타는 회원당 앱 3개까지예요.</small>
          </div>
          <div className="grid">
            {apps.map((app) => (
              <Link
                className="panel app-card"
                key={app.id}
                to={"/apps/" + app.id + (app.first_record_at ? "" : "/connect")}
              >
                <span
                  className={
                    "badge " +
                    (app.issues ? "bad" : app.first_record_at ? "ok" : "wait")
                  }
                >
                  {app.issues
                    ? "⚠ 문제 있어요"
                    : app.first_record_at
                      ? "⊙ 괜찮아요"
                      : "◷ 기록을 기다려요"}
                </span>
                <h2>{displayText(app.name)}</h2>
                <p>열린 문제 {app.issues}개</p>
                <small>
                  마지막 기록 {app.last ? relative(app.last) : "없음"}
                </small>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p role="status">앱 목록을 불러오는 중</p>
      )}
    </>
  );
}
function Register({
  api,
  enter,
}: {
  api: Gateway;
  enter: (id: string, key?: string) => void;
}) {
  const { apps, error: loadError, retry } = useApps(api);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<ReturnType<typeof validateApp>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const issues = validateApp(name, url);
    setErrors(issues);
    if (Object.keys(issues).length) {
      document.getElementById(issues.name ? "app-name" : "app-url")?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      if ((await api.apps()).length >= 3) {
        setError(
          "무료 베타는 앱 3개까지예요. 내 앱에서 기존 앱을 확인해 주세요.",
        );
        return;
      }
      const id = await api.create(name.trim(), url.trim());
      let key: string | undefined;
      try {
        key = await api.issue(id, "pub");
      } catch {
        /* 등록된 앱에서 키 발급을 다시 시도한다. */
      }
      enter(id, key);
    } catch (cause) {
      const message =
        cause && typeof cause === "object" && "message" in cause ? cause.message : "";
      if (message === "beta capacity reached")
        setError("베타 정원이 찼어요");
      else if (message === "app limit reached")
        retry();
      else
        setError(
          "앱 등록 결과를 확인하지 못했어요. 내 앱 목록을 먼저 확인해 주세요.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="narrow">
      <h1 tabIndex={-1}>앱 등록</h1>
      <p>지켜볼 앱의 이름을 알려 주세요.</p>
      {loadError ? (
        <LoadError retry={retry} />
      ) : !apps ? (
        <p role="status">등록 한도를 확인하는 중</p>
      ) : apps.length >= 3 ? (
        <p>
          무료 베타는 앱 3개까지예요. <Link to="/apps">내 앱 보기</Link>
        </p>
      ) : (
        <form className="panel" noValidate onSubmit={submit}>
          <label htmlFor="app-name">앱 이름 (필수)</label>
          <input
            id="app-name"
            required
            value={name}
            aria-invalid={!!errors.name}
            aria-describedby="name-help"
            onChange={(e) => setName(e.target.value)}
          />
          <small id="name-help">{errors.name ?? "1~40자로 적어 주세요."}</small>
          <label htmlFor="app-url">앱 주소 (선택)</label>
          <input
            id="app-url"
            type="url"
            placeholder="https://"
            value={url}
            aria-invalid={!!errors.url}
            aria-describedby="url-help"
            onChange={(e) => setUrl(e.target.value)}
          />
          <small id="url-help">
            {errors.url ?? "앱 주소는 나중에 적어도 돼요."}
          </small>
          <button disabled={busy}>{busy ? "등록하는 중" : "등록"}</button>
          {error && (
            <p role="alert">
              {error} <Link to="/apps">내 앱 보기</Link>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
function Connection({
  api,
  ingest,
  takeKey,
}: {
  api: Gateway;
  ingest: string;
  takeKey: (id: string) => string | undefined;
}) {
  const { id = "" } = useParams();
  return (
    <Connect
      key={id}
      id={id}
      api={api}
      ingest={ingest}
      initialKey={takeKey(id)}
    />
  );
}
export function App({ api, ingest }: { api: Gateway; ingest: string }) {
  const [user, setUser] = useState<string | null>();
  const [recoveryUser, setRecoveryUser] = useState<string | null>(null);
  const deleting = useRef(false);
  const [notice,setNotice] = useState("");
  const [error, setError] = useState(false);
  const issued = useRef<{ id: string; owner: string; key?: string } | null>(
    null,
  );
  const { pathname } = useLocation();
  const prev = useRef(pathname);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true,
      notified = false;
    const unsubscribe = api.listen((id, recovery) => {
      setRecoveryUser(previous => recovery ? id : previous === id ? previous : null);
      notified = true;
      if (active) {
        if (id || !deleting.current) setUser(id);
        if (id) setNotice("");
        setError(false);
      }
    });
    api
      .session()
      .then((id) => {
        if (active && !notified) setUser(id);
      })
      .catch(() => {
        if (active && !notified) setError(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);
  const markPending = useCallback((active: boolean) => { deleting.current = active; }, []);
  async function logout() {
    await api.logout();
    deleting.current = false;
    issued.current = null;
    setUser(null);
    setNotice("로그아웃했어요");
    navigate("/login",{replace:true});
  }
  const finishWithdrawal = useCallback((uncertain = false) => {
    deleting.current=false; issued.current=null;
    setNotice(uncertain ? "탈퇴가 이미 끝났을 수 있어요. 다시 로그인해 확인해 주세요." : "탈퇴를 마쳤어요"); setUser(null);
    void api.logout().catch(()=>{});
    navigate("/login",{replace:true});
  },[api,navigate]);
  useEffect(() => {
    if (
      issued.current &&
      pathname !== "/apps/" + issued.current.id + "/connect"
    )
      issued.current = null;
    if (prev.current !== pathname) {
      if (prev.current === "/reset-password") setRecoveryUser(null);
      if (prev.current === "/login") setNotice("");
      document.querySelector<HTMLElement>("main h1")?.focus();
      prev.current = pathname;
    }
  }, [pathname]);
  if (error)
    return (
      <main>
        <h1>로그인 상태를 확인하지 못했어요</h1>
        <button onClick={() => location.reload()}>다시 불러오기</button>
      </main>
    );
  if (user === undefined)
    return <main role="status">로그인 상태를 확인하는 중</main>;
  return (
    <Routes>
      <Route path="/signup" element={user ? <AfterLogin api={api}/> : <AuthPage api={api} mode="signup"/>}/>
      <Route path="/forgot-password" element={<AuthPage api={api} mode="forgot"/>}/>
      <Route path="/reset-password" element={<AuthPage api={api} mode="reset" recovery={!!user && recoveryUser === user}/>}/>
      <Route path="/account" element={user ? <Shell key={user} onLogout={logout}>
        <Account api={api} origin={ingest} pending={markPending} logout={logout} done={finishWithdrawal}/>
      </Shell> : <Navigate to="/login" replace/>}/>
      <Route
        path="/"
        element={user ? <Navigate replace to="/apps" /> : <Landing />}
      />
      <Route
        path="/login"
        element={user ? <AfterLogin api={api} /> : <>
          {notice && <p className="panel" role="status">
            <strong>{notice}</strong>{notice === "로그아웃했어요" && " 이 기기에서 로그아웃했어요. 문제가 생기면 알림은 계속 보내 드려요."}
          </p>}
          <AuthPage api={api} mode="login" />
        </>}
      />
      <Route
        path="/apps/*"
        element={
          user ? (
            <Shell
              key={user}
              onLogout={logout}
            >
              <Routes>
                <Route index element={<Apps api={api} />} />
                <Route path=":id/settings" element={<AppSettings api={api}/>}/>
                <Route path="notifications" element={<Notifications api={api} origin={ingest} />} />
                <Route path=":id/notifications" element={<Notifications api={api} origin={ingest} />} />
                <Route
                  path="new"
                  element={
                    <Register
                      api={api}
                      enter={(id, key) => {
                        issued.current = { id, owner: user, key };
                        navigate("/apps/" + id + "/connect", { replace: true });
                      }}
                    />
                  }
                />
                <Route
                  path=":id/connect"
                  element={
                    <Connection
                      api={api}
                      ingest={ingest}
                      takeKey={(id) =>
                        issued.current?.owner === user &&
                        issued.current.id === id
                          ? issued.current.key
                          : undefined
                      }
                    />
                  }
                />
                <Route path=":id" element={<MonitorRoute api={api} />} />
                <Route path=":id/features/deep/:tracking" element={<DeepPage api={api} ingest={ingest} />} />
                <Route
                  path=":id/features/:feature"
                  element={<MonitorRoute api={api} />}
                />
                <Route
                  path=":id/issues/:issue"
                  element={<MonitorRoute api={api} />}
                />
                <Route path="*" element={<Navigate to="/apps" replace />} />
              </Routes>
            </Shell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
