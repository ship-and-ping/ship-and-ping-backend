import {
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { Sheep } from "./Sheep";
import { LogoutButton } from "./LogoutButton";
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
  const { pathname } = useLocation();
  return (
    <header className="bar">
      <Brand />
      <nav aria-label="시작 메뉴">
        {pathname === "/login"
          ? <Link to="/signup">회원 가입</Link>
          : <Link to="/login">로그인</Link>}
      </nav>
    </header>
  );
}
export function Shell({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: (deviceOnly?: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { pathname, hash: currentHash } = useLocation();
  const appPath = pathname.match(/^\/apps\/([^/]+)(?:\/(?:features\/[^/]+|issues\/[^/]+|notifications))?\/?$/);
  const dashboard = appPath && !["new","notifications"].includes(appPath[1]) && !pathname.endsWith("/features/deep");
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
      className={"shell" + (dashboard ? " dashboard-shell" : "")}
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
          <LogoutButton logout={onLogout} />
        </nav>
      </aside>
      {dashboard && <nav className="dashboard-tabs" aria-label="대시보드 메뉴">
        {[
          ["앱 홈", "", "M3 10 12 3l9 7v10h-6v-6H9v6H3Z"],
          ["기능 목록", "#features", "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z"],
          ["문제" + (heading?.id === appPath[1] && heading.issues != null ? " "+heading.issues+"개" : ""), "#issues", "M12 3 2 21h20Z M12 9v5m0 2v1"],
          ["알림 설정", "/notifications", "M5 16h14l-2-3V9a5 5 0 0 0-10 0v4Z M10 20h4"],
        ].map(([label,suffix,icon]) => {
          const base = "/apps/" + appPath[1];
          const current = pathname + currentHash === base + suffix ||
            (suffix.startsWith("#") && pathname.startsWith(base + "/" + suffix.slice(1) + "/"));
          return <Link key={label} to={base + suffix} aria-current={current ? "page" : undefined} onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={icon}/></svg>{label}</Link>;
        })}
      </nav>}
      <main id="main" className="workspace">
        <CurrentAppName.Provider value={setHeading}>
          {children}
        </CurrentAppName.Provider>
      </main>
    </div>
  );
}
