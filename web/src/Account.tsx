import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AuthForm } from "./AuthPage";
import type { Gateway } from "./data";
import { displayText } from "./normalize";

async function loadAccount(api: Gateway) {
  const [member, apps] = await Promise.all([api.account(), api.apps()]);
  const channels = await Promise.all(
    apps.map(async (app) => ({ ...app, settings: await api.settings(app.id) })),
  );
  return { ...member, apps: channels };
}
type Stage =
  | "account"
  | "confirm"
  | "deleting"
  | "checking"
  | "failed"
  | "limited"
  | "offline";

export function Account({
  api,
  origin,
  logout,
  done,
  pending,
}: {
  api: Gateway;
  origin: string;
  logout: () => Promise<void>;
  done: (result?: "unauthorized" | "login_required") => void;
  pending: (active: boolean) => void;
}) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof loadAccount>>>();
  const [stage, setStage] = useState<Stage>("account");
  const [input, setInput] = useState("");
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const passwordButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [attempt, retry] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stage === "confirm" || stage === "account") title.current?.focus();
    if (stage === "failed" || stage === "limited" || stage === "offline") retryButton.current?.focus();
    if (stage === "checking" || stage === "deleting") progress.current?.focus();
  }, [stage]);
  useEffect(() => {
    if (stage === "failed" || stage === "limited" || stage === "offline") pending(false);
  }, [stage, pending]);
  useEffect(() => () => pending(false), [pending]);
  useEffect(() => {
    let active = true;
    loadAccount(api)
      .then((data) => {
        if (active) setInfo(data);
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [api, attempt]);
  useEffect(() => {
    if (stage !== "checking") return;
    let active = true;
    let running = false;
    const deadline = Date.now() + 120000;
    const timer = window.setInterval(async () => {
      if (running) {
        if (Date.now() >= deadline) setStage("offline");
        return;
      }
      running = true;
      let result: Awaited<ReturnType<Gateway["checkAccount"]>> = "unknown";
      try {
        result = await api.checkAccount();
      } catch {
        /* an unreachable Auth service leaves the result unknown */
      }
      running = false;
      if (!active) return;
      if (result === "deleted") done();
      else if (Date.now() >= deadline)
        setStage(result === "exists" ? "failed" : "offline");
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [stage, api, done]);
  async function remove() {
    if (!info?.email || input !== info.email) return;
    pending(true);
    setStage("deleting");
    try {
      const result = await api.withdraw(origin);
      if (result === "done") done();
      else if (result === "unauthorized" || result === "login_required") done(result);
      else if (result === "limited") setStage("limited");
      else setStage(result === "unknown" ? "checking" : "failed");
    } catch {
      setStage("checking");
    }
  }
  const loadError = error && <p role="alert">
    계정 정보를 불러오지 못했어요.{" "}
    <button onClick={() => { setError(false); retry(n => n + 1); }}>다시 불러오기</button>
  </p>;
  if (!info)
    return (
      <div>
        <h1 tabIndex={-1}>내 계정</h1>
        {loadError || (
          <p role="status" aria-busy="true">내 계정을 불러오는 중</p>
        )}
      </div>
    );
  const email = displayText(info.email, "login-email");
  const count = info.apps.length;
  const action = count ? "모든 앱과 기록을 지우고 탈퇴" : "계정을 지우고 탈퇴";
  return (
    <div className="sp-body narrow">
      <h1 ref={title} tabIndex={-1}>{stage === "account" ? "내 계정" : "회원 탈퇴"}</h1>
      {stage === "account" ? (
        <>
          <section className="panel">
            <h2>계정 정보</h2>
            <dl className="sp-kv">
              <dt>로그인 이메일</dt>
              <dd>{email}</dd>
              <dt>가입일</dt>
              <dd>{new Date(info.joined).toLocaleDateString("ko-KR")}</dd>
              <dt>로그인 방법</dt>
              <dd>{info.method.split(", ").map(method => displayText(method)).join(", ")}</dd>
              <dt>등록한 앱</dt>
              <dd>{count}개 / 3개</dd>
            </dl>
            <Link to="/apps">내 앱 목록 보기</Link>{" "}
            {!count && <Link to="/apps/new">앱 등록하기</Link>}
          </section>
          <section className="panel">
            <h2>비밀번호</h2>
            <button ref={passwordButton} className="secondary" aria-expanded={editingPassword} onClick={() => {
              setPasswordSaved(false);
              setEditingPassword(!editingPassword);
            }}>{editingPassword ? "닫기" : info.hasPassword ? "비밀번호 바꾸기" : "비밀번호 만들기"}</button>
            {editingPassword && <AuthForm api={api} mode="account" saved={() => {
              setEditingPassword(false);
              setInfo({ ...info, hasPassword: true });
              setPasswordSaved(true);
              passwordButton.current?.focus();
              retry(n => n + 1);
            }}/>}
            {passwordSaved && <p role="status">비밀번호를 저장했어요.</p>}
            {loadError}
          </section>
          <section className="panel">
            <h2>알림 받을 곳</h2>
            {info.apps.map(({ id, name, settings }) => (
              <p key={id}>
                <Link to={"/apps/" + id + "/notifications"}>
                  {displayText(name)}
                </Link>
                <br />
                {settings.push && settings.subscribed && <>앱 푸시 켜짐<br /></>}
                {settings.connected
                  ? "슬랙 " + displayText(settings.channel ?? "")
                  : settings.broken
                    ? "슬랙 연결 끊김"
                    : "슬랙 미연결"}
                <br />
                {settings.email || settings.broken
                  ? "이메일 켜짐"
                  : "이메일 꺼짐"}
                {!(settings.push && settings.subscribed) && !settings.connected &&
                  !settings.email &&
                  !settings.broken &&
                  <small> 받을 곳을 설정해 주세요.</small>}
              </p>
            ))}
            {!count && <p>등록한 앱이 없어요.</p>}
          </section>
          <div className="actions">
            <button
              className="secondary"
              onClick={() => logout().catch(() => setLogoutError(true))}
            >
              로그아웃
            </button>
            <button
              className="secondary danger"
              onClick={() => setStage("confirm")}
            >
              회원 탈퇴
            </button>
          </div>
          {logoutError && (
            <p role="alert">로그아웃하지 못했어요. 다시 시도해 주세요.</p>
          )}
        </>
      ) : (
        <section className="panel">
          <h2>탈퇴하면 이렇게 돼요</h2>
          <ul>
            {count ? (
              <>
                <li>
                  앱 {count}개를 지워요. 앱의 기록과 문제, 알림 설정도 모두 지워요.
                </li>
                <li>탈퇴 후 최대 5분 안에 기록 받기가 멈춰요.</li>
                <li>슬랙과 이메일 알림이 더 오지 않아요.</li>
              </>
            ) : (
              <li>등록한 앱이 없어 로그인 계정만 지워요.</li>
            )}
            <li>
              되돌릴 수 없어요. 같은 이메일로 다시 가입하면 처음부터 시작해요.
            </li>
          </ul>
          <p>“{email}”을 똑같이 적어 주세요.</p>
          <label>
            로그인 이메일 다시 입력
            <input
              autoComplete="off"
              value={input}
              disabled={stage !== "confirm"}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          {stage === "confirm" && (
            <div className="actions">
              <button
                className="danger"
                disabled={!email || input !== email}
                aria-disabled={!email || input !== email}
                onClick={remove}
              >
                {action}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setStage("account");
                  setInput("");
                }}
              >
                탈퇴하지 않고 돌아가기
              </button>
            </div>
          )}
          {stage === "deleting" && (
            <div role="status" ref={progress} tabIndex={-1}>
              <button disabled aria-busy="true">
                탈퇴하는 중
              </button>
            </div>
          )}
          {stage === "checking" && (
            <div role="status" ref={progress} tabIndex={-1}>
              탈퇴 결과를 확인하는 중이에요. 최대 2분 동안 10초마다 다시 확인해요.
            </div>
          )}
          {(stage === "failed" || stage === "limited") && (
            <>
              <p role="alert">
                {stage === "limited" ? "잠시 뒤 다시 시도해 주세요." : "탈퇴를 마치지 못했어요. 계정은 아직 남아 있고 로그인도 돼요."}
              </p>
              <button ref={retryButton} onClick={remove}>다시 시도</button>
            </>
          )}
          {stage === "offline" && (
            <>
              <p role="alert">
                결과를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.
              </p>
              <button ref={retryButton} onClick={remove}>다시 시도</button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
