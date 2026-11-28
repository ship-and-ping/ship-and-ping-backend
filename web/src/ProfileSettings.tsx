import {useEffect, useState} from "react";
import {Copy} from "./Connect";
import {extraConnectPrompt} from "./server-prompt";
import {type AppProfile, type profileAccess} from "./server-data";

const fields = {language:"언어",framework:"프레임워크",hosting:"호스팅",plan:"요금제",cpu_cores:"CPU 코어 수",memory_gb:"메모리 (GB)",database:"DB 종류",deploy:"배포 방법",rollback:"되돌리기 방법",metrics:"서버 지표 보는 법"} as const;
export function ProfileSettings({id,access}:{id:string; access?:ReturnType<typeof profileAccess>}) {
  const [profile,setProfile] = useState<AppProfile|null>();
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    access?.read(id).then(p => {if(active) setProfile(p)}).catch(() => {if(active) setError("프로필을 불러오지 못했어요.")});
    return () => {active=false};
  },[access,id]);
  async function remove() {
    if (!access || !window.confirm("프로필과 최근 변경 이력을 모두 지울까요?")) return;
    setBusy(true);
    try { await access.remove(id); setProfile(null); setError(""); }
    catch { setError("프로필을 지우지 못했어요."); }
    finally { setBusy(false); }
  }
  return <section className="panel"><h2>앱 프로필</h2>
    {profile ? <><dl>{Object.entries(fields).map(([key,label]) => {
      const value = profile[key as keyof typeof fields];
      return value == null ? null : <div key={key}><dt>{label}</dt><dd>{value}</dd></div>;
    })}{profile.services?.map((s,i) => <div key={i}><dt>{s.feature}</dt><dd>{s.name} ({s.kind})</dd></div>)}</dl>
    <button className="secondary" disabled={busy} onClick={remove}>프로필 지우기</button></>
    : <p>{profile === null || !access ? "아직 받은 프로필이 없어요." : error || "프로필을 확인하고 있어요."}</p>}
    {profile && error && <p role="alert">{error}</p>}
    <h3>추가 연결 요청문</h3><p>내 코딩 AI에 붙여 넣으면 기존 앱에 프로필과 서버 기록을 추가할 수 있어요.</p>
    <Copy text={extraConnectPrompt} title="추가 연결 요청문 복사"/>
  </section>;
}
