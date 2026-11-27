import { useEffect, useState } from "react";

export const periodName = (days:number) => days === 7 ? "7일" : days === 1 ? "24시간" : "1시간";

export function MonitorToolbar({days, onPeriod, interval, onInterval, refresh, busy, updated}: {
  days:number; onPeriod:(days:number) => void; interval:number; onInterval:(seconds:number) => void;
  refresh:() => void; busy:boolean; updated:number;
}) {
  const [clock,setClock] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setClock(Date.now()),1000);
    return () => window.clearInterval(tick);
  }, []);
  return <div className="monitor-toolbar">
    <div className="range-control" role="group" aria-label="조회 기간">
      {[1/24,1,7].map(n => <button key={n} disabled={busy} aria-pressed={days === n}
        onClick={() => onPeriod(n)}>{periodName(n)}</button>)}
    </div>
    <button className="refresh-button" onClick={refresh} disabled={busy} aria-busy={busy} aria-label="새로고침">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 5v6h-6M4 19v-6h6M5.2 9a7 7 0 0 1 11.6-3L20 10M4 14l3.2 4A7 7 0 0 0 19 15"/>
      </svg><span>새로고침</span>
    </button>
    <label className="auto-control">자동 <select aria-label="자동 새로고침" value={interval} onChange={e => onInterval(Number(e.target.value))}>
      <option value={0}>끔</option><option value={30}>30초</option><option value={60}>1분</option><option value={300}>5분</option>
    </select></label>
    <small className="refresh-age">마지막 갱신 {Math.max(0,Math.floor((clock-updated)/1000))}초 전</small>
  </div>;
}
