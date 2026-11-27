import {
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { Sheep } from "./Sheep";
import { StatusBadge, Timeline, IssueListItem } from "./IncidentSummary";
import { displayText } from "./normalize";
import mark from "./assets/wordmark.png";
import "./styles/layout.css";

type AppHeading = { id: string; name: string; issues?: number };
export const CurrentAppName = createContext<(heading: AppHeading) => void>(
  () => {},
);

export function Hero({
  title,
  detail,
  arrived = false,
  showSheep = true,
  badge,
  mood = "neutral",
}: {
  title: string;
  detail: string;
  arrived?: boolean;
  showSheep?: boolean;
  badge?: ReactNode;
  mood?: "neutral" | "waiting" | "worried" | "relieved";
}) {
  const [transition, setTransition] = useState({ arrived, animate: false });
  if (transition.arrived !== arrived) {
    setTransition({ arrived, animate: arrived });
  }
  return (
    <section className={"hero-card" + (transition.animate ? " arrived" : "")} data-mood={mood}>
      {showSheep && <Sheep />}
      {badge}
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
        <Link to="/account" aria-label="내 계정"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></Link>
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
          <Link onClick={() => setOpen(false)} to={currentName && heading ? "/apps/"+heading.id+"/notifications" : "/apps/notifications"} aria-current={pathname.endsWith("/notifications") ? "page" : undefined}>알림 설정</Link>
          {currentName && heading && <Link to={"/apps/"+heading.id+"/settings"} aria-current={pathname.endsWith("/settings")?"page":undefined} onClick={()=>setOpen(false)}>앱 설정</Link>}
          <Link to="/account" aria-current={pathname==="/account"?"page":undefined} onClick={()=>setOpen(false)}>내 계정</Link>
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
  const landing = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<"앱 홈" | "문제 상세">("앱 홈");
  useEffect(() => {
    if (!landing.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in-view");
        observer.unobserve(entry.target);
      }
    });
    landing.current.querySelectorAll(":scope > section:not(.intro)").forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);
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
      <main ref={landing} id="main" className="landing">
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
        <section className="review-story">
          <div><h2>나쁜 리뷰로 먼저 알게 되면 늦어요</h2>
            <p>쉽앤핑은 사용자가 연락하기 전에 기록에서 문제를 찾아요.</p>
          </div>
          <blockquote>“신청 버튼을 눌렀는데 명단에 제 이름이 없어요.”</blockquote>
        </section>
        <section className="answers">
          <h2>쉽앤핑이 대신 답해 주는 세 가지</h2>
          <dl>
            <div><dt>어디서 막혔나</dt><dd>모임 신청 <strong>20건 중 6건</strong> 실패했어요.</dd></div>
            <div><dt>평소보다 느려졌나</dt><dd>분석 시간이 <strong>1.1초 → 3.4초</strong>로 늘었어요.</dd></div>
            <div><dt>고쳐졌나</dt><dd>업데이트 후 <strong>15건 모두</strong> 평소 속도로 끝났어요.</dd></div>
          </dl>
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
          <div className="product-example" role="region" aria-label="예시 화면">
            <div className="example-bar"><strong>모임모아</strong>
              <div className="example-tabs">{(["앱 홈", "문제 상세"] as const).map(name =>
                <button key={name} aria-pressed={preview === name} onClick={() => setPreview(name)}>{name}</button>)}</div>
            </div>
            <Hero title={preview === "앱 홈" ? "모임 신청에서 실패가 늘었어요" : "모임 신청 20건 중 6건 실패"}
              mood="worried" showSheep={false} badge={<StatusBadge state="open" />}
              detail={preview === "앱 홈" ? "최근 30분 동안 실패가 6건 있었어요." : "감지 구간 · 최근 30분"} />
            {preview === "앱 홈" ? <div className="example-row"><h3>문제</h3>
              <IssueListItem summary="모임 신청에서 실패가 늘었어요" state="open"
                metric="최근 30분 20건 중 실패 6건" onOpen={() => setPreview("문제 상세")} /></div> :
              <div className="example-row"><h3>지금까지 흐름</h3>
                <Timeline events={[{at:"2026-11-25T18:00:00+09:00", date:"오후 6:00", text:"버전 1.0에서 처음 감지했어요"}]} /></div>}
          </div>
        </section>
        <section className="alert-examples">
          <div className="section-heading"><Sheep /><h2>알림은 슬랙이나 메일로</h2></div>
          <div className="even">
            <article className="message-example"><header># 모임모아-알림</header>
              <div><strong>쉽앤핑</strong> <small>앱 · 오후 6:00</small>
                <blockquote><strong>분석이 느려졌어요</strong>
                  <p>평소 1.1초 → 최근 30분 3.4초 (24건)</p></blockquote></div>
            </article>
            <article className="message-example"><header>받은 메일함</header>
              <div><h3>[쉽앤핑] 모임모아 · 분석이 느려졌어요</h3>
                <small>보낸 사람　쉽앤핑</small><hr />
                <p>최근 분석 24건이 평소보다 오래 걸렸어요. 고친 버전을 배포하면 실제 사용으로 확인해 드려요.</p></div>
            </article>
          </div>
          <p>문제가 생길 때 한 번, 해결될 때 한 번 보내요. 알림에는 오류 원문이나 키를 넣지 않아요.</p>
        </section>
        <section>
          <div className="section-heading" data-mood="relieved"><Sheep /><h2>지금은 무료 베타예요</h2></div>
          <p>
            회원당 앱 3개까지 등록할 수 있어요. 입력값, 요청 내용, 쿠키, 토큰
            같은 개인정보는 받지 않아요. 이메일과 비밀번호, 또는 메일 링크로 로그인해요.
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
