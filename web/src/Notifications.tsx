import { useContext, useEffect, useState } from "react";
import { CurrentAppName } from "./Layout";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { AlertSettings, AppSummary, Gateway } from "./data";
import { displayText } from "./normalize";

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
        if (active) setMessage("앱 목록을 불러오지 못했어요.");
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
        <button onClick={() => setAttempt((n) => n + 1)}>
          앱 목록 다시 불러오기
        </button>
      ) : !apps.length ? (
        <Link to="/apps/new">앱 등록하기</Link>
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
function Settings({ app, api, origin }: Props & { app: string }) {
  const [settings, setSettings] = useState<AlertSettings>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api
      .settings(app)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {
        if (active) setMessage("설정을 불러오지 못했어요.");
      });
    return () => {
      active = false;
    };
  }, [api, app, attempt]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setSettings(await api.settings(app));
    } catch (error) {
      setMessage(reason(error));
    } finally {
      setBusy(false);
    }
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
          {!settings.email && !settings.connected && !settings.broken && (
            <p className="notification-warning" role="alert">
              <span aria-hidden="true">⚠</span><span><strong>알림을 받을 곳이 없어요.</strong> 문제가 생겨도 이 화면을 열기 전에는 알 수 없어요. 슬랙을 연결하거나 이메일 알림을 켜세요.</span>
            </p>
          )}
          <div className="even">
            <section className="panel">
              <h2>슬랙</h2>
              {settings.connected ? (
                <>
                  <span className="badge ok">✓ 연결됐어요</span>
                  <p>{displayText(settings.channel ?? "")} 채널로 보내요.</p>
                  <p>문제가 생길 때 한 번, 해결될 때 한 번 보내요.</p>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(async () =>
                          setMessage(
                            (await api.testSlack(app))
                              ? "시험 알림을 예약했어요. 잠시 뒤 슬랙에서 확인해 주세요."
                              : "잠시 뒤 다시 시도해 주세요. 시험 알림은 분당 한 번 보낼 수 있어요.",
                          ),
                        )
                      }
                    >
                      시험 알림 보내기
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => act(() => api.disconnectSlack(app))}
                    >
                      슬랙 연결 끊기
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
                  <button disabled={busy} onClick={() => act(connect)}>
                    {settings.broken ? "슬랙 다시 연결" : "Slack에 추가"}
                  </button>
                </>
              )}
            </section>
            <section className="panel">
              <h2>이메일</h2>
              <button
                role="switch"
                className="notification-switch"
                aria-checked={settings.email}
                disabled={busy}
                onClick={() =>
                  act(() => api.emailSetting(app, !settings.email))
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
            </section>
          </div>
          <details>
            <summary>슬랙 연결이 안 될 때</summary>
            <p>
              무료 슬랙은 앱을 10개까지 추가할 수 있어요. 앱 하나를 지우거나
              이메일 알림을 켜세요. 회사 슬랙에서 앱 추가를 막았다면 관리자에게
              요청해 주세요.
            </p>
          </details>
        </>
      ) : message ? (
        <button onClick={() => setAttempt((n) => n + 1)}>다시 불러오기</button>
      ) : (
        <p role="status">알림 설정을 불러오는 중</p>
      )}
      {message && <p role="status">{message}</p>}
    </>
  );
}
