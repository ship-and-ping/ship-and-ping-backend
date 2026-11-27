import { useEffect, useState } from "react";
import type { AlertSettings, Gateway, PushDevice } from "./data";
import { canInstall, configuredKey, deniedHelp, deviceType, fingerprint, install, setPushBinding, standalone, subscribe } from "./push";

type Props = { api: Gateway; app: string; settings: AlertSettings; reload(): void };
export function PushChannel({api, app, settings, reload}: Props) {
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [keyHash, setKeyHash] = useState<string | null>(null);
  const [browserHash, setBrowserHash] = useState<string | null>(null);
  const [installable, setInstallable] = useState(canInstall);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [version, setVersion] = useState(0);
  const type = deviceType();
  const ios = type === "iPhone" || type === "iPad";
  const home = standalone();
  const supported = "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
  const current = devices.find(d => d.endpoint === endpoint);
  const stale = Boolean(current && (!keyHash || current.vapid_fingerprint !== keyHash ||
    (browserHash && browserHash !== keyHash)));
  useEffect(() => {
    const update = () => setInstallable(canInstall());
    const updateDevices = () => setVersion(v => v + 1);
    window.addEventListener("push-install-change", update);
    window.addEventListener("push-device-change", updateDevices);
    return () => {
      window.removeEventListener("push-install-change", update);
      window.removeEventListener("push-device-change", updateDevices);
    };
  }, []);
  useEffect(() => {
    let active = true;
    fingerprint(configuredKey()?.buffer).then(hash => { if (active) setKeyHash(hash); }).catch(() => {});
    api.devices().then(list => { if (active) setDevices(list); }).catch(() => {
      if (active) setMessage("기기 목록을 불러오지 못했어요.");
    });
    if (supported) navigator.serviceWorker.getRegistration("/")
      .then(reg => reg?.pushManager.getSubscription())
      .then(async sub => {
        const hash = await fingerprint(sub?.options?.applicationServerKey);
        if (active) { setBrowserHash(hash); setEndpoint(sub?.endpoint ?? ""); }
      }).catch(() => {});
    return () => { active = false; };
  }, [api, supported, version]);
  async function act(action: () => Promise<void>) {
    setPending(true);
    setMessage("");
    try { await action(); } catch (error) {
      setMessage(error instanceof Error && ["푸시 발송 설정을 준비 중이에요.", deniedHelp(),
        "알림을 받으려면 허용을 눌러 주세요."].includes(error.message)
        ? error.message : "푸시 설정을 완료하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally { setPending(false); }
  }
  function refresh() {
    setVersion(v => v + 1);
    reload();
  }
  async function enable() {
    const sub = await subscribe(api.removeEndpoint);
    await api.registerPush(app,sub.toJSON(),type);
    setEndpoint(sub.endpoint);
    setMessage("이 기기에서 푸시를 받을 수 있어요.");
    refresh();
  }
  async function remove(device: PushDevice) {
    await api.removeDevice(device.id);
    refresh();
    if (device.endpoint === endpoint && supported) {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub?.endpoint === device.endpoint) {
        await setPushBinding(null);
        await sub.unsubscribe();
      }
    }
    setMessage("이 기기를 알림 목록에서 삭제했어요.");
  }
  return <section className="panel push-channel">
    <header><h2>앱 푸시</h2><small>{stale ? "다시 켜기 필요" : settings.push && current ? "켜짐" : "홈 화면 앱"}</small></header>
    {ios && !home ? <>
      <p>iOS·iPadOS 16.4 이상에서 홈 화면에 추가한 쉽앤핑으로만 푸시를 받을 수 있어요.</p>
      <ol><li>Safari 공유 버튼을 누르세요.</li><li>홈 화면에 추가를 선택하세요.</li>
        <li>홈 화면의 쉽앤핑으로 열고 로그인하세요.</li><li>알림 설정에서 푸시 켜기를 누르세요.</li></ol>
    </> : <>
      {!home && (installable ? <button disabled={pending} onClick={() => act(install)}>쉽앤핑 설치</button>
        : <p>브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요.</p>)}
      {supported ? Notification.permission === "denied" ? <p>{deniedHelp()}</p>
        : stale ? <><p>푸시 발송 키가 바뀌었어요. 이 기기의 구독을 갱신해 주세요.</p>
          <button disabled={pending} onClick={() => act(enable)}>푸시 다시 켜기</button></>
        : current && settings.push ? <>
          <p>이 기기로 {type === "PC" ? "데스크톱" : "홈 화면"} 알림을 받아요.</p>
          <button disabled={pending} onClick={() => act(async () => setMessage(await api.testPush(app,current.id)
            ? "시험 푸시를 예약했어요. 잠시 뒤 알림을 확인해 주세요." : "시험 푸시는 분당 한 번 보낼 수 있어요."))}>시험 푸시 보내기</button>
        </> : <button disabled={pending} onClick={() => act(enable)}>푸시 켜기</button>
        : <p>이 브라우저에서는 푸시를 사용할 수 없어요.</p>}
    </>}
    {devices.length > 0 && <>
      <button className="secondary" disabled={pending} onClick={() => act(async () => {
        await api.pushEnabled(app,!settings.push);
        refresh();
      })}>{settings.push ? "이 앱의 푸시 끄기" : "등록한 기기로 다시 받기"}</button>
      <details><summary>등록한 기기 {devices.length}대</summary>
        <p>기기를 삭제하면 내 모든 앱의 푸시가 그 기기에서 꺼져요.</p>
        {devices.map(d => <p key={d.id}>{d.user_agent} · {new Date(d.created_at).toLocaleDateString("ko-KR")}
          {d.id === current?.id && " · 이 기기"}{" "}
          <button className="secondary" disabled={pending} onClick={() => act(() => remove(d))}>기기 삭제</button>
        </p>)}
      </details>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
