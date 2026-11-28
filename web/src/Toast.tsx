import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Notice = { kind: "success" | "info" | "problem"; title: string; detail?: string };
type VisibleNotice = Notice & { id: number; revision: number };
const ToastContext = createContext<(notice: Notice) => void>(() => {});
export const useToast = () => useContext(ToastContext);
const icons = {
  success: "m5 12 4 4L19 6",
  info: "M12 11v6m0-11v1",
  problem: "M12 6v7m0 3v1",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<VisibleNotice[]>([]);
  const sequence = useRef(0);
  const show = useCallback((notice: Notice) => {
    const revision = ++sequence.current;
    setNotices(items => {
      const match = items.find(item => item.kind === notice.kind && item.title === notice.title && item.detail === notice.detail);
      if (match) return items.map(item => item === match ? { ...item, revision } : item);
      return [...items.slice(-2), { ...notice, id: revision, revision }];
    });
  }, []);
  const remove = useCallback((revision: number) => {
    setNotices(items => items.filter(item => item.revision !== revision));
  }, []);
  return <ToastContext.Provider value={show}>
    {children}
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
      {notices.map(notice => <Toast key={notice.id} notice={notice} remove={remove}/>)}
    </div>
  </ToastContext.Provider>;
}

function Toast({ notice, remove }: { notice: VisibleNotice; remove: (revision: number) => void }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [closingRevision, setClosingRevision] = useState<number>();
  const closing = closingRevision === notice.revision;
  const remaining = useRef(4500);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const paused = hover || focus;
  useEffect(() => { remaining.current = 4500; }, [notice.revision]);
  useEffect(() => {
    if (closing) {
      const exit = window.setTimeout(() => remove(notice.revision), 160);
      return () => window.clearTimeout(exit);
    }
    if (paused) return;
    const start = Date.now();
    const timer = window.setTimeout(() => setClosingRevision(notice.revision), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - start));
    };
  }, [paused, closing, notice.revision, remove]);

  return <div className="toast-entry"><article className="toast" data-kind={notice.kind} data-closing={closing}
    onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    onTouchStart={event => {
      const point = event.touches[0];
      touch.current = event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null;
    }}
    onTouchCancel={() => { touch.current = null; }}
    onTouchEnd={event => {
      const start = touch.current;
      touch.current = null;
      if (!start) return;
      const point = event.changedTouches[0];
      const dx = Math.abs(point.clientX - start.x);
      if (dx >= 56 && dx > 2 * Math.abs(point.clientY - start.y)) setClosingRevision(notice.revision);
    }}>
    <svg className="toast-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={icons[notice.kind]}/>
    </svg>
    <div><strong>{notice.title}</strong>{notice.detail && <p>{notice.detail}</p>}</div>
    <button type="button" className="toast-close" onClick={() => setClosingRevision(notice.revision)} aria-label="안내 닫기">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </button>
  </article></div>;
}
