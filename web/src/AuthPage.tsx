import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Gateway } from "./data";
import { Hero, PublicBar } from "./Layout";
import { displayText } from "./normalize";

type Mode = "login" | "signup" | "forgot" | "reset" | "account";
const titles = {
  login: "로그인", signup: "회원 가입", forgot: "비밀번호 찾기",
  reset: "새 비밀번호 정하기", account: "비밀번호 저장",
};

export function AuthForm({ api, mode, saved }: { api: Gateway; mode: Mode; saved?: () => void }) {
  const navigate = useNavigate();
  const locked = useRef(false);
  const emailField = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(() => mode === "login" && /error(_code)?=/.test(location.search + location.hash)
    ? "로그인 링크를 확인할 수 없어요. 새 링크를 받아 주세요." : "");
  const newPassword = ["signup", "reset", "account"].includes(mode);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (locked.current || (action === "link" && !emailField.current?.reportValidity())) return;
    if (action !== "link" && !form.reportValidity()) return;
    const fields = new FormData(form);
    const password = String(fields.get("password") ?? "");
    setMessage("");
    setError("");
    if (newPassword && (/^(.)\1+$/.test(password) || /^(12345678(9(0)?)?|password|qwertyuiop)$/i.test(password))) {
      setError("쉽게 짐작할 수 있는 비밀번호예요. 다른 비밀번호를 적어 주세요.");
      form.querySelector<HTMLInputElement>('[name=password]')?.focus();
      return;
    }
    if (newPassword && password !== fields.get("confirm")) {
      setError("비밀번호를 두 칸에 똑같이 적어 주세요.");
      form.querySelector<HTMLInputElement>('[name=confirm]')?.focus();
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      if (action === "link") {
        await api.login(email.trim());
        setMessage("로그인 링크를 보냈어요. 메일이 안 오면 스팸함을 확인해 주세요.");
      } else if (mode === "login") {
        await api.passwordLogin(email.trim(), password);
      } else if (mode === "signup") {
        await api.signup(email.trim(), password);
        setMessage("확인 메일을 보냈어요. 메일이 안 오면 스팸함을 확인해 주세요.");
      } else if (mode === "forgot") {
        await api.requestReset(email.trim());
        setMessage("가입한 이메일이라면 비밀번호 재설정 메일을 받을 수 있어요. 스팸함도 확인해 주세요.");
      } else {
        await api.updatePassword(password);
        if (mode === "reset") navigate("/apps", {replace:true});
        else saved?.();
      }
      form.reset();
      setVisible(false);
    } catch {
      setVisible(false);
      setError(mode === "login" && action !== "link" ? "이메일이나 비밀번호가 맞지 않아요"
        : mode === "reset" ? "비밀번호를 저장하지 못했어요. 새 링크를 받아 다시 시도해 주세요."
        : newPassword ? "저장하지 못했어요. 다른 비밀번호로 다시 시도해 주세요."
        : "메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return <form noValidate onSubmit={submit}>
    {["login","signup","forgot"].includes(mode) && <label>이메일 주소
      <input ref={emailField} required type="email" autoComplete="email"
        value={displayText(email,"login-email")} onChange={e => setEmail(e.target.value)}/>
    </label>}
    {mode !== "forgot" && <>
      <label>{newPassword ? "새 비밀번호" : "비밀번호"}
        <input required name="password" type={visible ? "text" : "password"}
          minLength={newPassword ? 8 : undefined} autoComplete={newPassword ? "new-password" : "current-password"}/>
      </label>
      {newPassword && <>
        <small>8자 이상으로 적어 주세요. 생일이나 연속된 숫자는 쉽게 짐작할 수 있어요.</small>
        <label>비밀번호 확인<input required name="confirm" type={visible ? "text" : "password"} autoComplete="new-password"/></label>
      </>}
      <button type="button" className="secondary" aria-pressed={visible} onClick={() => setVisible(!visible)}>비밀번호 보기</button>
    </>}
    <button disabled={busy}>{busy ? "처리하는 중" : titles[mode]}</button>
    {mode === "login" && <button className="secondary" value="link" formNoValidate disabled={busy}>비밀번호 없이 메일 링크로 받기</button>}
    <p role="status">{message}</p>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function AuthPage({ api, mode, recovery = false }: { api: Gateway; mode: Exclude<Mode,"account">; recovery?: boolean }) {
  return <>
    <a className="skip" href="#main">본문으로 가기</a><PublicBar/>
    <main id="main" className="public">
      <h1 tabIndex={-1}>{mode === "login" ? "쉽앤핑 시작하기" : titles[mode]}</h1>
      <div className="even">
        <Hero title="내 앱, 지금도 괜찮을까요?" detail="앱이 어디서 막혔는지 쉽앤핑이 지켜보고 알려 드려요."/>
        <section className="panel">
          {mode === "login" && <h2>로그인</h2>}
          {mode === "reset" && !recovery ? <p role="alert">링크가 만료됐거나 이미 사용됐어요. 새 링크를 받아 주세요.</p>
            : <AuthForm key={mode} api={api} mode={mode}/>}
          {mode === "login" && <>
            <Link to="/signup">회원 가입</Link>{" · "}<Link to="/forgot-password">비밀번호 찾기</Link>
            <p><button type="button" className="secondary" disabled>Google 로그인 예정</button></p>
          </>}
          {mode === "reset" && <p><Link to="/forgot-password">재설정 메일 다시 받기</Link></p>}
          <Link to={mode === "login" ? "/" : "/login"}>{mode === "login" ? "쉽앤핑 소개로 돌아가기" : "로그인으로 돌아가기"}</Link>
        </section>
      </div>
    </main>
  </>;
}
