import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Notice = { kind: "success" | "info" | "problem"; title: string; detail?: string };
const ToastContext = createContext<(notice: Notice) => void>(() => {});
export const useToast = () => useContext(ToastContext);
const icons = {
  success: "m5 12 4 4L19 6",
  info: "M12 11v6m0-11v1",
  problem: "M12 6v7m0 3v1",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(Notice & { id: number }) | null>(null);
  const sequence = useRef(0);
  const show = useCallback((notice: Notice) => {
    setCurrent({ ...notice, id: ++sequence.current });
  }, []);
  const remove = useCallback((id: number) => {
    setCurrent(value => value?.id === id ? null : value);
  }, []);
  return <ToastContext.Provider value={show}>
    {children}
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {current && <Toast key={current.id} notice={current} remove={remove}/>}
    </div>
  </ToastContext.Provider>;
}

function Toast({ notice, remove }: { notice: Notice & { id: number }; remove: (id: number) => void }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [closing, setClosing] = useState(false);
  const remaining = useRef(4500);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const paused = hover || focus;
  useEffect(() => {
    if (closing) {
      const exit = window.setTimeout(() => remove(notice.id), 160);
      return () => window.clearTimeout(exit);
    }
    if (paused) return;
    const start = Date.now();
    const timer = window.setTimeout(() => setClosing(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - start));
    };
  }, [paused, closing, notice.id, remove]);

  return <article className="toast" data-kind={notice.kind} data-closing={closing}
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
      if (dx >= 56 && dx > 2 * Math.abs(point.clientY - start.y)) setClosing(true);
    }}>
    <svg className="toast-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={icons[notice.kind]}/>
    </svg>
    <div><strong>{notice.title}</strong>{notice.detail && <p>{notice.detail}</p>}</div>
    <button type="button" className="toast-close" onClick={() => setClosing(true)} aria-label="안내 닫기">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </button>
  </article>;
}
