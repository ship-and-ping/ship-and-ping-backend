import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AppSummary, Gateway } from "./data";
import { configuredKey, currentSubscription, deniedHelp, requestPushPermission } from "./push";
import { registerBrowserPush } from "./enable-push";
import { displayText } from "./normalize";

export function finishedSetup(member:string) {
  try { return localStorage.getItem("ship-ping-install-complete") === member; } catch {return false;}
}
export function PushSetup({api,member}: {api:Gateway;member?:string}) {
  const navigate = useNavigate();
  const [apps,setApps] = useState<AppSummary[]>();
  const [app,setApp] = useState("");
  const [device,setDevice] = useState("");
  const [sent,setSent] = useState(false);
  const [help,setHelp] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  const [ready,setReady] = useState<boolean | undefined>(()=>configuredKey() ? undefined : false);
  useEffect(() => {
    if (!configuredKey()) return;
    let active = true;
    async function load() {
      const available = await api.pushReady();
      if (!active) return;
      setReady(available);
      if (available) {
        const list = await api.apps();
        if (active) {setApps(list);setApp(list[0]?.id ?? "");}
      }
    }
    void load().catch(()=>{if (active) setError("알림 설정을 불러오지 못했어요.");});
    return () => {active=false;};
  }, [api,attempt]);
  async function enable() {
    setBusy(true);
    setError("");
    try {
      const bytes = await requestPushPermission();
      const sub = await currentSubscription();
      const known = sub && (await api.devices()).find(d=>d.endpoint===sub.endpoint);
      const endpoint = await registerBrowserPush(api,app,bytes,known?.endpoint);
      const current = (await api.devices()).find(d=>d.endpoint===endpoint && d.current_session);
      if (!current) throw Error();
      setDevice(current.id);
    } catch {
      setError(Notification.permission==="denied" ? deniedHelp() : "알림을 켜지 못했어요. 연결과 알림 권한을 확인한 뒤 다시 눌러 주세요.");
    } finally {setBusy(false);}
  }
  async function test() {
    setBusy(true);setError("");
    try {
      if (await api.testPush(app,device)) {setSent(true);setHelp(false);}
      else setError("시험 알림은 1분에 한 번 보낼 수 있어요. 잠시 뒤 다시 눌러 주세요.");
    } catch {setError("시험 알림을 예약하지 못했어요. 연결을 확인하고 다시 눌러 주세요.");}
    finally {setBusy(false);}
  }
  function finish() {
    try { if (member) localStorage.setItem("ship-ping-install-complete", member); } catch { /* navigation still works */ }
    navigate("/apps/"+encodeURIComponent(app),{replace:true});
  }
  const supported = "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
  return <main className="install-page"><div className="install-wrap">
    <header className="install-intro"><h1 tabIndex={-1}>{ready === false ? "알림 준비 중" : "휴대폰 알림 켜기"}</h1>
      <p>{ready === false ? "쉽앤핑이 푸시 발송을 준비하고 있어요. 준비되면 알림 설정에서 켤 수 있어요." : "이 기기에서 알림을 받을 앱을 선택해 주세요."}</p></header>
    <section className="panel install-card">
      {ready !== false && (!apps ? error ? <button onClick={()=>{setError("");setAttempt(n=>n+1);}}>다시 불러오기</button> :
        <p role="status">앱을 불러오는 중이에요.</p> : !apps.length ? <Link to="/apps/new">알림 받을 앱 등록하기</Link> :
        !supported ? <p>이 기기에서는 푸시를 쓸 수 없어요. 지원되는 휴대폰의 홈 화면 앱에서 열어 주세요.</p> : <>
          <label>알림 받을 앱<select value={app} disabled={busy} onChange={e=>{setApp(e.target.value);setDevice("");setSent(false);setHelp(false);setError("");}}>
            {apps.map(a=><option key={a.id} value={a.id}>{displayText(a.name)}</option>)}</select></label>
          {!device ? <button disabled={busy} onClick={enable}>알림 켜기</button> :
            <>{(!sent || help) && <button disabled={busy} onClick={test}>시험 알림 보내기</button>}
              {sent && <><h2>알림이 왔나요?</h2><div className="actions"><button onClick={finish}>왔어요</button>
                <button className="secondary" onClick={()=>setHelp(true)}>안 왔어요</button></div></>}
              {help && <p role="status">{deniedHelp()} 집중 모드를 끄고 인터넷 연결을 확인한 뒤 시험 알림을 다시 보내 주세요.</p>}</>}
        </>)}
      {error && <p role="alert">{error}</p>}
      <Link to="/apps" replace>내 앱으로 가기</Link>
    </section></div></main>;
}
