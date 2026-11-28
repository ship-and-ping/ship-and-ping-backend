import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { type Gateway } from "./data";
import { canInstall, install } from "./push";
import { installDevice } from "./install-device";
import "./styles/install.css";

const guideUrl = () => location.origin + "/install";
function GuideCode() {
  return <figure className="guide-code">
    <QRCodeSVG value={guideUrl()} size={164} marginSize={4} role="img" title="휴대폰 카메라로 스캔할 설치 안내 QR 코드"/>
    <figcaption>휴대폰 카메라로 QR 코드를 비춰 주세요.</figcaption>
  </figure>;
}

export function InstallEntry() {
  return <Link className="install-entry" to="/apps/phone">휴대폰으로 알림 받기</Link>;
}
export function InstallBanner({app,api}: {app:string;api:Gateway}) {
  const [visible,setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    async function check() {
      if (sessionStorage.getItem("install-dismissed-"+app)) return;
      const settings = await api.settings(app);
      if (active) setVisible(settings.subscribed === false);
    }
    void check().catch(()=>{});
    return () => {active=false;};
  }, [app,api]);
  if (!visible) return null;
  return <aside className="install-banner"><InstallEntry/><button className="secondary" onClick={()=>{
    setVisible(false);
    try {sessionStorage.setItem("install-dismissed-"+app,"1");} catch { /* closed for this view */ }
  }}>닫기</button></aside>;
}
export function PhoneHandoff({api}: {api:Gateway}) {
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  async function send() {
    setBusy(true);
    try {
      setMessage(await api.sendInstallMail() === "sent" ? "가입한 이메일로 설치 안내를 보냈어요." :
        "지금은 더 보낼 수 없어요. 10분에 한 번, 하루 최대 5회까지 받을 수 있어요. QR 코드로도 열 수 있어요.");
    } catch {setMessage("메일을 보내지 못했어요. QR 코드로 열거나 잠시 뒤 다시 시도해 주세요.");}
    finally {setBusy(false);}
  }
  return <div className="install-wrap"><h1 tabIndex={-1}>휴대폰으로 알림 받기</h1>
    <p>휴대폰에서 설치 안내를 열고 홈 화면에 쉽앤핑을 추가해 주세요.</p>
    <section className="panel install-card"><GuideCode/><p>같은 안내를 가입한 이메일로 받을 수 있어요.</p>
      <button disabled={busy} onClick={send}>{busy ? "메일 보내는 중" : "설치 안내 메일 받기"}</button>
      <p role="status">{message}</p><Link to="/install">이 기기에서 설치 안내 열기</Link>
    </section></div>;
}

const steps = [
  ["공유 버튼 누르기","Safari 화면 아래에서 공유 버튼을 찾아요. 도구 막대가 숨겨져 있다면 메뉴를 열어 주세요."],
  ["홈 화면에 추가","공유 메뉴를 위로 올려 ‘홈 화면에 추가’를 선택해요."],
  ["추가 누르기","‘추가’를 누른 뒤 홈 화면에서 쉽앤핑을 열어 로그인해요."],
] as const;
function StepDrawing({step}: {step:number}) {
  return <svg className="step-drawing" viewBox="0 0 92 88" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="20" y="5" width="52" height="77" rx="9" fill="var(--sp-surface)"/>
    {step===0 ? <><path d="M21 60h50M40 68v7h12v-7m-6 2V61m-4 4 4-4 4 4"/><path d="M46 23v27m-7-8 7 8 7-8" stroke="var(--sp-ok-ink)" strokeWidth="4"/></> :
      step===1 ? <><rect x="26" y="41" width="40" height="27" rx="4" fill="var(--sp-ok-soft)"/><path d="M31 54h9m-4.5-4.5v9m10-4.5h14M31 32h29"/></> :
      <><rect x="43" y="15" width="22" height="13" rx="5" fill="var(--sp-ok-soft)"/><path d="m50 21 3 3 6-7"/><rect x="34" y="38" width="24" height="24" rx="6"/><path d="m40 50 4 4 9-10"/></>}
  </svg>;
}

export function InstallGuide() {
  const device = installDevice();
  const [ready,setReady] = useState(canInstall);
  const [message,setMessage] = useState("");
  useEffect(() => {
    const update = () => setReady(canInstall());
    window.addEventListener("push-install-change",update);
    return () => window.removeEventListener("push-install-change",update);
  }, []);
  if (device === "installed") return <Navigate replace to="/phone-setup"/>;
  return <main className="install-page"><div className="install-wrap">
    <Link to="/" className="install-brand"><img src="/sheep-192.png" width="38" height="38" alt=""/>쉽앤핑</Link>
    <header className="install-intro"><h1 tabIndex={-1}>{device === "open-safari" ? "Safari로 열어 주세요" : "휴대폰으로 알림 받기"}</h1>
      <p>{device==="desktop" ? "휴대폰에서 이 안내를 열어 주세요." : "홈 화면에 쉽앤핑을 추가하면 내 앱의 문제를 휴대폰 알림으로 받을 수 있어요."}</p></header>
    {device === "safari" ? <ol className="install-steps">{steps.map(([title,detail],i)=>
      <li key={title}><StepDrawing step={i}/><div><h2>{i+1}. {title}</h2><p>{detail}</p></div></li>)}</ol> :
      <section className="panel install-card">
        {device==="desktop" && <GuideCode/>}
        {device==="update" && <><h2>iOS 업데이트가 필요해요</h2><p>설정 → 일반 → 소프트웨어 업데이트에서 iOS 16.4 이상으로 업데이트해 주세요.</p></>}
        {device==="open-safari" && <><p>메일 앱 메뉴에서 ‘Safari로 열기’를 선택하거나 아래 주소를 Safari 주소창에 붙여 넣어 주세요.</p>
          <a href={guideUrl()}>{guideUrl()}</a><button onClick={async()=>{
            try {await navigator.clipboard.writeText(guideUrl());setMessage("주소를 복사했어요.");}
            catch {setMessage("위 주소를 길게 눌러 복사해 주세요.");}
          }}>주소 복사</button></>}
        {device==="android" && <><h2>홈 화면에 쉽앤핑 추가</h2><p>설치한 뒤 홈 화면의 쉽앤핑에서 로그인하고 알림을 켜 주세요.</p>
          {ready ? <button onClick={async()=>{try {await install();} catch {setMessage("Chrome 메뉴에서 ‘앱 설치’를 선택해 주세요.");}}}>쉽앤핑 설치</button> :
            <p>Chrome 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요.</p>}</>}
        {message && <p role="status">{message}</p>}
      </section>}
  </div></main>;
}
