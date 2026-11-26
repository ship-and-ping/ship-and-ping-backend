import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Gateway } from "./data";
import { PublicBar } from "./Layout";
import { forget, remembered, type Decision, type LoginRequest } from "./login-requests";

const messages: Record<string,string> = {
  approved:"이 PC 로그인을 승인했어요.", denied:"휴대폰에서 거절했어요.",
  mismatch:"휴대폰에서 숫자가 맞지 않아 요청을 취소했어요. 다시 요청해 주세요.",
  mail_required:"메일의 링크를 다시 눌러 주세요.",
  expired:"요청 시간이 지났어요. 새 메일을 받아 주세요.", used:"이미 처리한 요청이에요.",
  failed:"요청을 확인하지 못했어요. 새 메일을 받아 주세요.",
  limited:"요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
};

export function LoginWaiting({api,request,restart}: {api:Gateway; request:LoginRequest; restart:()=>void}) {
  const [status,setStatus] = useState("pending");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let next = "expired";
      if (Date.now()<Date.parse(request.expires_at)) {
        try { next = await api.requests!.poll(request.request_id,request.poll_secret); }
        catch (error) { next = error instanceof TypeError ? "pending" : "failed"; }
      }
      if (next!=="pending") forget(request.request_id);
      if (stopped) return;
      setStatus(next);
      if (next==="pending") timer=setTimeout(poll,3500);
    }
    timer=setTimeout(poll,1000);
    return () => { stopped=true; clearTimeout(timer); };
  },[api,request]);
  return <section className="auth-form login-waiting" aria-live="polite">
    {status==="pending" ? <>
      <h2>메일을 확인해 주세요</h2>
      <p>휴대폰에서 메일 링크를 열고 아래 숫자를 입력한 뒤 승인해 주세요.</p>
      <p className="match-code">PC 확인 숫자 <strong className="login-number">{request.match_code}</strong></p>
      <p>이 PC에서 메일을 열면 바로 로그인돼요. PC의 로그인 요청은 10분 동안만 승인할 수 있어요.</p>
    </> : <p>{messages[status] ?? messages.failed}</p>}
    {status!=="approved" && <button className={status==="pending" ? "secondary" : undefined}
      onClick={()=>{forget(request.request_id);restart();}}>이메일 입력으로 돌아가기</button>}
  </section>;
}

export function LoginApproval({api,user}: {api:Gateway; user:string|null}) {
  const [params] = useSearchParams();
  const id = params.get("req") ?? "";
  const proof = params.get("proof") ?? "";
  const navigate = useNavigate();
  const [details,setDetails] = useState<Decision>();
  const [status,setStatus] = useState("loading");
  const [code,setCode] = useState("");
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function inspect() {
      if (!user || !id || !proof || !api.requests) { setStatus("mail_required"); return; }
      const local = remembered();
      try {
        const same = local?.request_id===id;
        const result = await api.requests.decide(id,same ? "local" : "inspect",proof,undefined,same ? local.poll_secret : undefined);
        if (!active) return;
        if (same && result.status==="used") { forget(id); navigate("/login",{replace:true}); return; }
        setDetails(result);
        setStatus(result.status);
      } catch { if(active) setStatus("failed"); }
    }
    void inspect();
    return () => {active=false;};
  },[api,user,id,proof,navigate]);
  async function decide(action:"approve"|"deny") {
    if (busy || !api.requests) return;
    setBusy(true);
    try { const result=await api.requests.decide(id,action,proof,code); setStatus(result.status); setCode(""); }
    catch { setStatus("failed"); }
    finally {setBusy(false);}
  }
  return <><a className="skip" href="#main">본문으로 가기</a><PublicBar/><main id="main" className="public"><section className="panel auth-form login-approval">
    <h1>{status==="pending" ? "PC 로그인을 승인할까요?" : status==="loading" ? "PC 로그인 요청 확인" : "PC 로그인 요청 결과"}</h1>
    {details && status==="pending" ? <>
      <p className="request-info">요청 기기 · {details.client_info?.browser} · {details.client_info?.place}<br/>
        {new Date(details.created_at!).toLocaleString("ko-KR",{dateStyle:"long",timeStyle:"short"})}</p>
      <p id="match-hint">내가 쓰는 PC인지 확인하려고 숫자를 맞춰 봐요. 로그인하려는 PC에 표시된 숫자를 입력해 주세요.</p>
      <label>PC 확인 숫자 두 자리
        <input aria-describedby="match-hint" inputMode="numeric" pattern="[0-9]{2}" maxLength={2} autoComplete="off" value={code}
          onChange={event=>setCode(event.target.value.replace(/[^0-9]/g,""))}/>
      </label>
      <button disabled={busy || code.length!==2} onClick={()=>void decide("approve")}>이 PC 로그인 승인</button>
      <p>요청한 적이 없다면 숫자 없이 거절할 수 있어요.</p>
      <button className="secondary" disabled={busy} onClick={()=>void decide("deny")}>거절</button>
      {busy && <p role="status">요청을 처리하고 있어요.</p>}
    </> : <><p role="status">{status==="loading" ? "요청을 확인하고 있어요." : messages[status] ?? messages.failed}</p>
      {status==="approved" && <p>로그인을 요청한 PC에서 계속해 주세요.</p>}
      <Link to="/login">쉽앤핑으로 돌아가기</Link></>}
  </section></main></>;
}
