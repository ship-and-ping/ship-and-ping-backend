import { useContext, useEffect, useState } from "react";
import { CurrentAppName, LoadingRows } from "./Layout";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { AlertSettings, AppSummary, Gateway } from "./data";
import { displayText } from "./normalize";
import { PushChannel } from "./PushChannel";
import { useToast } from "./Toast";

const ticketKey = "ship-ping-slack-state";
type Props = { api: Gateway; origin: string };
function reason(error: unknown) {
  return error instanceof Error
    ? displayText(error.message)
    : "설정을 저장하지 못했어요. 다시 시도해 주세요.";
}
export function Notifications({ api, origin }: Props) {
  const { id } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [apps, setApps] = useState<AppSummary[]>();
  const [listFailed, setListFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api
      .apps()
      .then((list) => {
        if (active) setApps(list);
      })
      .catch(() => {
        if (active) setListFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, attempt]);
  useEffect(() => {
    if (!hash || id) return;
    const args = new URLSearchParams(hash.slice(1));
    const state = args.get("slack_state");
    const stored = sessionStorage.getItem(ticketKey);
    sessionStorage.removeItem(ticketKey);
    navigate("/apps/notifications", { replace: true });
    if (!stored || stored !== state) {
      setMessage("연결 요청을 확인할 수 없어요. 다시 시작해 주세요.");
      return;
    }
    api
      .slack("callback", origin, {
        state,
        code: args.get("slack_code") ?? "",
        ...(args.has("slack_error") ? { error: args.get("slack_error")! } : {}),
      })
      .then((result) => {
        if (result.app)
          navigate("/apps/" + result.app + "/notifications", { replace: true });
      })
      .catch((error) => setMessage(reason(error)));
  }, [api, origin, hash, id, navigate]);
  const app = id ?? apps?.[0]?.id;
  const selected = apps?.find((item) => item.id === app);
  const setHeading = useContext(CurrentAppName);
  useEffect(() => {
    if (selected) setHeading(selected);
  }, [selected, setHeading]);
  return (
    <>
      <h1 tabIndex={-1}>알림 설정</h1>
      {message && <p role="alert">{message}</p>}
      {!apps ? (
        listFailed ? <div className="load-state" role="alert">
          앱 목록을 불러오지 못했어요.{" "}
          <button onClick={() => {
            setListFailed(false);
            setAttempt(n => n + 1);
          }}>앱 목록 다시 불러오기</button>
        </div> : <LoadingRows>알림을 설정할 앱을 불러오는 중이에요.</LoadingRows>
      ) : !apps.length ? (
        <p>알림을 받을 앱이 아직 없어요. <Link to="/apps/new">앱 등록하기</Link></p>
      ) : (
        <>
          <label>
            앱 고르기
            <select
              value={app}
              onChange={(e) => {
                setMessage("");
                navigate("/apps/" + e.target.value + "/notifications");
              }}
            >
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {displayText(a.name)}
                </option>
              ))}
            </select>
          </label>
          {app && apps.some((a) => a.id === app) && (
            <Settings key={id ?? "default"} app={app} api={api} origin={origin} />
          )}
        </>
      )}
    </>
  );
}
type NotificationAction = "connect" | "disconnect" | "test" | "email";
function Settings({ app, api, origin }: Props & { app: string }) {
  const showToast = useToast();
  const [settings, setSettings] = useState<AlertSettings>();
  const [pending, setPending] = useState<NotificationAction | null>(null);
  const busy = pending !== null;
  const [message, setMessage] = useState("");
  const [feedbackArea, setFeedbackArea] = useState<"slack" | "email">("slack");
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  function reload() {
    setLoadState("loading");
    setAttempt(n => n + 1);
  }
  useEffect(() => {
    let active = true;
    api
      .settings(app)
      .then((value) => {
        if (active) {
          setSettings(value);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (active) setLoadState("failed");
      });
    return () => {
      active = false;
    };
  }, [api, app, attempt]);
  async function act(action: NotificationAction, fn: () => Promise<void>) {
    setPending(action);
    setFeedbackArea(action === "email" ? "email" : "slack");
    setMessage("");
    try {
      await fn();
      reload();
    } catch (error) {
      setMessage(reason(error));
    } finally {
      setPending(null);
    }
  }
  async function saveEmail(enabled: boolean) {
    await api.emailSetting(app, enabled);
    setSettings(current => current && { ...current, email: enabled });
    showToast({ kind: "success", title: enabled ? "이메일 알림이 켜졌어요." : "이메일 알림이 꺼졌어요." });
  }
  async function disconnect() {
    await api.disconnectSlack(app);
    setSettings(current => current && { ...current, connected: false, broken: false, channel: null });
  }
  async function testSlack() {
    if (await api.testSlack(app)) {
      showToast({ kind: "success", title: "시험 슬랙 알림을 예약했어요", detail: "잠시 뒤 슬랙에서 확인해 주세요." });
    } else setMessage("잠시 뒤 다시 시도해 주세요. 시험 알림은 분당 한 번 보낼 수 있어요.");
  }
  async function connect() {
    const result = await api.slack("install", origin, { app });
    if (
      !result.url ||
      !result.state ||
      new URL(result.url).origin !== "https://slack.com"
    )
      throw new Error("슬랙 설정 필요");
    sessionStorage.setItem(ticketKey, result.state);
    location.assign(result.url);
  }
  return (
    <>
      {settings ? (
        <>
          {!settings.email && !settings.connected && !settings.broken && !(settings.push && settings.subscribed) && (
            <p className="notification-warning" role="alert">
              <span aria-hidden="true">⚠</span><span><strong>알림을 받을 곳이 없어요.</strong> 문제가 생겨도 이 화면을 열기 전에는 알 수 없어요. 슬랙을 연결하거나 이메일 알림을 켜세요.</span>
            </p>
          )}
          <div className="dashboard-channels">
            <PushChannel api={api} app={app} settings={settings} reload={reload} />
            <section className="panel">
              <header><h2>이메일</h2><small>로그인 메일</small></header>
              <button
                role="switch"
                className="notification-switch"
                aria-label="이메일로도 받기"
                aria-checked={settings.email}
                disabled={busy}
                onClick={() =>
                  act("email", () => saveEmail(!settings.email))
                }
              >
                이메일로도 받기 · {settings.email ? "켜짐" : "꺼짐"}
                <span aria-hidden="true" />
              </button>
              <p>
                {settings.broken
                  ? "슬랙이 끊긴 동안은 꺼 두어도 이메일로 보내요."
                  : "로그인한 이메일로 보내요."}
              </p>
              {feedbackArea === "email" && <p role="status">{pending === "email" ? "이메일 알림 설정을 저장하는 중이에요." : message}</p>}
            </section>
            <section className="panel">
              <header><h2>슬랙</h2><small>팀용 · 선택</small></header>
              {settings.connected ? (
                <>
                  <span className="badge ok">✓ 연결됐어요</span>
                  <p>{displayText(settings.channel ?? "")} 채널로 보내요.</p>
                  <p>문제가 생길 때 한 번, 해결될 때 한 번 보내요.</p>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() => act("test", testSlack)}
                    >
                      {pending === "test" ? "시험 알림 요청 중" : "시험 알림 보내기"}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => act("disconnect", disconnect)}
                    >
                      {pending === "disconnect" ? "연결 끊는 중" : "슬랙 연결 끊기"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {settings.broken ? (
                    <>
                      <strong className="badge bad" role="alert"><span aria-hidden="true">⚠ </span>연결이 끊겼어요</strong>
                      <p>
                        {displayText(settings.channel ?? "")} 채널에 다시 연결할
                        때까지 로그인 이메일로 보내요.
                      </p>
                    </>
                  ) : (
                    <p>
                      슬랙에서 알림 받을 채널을 고르고 허용을 누르면 여기로
                      돌아와요.
                    </p>
                  )}
                  <button disabled={busy} onClick={() => act("connect", connect)}>
                    {pending === "connect" ? "슬랙 연결 요청 중" : settings.broken ? "슬랙 다시 연결" : "Slack에 추가"}
                  </button>
                </>
              )}
              {feedbackArea === "slack" && message && <p role="status">{message}</p>}
            </section>
          </div>
          {loadState === "loading" && <p role="status">최신 상태를 불러오는 중이에요.</p>}
          <details>
            <summary>슬랙 연결이 안 될 때</summary>
            <p>
              무료 슬랙은 앱을 10개까지 추가할 수 있어요. 앱 하나를 지우거나
              이메일 알림을 켜세요. 회사 슬랙에서 앱 추가를 막았다면 관리자에게
              요청해 주세요.
            </p>
          </details>
        </>
      ) : loadState === "loading" ? (
        <p role="status">알림 설정을 불러오는 중</p>
      ) : null}
      {loadState === "failed" && (
        <div className="load-state" role="alert">
          {settings ? "최신 상태를 불러오지 못했어요." : "설정을 불러오지 못했어요."}{" "}
          <button onClick={reload}>다시 불러오기</button>
        </div>
      )}
    </>
  );
}
