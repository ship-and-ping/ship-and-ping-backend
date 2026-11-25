import {
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { Sheep } from "./Sheep";
import { displayText } from "./normalize";
import mark from "./assets/wordmark.png";

type AppHeading = { id: string; name: string; issues?: number };
export const CurrentAppName = createContext<(heading: AppHeading) => void>(
  () => {},
);

export function Hero({
  title,
  detail,
  arrived = false,
}: {
  title: string;
  detail: string;
  arrived?: boolean;
}) {
  return (
    <section className={"hero-card" + (arrived ? " arrived" : "")}>
      <Sheep />
      <h2>{title}</h2>
      <p role="status">{detail}</p>
    </section>
  );
}
function Brand() {
  return (
    <Link className="brand" to="/">
      <img src={mark} alt="" width="36" height="36" />
      쉽앤핑
    </Link>
  );
}
export function PublicBar() {
  return (
    <header className="bar">
      <Brand />
      <nav aria-label="시작 메뉴">
        <Link to="/login">로그인</Link>
        <Link className="button" to="/login">
          시작하기
        </Link>
      </nav>
    </header>
  );
}
export function Shell({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pathname, hash: currentHash } = useLocation();
  const [heading, setHeading] = useState<AppHeading>();
  const currentName =
    heading && pathname.split("/")[2] === heading.id
      ? displayText(heading.name)
      : "";
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  function close() {
    setOpen(false);
    toggle.current?.focus();
  }
  return (
    <div
      className="shell"
      onKeyDown={(e) => {
        if (open && e.key === "Escape") close();
      }}
    >
      <a className="skip" href="#main">
        본문으로 가기
      </a>
      <header className="compact">
        <Brand />
        {currentName && <span>{currentName}</span>}
        <button
          ref={toggle}
          aria-controls="member-menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          메뉴
        </button>
      </header>
      <aside id="member-menu" className={"rail" + (open ? " open" : "")}>
        <Brand />
        <nav aria-label="회원 메뉴">
          <Link
            ref={first}
            to="/apps"
            aria-current={pathname === "/apps" ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            내 앱
          </Link>
          {currentName && <small>{currentName}</small>}
          {currentName &&
            heading &&
            [
              ["앱 홈", ""],
              ["기능", "#features"],
              ["문제", "#issues"],
            ].map(([label, hash]) => (
              <Link
                key={label}
                aria-current={(pathname === "/apps/" + heading.id && currentHash === hash) ||
                  (hash && pathname.startsWith("/apps/" + heading.id + "/" + hash.slice(1) + "/")) ? "page" : undefined}
                onClick={() => setOpen(false)}
                to={"/apps/" + heading.id + hash}
              >
                {label}{hash === "#issues" && heading.issues != null ? " " + heading.issues : ""}
              </Link>
            ))}
          {(currentName
            ? ["앱 설정", "알림 설정", "내 계정"]
            : ["알림 설정", "내 계정"]
          ).map((n) => (
            <span key={n}>
              {n} <small>준비 중</small>
            </span>
          ))}
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onLogout();
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "로그아웃하는 중" : "로그아웃"}
          </button>
          {error && (
            <p role="alert">로그아웃하지 못했어요. 다시 시도해 주세요.</p>
          )}
        </nav>
      </aside>
      <main id="main" className="workspace">
        <CurrentAppName.Provider value={setHeading}>
          {children}
        </CurrentAppName.Provider>
      </main>
    </div>
  );
}

export function Landing() {
  const acts = (
    <div className="actions">
      <Link className="button" to="/login">
        시작하기
      </Link>
      <Link className="button secondary" to="/login">
        로그인
      </Link>
    </div>
  );
  return (
    <>
      <a className="skip" href="#main">
        본문으로 가기
      </a>
      <PublicBar />
      <main id="main" className="landing">
        <section className="intro">
          <div>
            <h1 tabIndex={-1}>
              힘겹게 모은 사용자,
              <br />
              서버 문제로 잃으실 건가요?
            </h1>
            <p className="lead">
              사용자가 나쁜 리뷰를 남기기 전에 먼저 알고 고칠 수 있게, 쉽앤핑이
              대신 지켜볼게요.
            </p>
            <p>
              바이브 코딩으로 앱을 낸 사람을 위한 관리형 모니터링이에요. 문제가
              생기면 쉬운 한 문장으로 알려 드리고 코딩 AI에 보낼 내용까지 챙겨
              드려요.
            </p>
            {acts}
          </div>
          <div className="illustration">
            <Sheep large />
            <div className="hero-card">
              <small>✓ 괜찮아요 · 예시 화면</small>
              <h2>
                모임모아는 지금
                <br />
                모두 괜찮아요
              </h2>
              <p>
                기능 8개를 지켜보고 있어요. 문제가 생기면 슬랙이나 메일로 바로
                알려 드릴게요.
              </p>
            </div>
          </div>
        </section>
        <section>
          <h2>나쁜 리뷰로 먼저 알게 되면 늦어요</h2>
          <p>
            코딩 AI로 만든 앱은 빨리 나오지만, 무엇이 멈추거나 느려졌는지는
            사용자가 연락하거나 리뷰를 남겨야 알게 되는 경우가 많아요. 쉽앤핑은
            기록에서 문제가 보이면 바로 알려 드려서, 그보다 먼저 알아챌 수 있게
            도와요.
          </p>
          <div className="grid">
            {[
              "신청 버튼은 눌렸는데 명단에 저장되지 않았다는 연락을 받았어요.",
              "평소보다 느려진 기능은 직접 써 보기 전에는 눈치채기 어려워요.",
              "새 버전을 배포했는데 정말 고쳐졌는지 궁금해요.",
            ].map((t) => (
              <p className="panel" key={t}>
                {t}
              </p>
            ))}
          </div>
        </section>
        <section>
          <h2>쉽앤핑이 대신 답해 주는 세 가지</h2>
          <div className="grid">
            {[
              ["어디서 막혔나", "모임 신청 20건 중 6건 실패했어요."],
              [
                "평소보다 느려졌나",
                "분석이 평소 1.1초에서 최근 3.4초로 느려졌어요.",
              ],
              ["고쳐졌나", "업데이트 후 분석 15건 모두 평소 속도로 끝났어요."],
            ].map(([q, a]) => (
              <article className="panel" key={q}>
                <h3>{q}</h3>
                <small>이렇게 알려 드려요</small>
                <p>{a}</p>
              </article>
            ))}
          </div>
          <p>
            그래프나 로그를 읽지 않아도 되게, 기능 이름과 평소와의 차이로
            말해요.
          </p>
        </section>
        <section>
          <h2>연결은 세 단계</h2>
          <ol className="step-grid">
            {[
              ["요청문 복사", "앱을 등록하면 연결 요청문을 드려요."],
              [
                "코딩 AI에 붙여넣기",
                "쓰던 코딩 AI 대화창에 붙여넣으면 AI가 기록 전송 코드를 넣어요.",
              ],
              ["배포", "배포하고 앱을 한 번 써 보면 첫 기록이 와요."],
            ].map(([title, detail]) => (
              <li key={title}>
                <strong>{title}</strong>
                <p>{detail}</p>
              </li>
            ))}
          </ol>
        </section>
        <section data-slot="onboarding">
          <h2>연결하면 이렇게 보여요</h2>
          <p>가입부터 앱 홈까지의 예시 화면이에요.</p>
          <div className="flow">
            {[
              ["내 앱", "모임모아", "등록한 앱 1개"],
              ["앱 등록", "앱 이름", "모임모아"],
              ["연결 요청 복사", "첫 기록을 기다리고 있어요", "연결 4단계"],
              ["앱 홈", "모임 신청이 느려졌어요", "평소 1.1초 → 최근 3.4초"],
            ].map(([title, headline, sub]) => (
              <figure key={title}>
                <div className="mini">
                  <strong>{title}</strong>
                  <b>{headline}</b>
                  <small>{sub}</small>
                </div>
                <figcaption>{title}</figcaption>
              </figure>
            ))}
          </div>
        </section>
        <section>
          <h2>알림은 슬랙이나 메일로</h2>
          <div className="even">
            {["슬랙 · #모임모아-알림", "메일 · [쉽앤핑] 모임모아"].map((t) => (
              <article key={t} className="panel">
                <small>{t}</small>
                <h3>분석이 느려졌어요</h3>
                <p>
                  평소 1.1초 → 최근 30분 3.4초 (24건).{" "}
                  {t.startsWith("메일") &&
                    "고친 버전을 배포하면 쉽앤핑이 실제 사용으로 확인해 드려요."}
                </p>
                <span>쉽앤핑에서 보기</span>
              </article>
            ))}
          </div>
          <p>
            문제가 생길 때 한 번, 해결될 때 한 번 보내요. 알림에는 오류 원문이나
            키를 넣지 않아요.
          </p>
        </section>
        <section>
          <h2>지금은 무료 베타예요</h2>
          <p>
            회원당 앱 3개까지 등록할 수 있어요. 입력값, 요청 내용, 쿠키, 토큰
            같은 개인정보는 받지 않아요. Google 또는 이메일 링크로 로그인해요.
            비밀번호를 만들지 않아도 돼요.
          </p>
          {acts}
        </section>
      </main>
      <footer className="landing">
        <small>쉽앤핑 무료 베타</small>
      </footer>
    </>
  );
}
