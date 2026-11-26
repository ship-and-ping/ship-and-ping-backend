import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Gateway } from "./data";
import { PublicBar } from "./Layout";
import { forget, remembered, type Decision, type LoginRequest } from "./login-requests";

const messages: Record<string,string> = {
  approved:"이 PC 로그인을 승인했어요.", denied:"휴대폰에서 거절했어요.",
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
  return <section className="auth-form" aria-live="polite">
    {status==="pending" ? <>
      <h2>메일을 확인해 주세요</h2>
      <p>휴대폰에서 메일을 열고 ‘이 PC 로그인 승인’을 눌러 주세요.</p>
      <p>PC 확인 숫자 <strong className="login-number">{request.match_code}</strong></p>
      <p>이 PC에서 메일을 열면 바로 로그인돼요. 요청은 10분 동안 유효해요.</p>
    </> : <p>{messages[status] ?? messages.failed}</p>}
    {status!=="approved" && <button onClick={()=>{forget(request.request_id);restart();}}>새 메일 요청하기</button>}
  </section>;
}

export function LoginApproval({api,user}: {api:Gateway; user:string|null}) {
  const [params] = useSearchParams();
  const id = params.get("req") ?? "";
  const navigate = useNavigate();
  const [details,setDetails] = useState<Decision>();
  const [status,setStatus] = useState("loading");
  const [code,setCode] = useState("");
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function inspect() {
      if (!user || !id || !api.requests) { setStatus("failed"); return; }
      const local = remembered();
      try {
        const same = local?.request_id===id;
        const result = await api.requests.decide(id,same ? "local" : "inspect",undefined,same ? local.poll_secret : undefined);
        if (!active) return;
        if (same && result.status==="used") { forget(id); navigate("/login",{replace:true}); return; }
        setDetails(result);
        setStatus(result.status);
      } catch { if(active) setStatus("failed"); }
    }
    void inspect();
    return () => {active=false;};
  },[api,user,id,navigate]);
  async function decide(action:"approve"|"deny") {
    if (busy || !api.requests) return;
    setBusy(true);
    try { const result=await api.requests.decide(id,action,code); setStatus(result.status); setCode(""); }
    catch { setStatus("failed"); }
    finally {setBusy(false);}
  }
  return <><PublicBar/><main id="main" className="public"><section className="panel auth-form login-approval">
    <h1>PC 로그인을 승인할까요?</h1>
    {details && ["pending","incorrect"].includes(status) ? <>
      <p>{new Date(details.created_at!).toLocaleString("ko-KR")} · {details.client_info?.browser} · {details.client_info?.place}</p>
      <p>직접 요청하지 않았다면 거절해 주세요.</p>
      <fieldset><legend>PC 화면의 숫자와 같은 숫자를 고르세요.</legend>
        <div className="login-choices">{details.choices?.map(n=><label key={n}><input type="radio" name="match" value={n} checked={code===n} onChange={()=>setCode(n)}/> {n}</label>)}</div>
      </fieldset>
      {status==="incorrect" && <p role="alert">숫자가 달라요. PC 화면을 다시 확인해 주세요.</p>}
      <button disabled={busy || !code} onClick={()=>void decide("approve")}>이 PC 로그인 승인</button>
      <button className="secondary" disabled={busy} onClick={()=>void decide("deny")}>거절</button>
    </> : <><p role="status">{status==="loading" ? "요청을 확인하고 있어요." : messages[status] ?? messages.failed}</p>
      <Link to="/login">쉽앤핑으로 돌아가기</Link></>}
  </section></main></>;
}
