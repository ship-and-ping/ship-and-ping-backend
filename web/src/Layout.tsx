import {
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { Sheep } from "./Sheep";
export { Landing } from "./Landing";
import { displayText } from "./normalize";
import mark from "./assets/wordmark.png";
import "./styles/layout.css";

type AppHeading = { id: string; name: string; issues?: number };
export const CurrentAppName = createContext<(heading: AppHeading) => void>(
  () => {},
);

export function LoadingRows({ children }: { children: ReactNode }) {
  return <section className="monitor-loading" role="status">
    {children}
    <div aria-hidden="true" /><div aria-hidden="true" />
  </section>;
}

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
