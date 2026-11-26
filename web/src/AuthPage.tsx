import { useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Gateway } from "./data";
import { Hero, PublicBar } from "./Layout";
import { displayText } from "./normalize";
import { LoginWaiting } from "./LoginApproval";
import { remember, remembered } from "./login-requests";

type Mode = "login" | "signup" | "forgot" | "reset" | "account";
const titles = {
  login: "로그인", signup: "회원 가입", forgot: "비밀번호 찾기",
  reset: "새 비밀번호 정하기", account: "비밀번호 저장",
};

export function AuthForm({ api, mode, saved, expired }: { api: Gateway; mode: Mode; saved?: () => void; expired?: () => void }) {
  const navigate = useNavigate();
  const locked = useRef(false);
  const [request,setRequest] = useState(() => (mode==="signup" || mode==="login") && api.requests ? remembered() : undefined);
  const emailField = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const codeField = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(() => mode === "login" && /error(_code)?=/.test(location.search + location.hash)
    ? "로그인 링크를 확인할 수 없어요. 새 링크를 받아 주세요." : "");
  const [invalidField, setInvalidField] = useState("");
  const errorId = useId();
  const hintId = useId();
  const passwordId = useId();
  const fieldError = (name: string) => invalidField === name && error
    ? <p id={errorId} role="alert">{error}</p> : null;
  const newPassword = ["signup", "reset", "account"].includes(mode);
  async function sendCode() {
    setMessage("");
    setError("");
    setInvalidField("");
    setNeedsCode(true);
    try {
      await api.reauthenticate();
      if (codeField.current) codeField.current.value = "";
      setMessage("본인 확인을 위해 메일로 보낸 번호를 적어 주세요.");
      codeField.current?.focus();
    } catch {
      setError("인증번호를 보내지 못했어요. 잠시 뒤 번호를 다시 받아 주세요.");
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (locked.current) return;
    const fields = new FormData(form);
    const password = String(fields.get("password") ?? "");
    setMessage("");
    setError("");
    setInvalidField("");
    function invalid(name: string, text: string) {
      setInvalidField(name);
      setError(text);
      form.querySelector<HTMLInputElement>('[name="' + name + '"]')?.focus();
    }
    if (action !== "google" && emailField.current && !emailField.current.validity.valid) {
      invalid("email", "이메일 주소를 확인해 주세요.");
      return;
    }
    if (action !== "link" && action !== "google" && mode === "login" && !password) {
      invalid("password", "비밀번호를 적어 주세요.");
      return;
    }
    if (action === "resend" && needsCode) {
      locked.current = true;
      setBusy(true);
      try { await sendCode(); }
      finally { locked.current = false; setBusy(false); }
      return;
    }
    if (newPassword && password.length < 8) {
      invalid("password", "비밀번호를 8자 이상으로 적어 주세요.");
      return;
    }
    if (newPassword && (/^(.)\1+$/.test(password) || /^(12345678(9(0)?)?|password|qwertyuiop)$/i.test(password))) {
      invalid("password", "쉽게 짐작할 수 있는 비밀번호예요. 다른 비밀번호를 적어 주세요.");
      return;
    }
    if (newPassword && password !== fields.get("confirm")) {
      invalid("confirm", "비밀번호를 두 칸에 똑같이 적어 주세요.");
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      if (action === "google") {
        await api.login();
      } else if (action === "link") {
        const pending = await api.login(email.trim());
        if (pending) { remember(pending); setRequest(pending); }
        setMessage("로그인 링크를 보냈어요. 메일이 안 오면 스팸함을 확인해 주세요.");
      } else if (mode === "login") {
        await api.passwordLogin(email.trim(), password);
      } else if (mode === "signup") {
        const pending = await api.signup(email.trim(), password);
        if (pending) { remember(pending); setRequest(pending); }
        setMessage("확인 메일을 보냈어요. 메일이 안 오면 스팸함을 확인해 주세요.");
      } else if (mode === "forgot") {
        await api.requestReset(email.trim());
        setMessage("가입한 이메일이라면 비밀번호 재설정 메일을 받을 수 있어요. 스팸함도 확인해 주세요.");
      } else {
        if (needsCode) {
          const nonce = String(fields.get("nonce") ?? "").trim();
          if (!nonce) {
            invalid("nonce", "메일로 받은 번호를 적어 주세요.");
            return;
          }
          await api.updatePassword(password, nonce);
        } else await api.updatePassword(password);
        if (mode === "reset") navigate("/apps", {replace:true});
        else saved?.();
      }
      form.reset();
      setVisible(false);
    } catch (cause) {
      setVisible(false);
      const status = cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
      if (mode === "account" && code === "reauthentication_needed" && !needsCode) {
        await sendCode();
        return;
      }
      if (needsCode && (code === "reauthentication_not_valid" || code === "otp_expired" || code === "reauthentication_needed")) {
        invalid("nonce", code === "otp_expired" ? "번호가 만료됐어요. 새 번호를 받아 주세요." : "번호를 다시 확인해 주세요. 시간이 지났다면 새 번호를 받아 주세요.");
        return;
      }
      if (newPassword && (code === "same_password" || code === "weak_password")) {
        invalid("password", code === "same_password" ? "이전과 다른 비밀번호를 적어 주세요." : "쉽게 짐작하기 어려운 비밀번호로 바꿔 주세요.");
        return;
      }
      if (mode === "reset" && (code === "session_expired" || code === "session_not_found" || code === "otp_expired" || status === 401)) {
        expired?.();
        return;
      }
      const offline = cause instanceof TypeError || status === 0;
      if (status === 429) setError("요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
      else if (offline) setError("인터넷 연결을 확인하고 다시 시도해 주세요.");
      else if (action === "google") setError("Google 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
      else if (mode === "login" && action !== "link") invalid("password", "이메일이나 비밀번호가 맞지 않아요");
      else setError(mode === "reset" ? "비밀번호를 저장하지 못했어요. 새 링크를 받아 다시 시도해 주세요."
        : newPassword ? "저장하지 못했어요. 다른 비밀번호로 다시 시도해 주세요."
        : "메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (request) return <LoginWaiting api={api} request={request} restart={()=>setRequest(undefined)}/>;
  return <form className="auth-form" aria-busy={busy} noValidate onSubmit={submit}>
    {["login","signup","forgot"].includes(mode) && <><label>이메일 주소
      <input name="email" aria-invalid={invalidField === "email"} aria-describedby={invalidField === "email" ? errorId : undefined} ref={emailField} required type="email" autoComplete="email"
        value={displayText(email,"login-email")} onChange={e => setEmail(e.target.value)}/>
    </label>{fieldError("email")}</>}
    {mode !== "forgot" && <>
      <label htmlFor={passwordId}>{newPassword ? "새 비밀번호" : "비밀번호"}</label>
      <div className="auth-password">
        <input id={passwordId} required name="password" aria-invalid={invalidField === "password"}
          aria-describedby={[newPassword && hintId, invalidField === "password" && errorId].filter(Boolean).join(" ") || undefined} type={visible ? "text" : "password"}
          minLength={newPassword ? 8 : undefined} autoComplete={newPassword ? "new-password" : "current-password"}/>
        <button type="button" className="auth-toggle" aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}
          aria-pressed={visible} onClick={() => setVisible(!visible)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
            <circle cx="12" cy="12" r="3"/>
            {visible && <path d="m3 3 18 18"/>}
          </svg>
        </button>
      </div>
      {fieldError("password")}
      {newPassword && <>
        <small id={hintId}>8자 이상으로 적어 주세요. 생일이나 연속된 숫자는 쉽게 짐작할 수 있어요.</small>
        <label>비밀번호 확인<input required name="confirm" aria-invalid={invalidField === "confirm"} aria-describedby={invalidField === "confirm" ? errorId : undefined} type={visible ? "text" : "password"} autoComplete="new-password"/></label>
        {fieldError("confirm")}
      </>}
    </>}
    {needsCode && <>
      <label>메일 인증번호<input ref={codeField} name="nonce" autoComplete="one-time-code" inputMode="numeric"
        aria-invalid={invalidField === "nonce"} aria-describedby={invalidField === "nonce" ? errorId : undefined}/></label>
      {fieldError("nonce")}
    </>}
    <button disabled={busy}>{busy ? "처리하는 중" : titles[mode]}</button>
    {needsCode && <button value="resend" className="secondary" disabled={busy}>번호 다시 받기</button>}
    {mode === "login" && <>
      <div className="auth-divider" role="separator" aria-label="또는">또는</div>
      <button className="secondary" value="link" formNoValidate disabled={busy}>비밀번호 없이 메일 링크로 받기</button>
      {import.meta.env.VITE_GOOGLE_LOGIN_ENABLED === "true" &&
        <button className="secondary" value="google" formNoValidate disabled={busy}>Google로 로그인</button>}
    </>}
    <p role="status">{message}</p>
    {!invalidField && error && <p role="alert">{error}</p>}
  </form>;
}

export function AuthPage({ api, mode, recovery = false, expired }: { api: Gateway; mode: Exclude<Mode,"account">; recovery?: boolean; expired?: () => void }) {
  return <>
    <a className="skip" href="#main">본문으로 가기</a><PublicBar/>
    <main id="main" className="public">
      <h1 tabIndex={-1}>{mode === "login" ? "쉽앤핑 시작하기" : titles[mode]}</h1>
      <div className="even">
        <Hero title="내 앱, 지금도 괜찮을까요?" detail="앱이 어디서 막혔는지 쉽앤핑이 지켜보고 알려 드려요."/>
        <section className="panel">
          {mode === "login" && <h2>로그인</h2>}
          {mode === "reset" && !recovery ? <p role="alert">링크가 만료됐거나 이미 사용됐어요. 새 링크를 받아 주세요.</p>
            : <AuthForm key={mode} api={api} mode={mode} expired={expired}/>}
          {mode === "login" && <>
            <div className="actions"><Link to="/signup">회원 가입</Link><Link to="/forgot-password">비밀번호 찾기</Link></div>
          </>}
          {mode === "reset" && <p><Link to="/forgot-password">재설정 메일 다시 받기</Link></p>}
          <Link to={mode === "login" ? "/" : "/login"}>{mode === "login" ? "쉽앤핑 소개로 돌아가기" : "로그인으로 돌아가기"}</Link>
        </section>
      </div>
    </main>
  </>;
}
