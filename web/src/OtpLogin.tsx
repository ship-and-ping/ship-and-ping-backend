import { useRef, useState, type FormEvent } from "react";
import type { Gateway } from "./data";

export function OtpLogin({api}: {api: Pick<Gateway,"requestLoginCode" | "verifyLoginCode">}) {
  const [address,setAddress] = useState("");
  const [sent,setSent] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const codeField = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (sent) await api.verifyLoginCode(address.trim(),codeField.current!.value);
      else {
        await api.requestLoginCode(address.trim());
        setSent(true);
      }
    } catch (cause) {
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 429) {
        setError("시도 횟수를 넘었어요. 잠시 뒤 다시 시도해 주세요.");
      } else if (sent) {
        setError("코드를 다시 확인해 주세요. 10분이 지났거나 다섯 번 틀렸다면 새 코드를 받아 주세요.");
        codeField.current?.focus();
      } else {
        setError("코드를 보내지 못했어요. 가입한 주소를 확인하고 잠시 뒤 다시 받아 주세요.");
      }
    } finally {setBusy(false);}
  }
  return <form onSubmit={submit} className="otp-login">
    <h2>메일 코드로 로그인</h2>
    <p>가입한 메일에서 숫자만 확인한 뒤 이 앱에 입력해 주세요.</p>
    <label>가입한 이메일<input type="email" autoComplete="email" required readOnly={sent} value={address} onChange={e=>setAddress(e.target.value)}/></label>
    {sent && <><p role="status">가입한 주소라면 로그인 코드를 보냈어요. 10분 안에 입력해 주세요.</p>
      <label>6자리 코드<input ref={codeField} autoFocus type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6}/></label></>}
    <button disabled={busy}>{sent ? "코드로 로그인" : "6자리 코드 받기"}</button>
    {sent && <button type="button" className="secondary" disabled={busy} onClick={()=>{setSent(false);setError("");}}>새 코드 받기</button>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
