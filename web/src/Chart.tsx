import { useEffect, useId, useState, type PointerEvent } from "react";
import { formatDuration, summarize, type Stat } from "./monitor-data";
import "./styles/chart.css";

const hour = 3600000;
const day = 24 * hour;
function koreanDate(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...options });
}
const dateTime = koreanDate({ month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const clockMinute = koreanDate({ hour: "numeric", minute: "2-digit" });
const clock = koreanDate({ hour: "numeric" });
const weekday = koreanDate({ month: "short", day: "numeric", weekday: "short" });

function buckets(rows: Stat[], start: number, now: number, count: number) {
  const width = (now - start) / count;
  const groups = Array.from({ length: count }, (): Stat[] => []);
  for (const row of rows) {
    const at = Date.parse(row.bucket);
    if (at >= start && at <= now) groups[Math.min(count - 1, Math.floor((at - start) / width))].push(row);
  }
  return groups.map((group, i) => {
    const from = start + i * width;
    const until = from + width;
    const endLabel = weekday.format(from) === weekday.format(until) ? clockMinute : dateTime;
    return { label: dateTime.format(from) + " ~ " + endLabel.format(until), ...summarize(group) };
  });
}
type Bucket = ReturnType<typeof buckets>[number];

function ticks(start: number, now: number, hourly: boolean) {
  const step = hourly ? 4 * hour : day;
  // Place ticks at Korean clock hours or civil midnights, independent of the query minute.
  const offset = 9 * hour;
  const first = Math.ceil((start + offset) / step) * step - offset;
  const labels = [];
  for (let at = first; at < now; at += step) {
    const left = 100 * (at - start) / (now - start);
    labels.push({ left, label: (hourly ? clock : weekday).format(at) });
  }
  return labels;
}

const percent = (n: number) => n + "%";
const center = (i: number, count: number) => 100 * (i + 0.5) / count;
const height = 100;
const y = (value: number, max: number) => height - height * value / max;
const plotTime = (ms: number) => ms === Infinity ? 30001 : ms;

function verticalTicks(peak: number, duration: boolean) {
  const required = Math.max(peak / 5, duration ? 10 : 1);
  const power = 10 ** Math.floor(Math.log10(required));
  const step = [1, 2, 2.5, 5, 10].map(n => n * power)
    .find(n => n >= required && (duration || Number.isInteger(n)))!;
  const count = Math.max(3, Math.ceil(peak / step));
  return Array.from({length:count + 1}, (_, index) => index * step);
}

function DurationMarks({ points, max, baseline }: { points: Bucket[]; max: number; baseline: number | null }) {
  const runs: string[][] = [];
  points.forEach(({ median }, i) => {
    if (median === null) return;
    if (i === 0 || points[i - 1].median === null) runs.push([]);
    const run = runs[runs.length - 1];
    run.push((run.length ? "L" : "M") + center(i, points.length) + " " + y(plotTime(median), max));
  });
  return <>
    {baseline !== null && <line className="usual-duration" x1="0" x2="100%"
      y1={percent(y(plotTime(baseline), max))} y2={percent(y(plotTime(baseline), max))} />}
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      {runs.filter(run => run.length > 1).map(run =>
        <path key={run[0]} className="duration-run" d={run.join(" ")} vectorEffect="non-scaling-stroke" />)}
    </svg>
    {points.map(({ median }, i) => median !== null && <circle key={i}
      cx={percent(center(i, points.length))} cy={percent(y(plotTime(median), max))} r="5"
      stroke="var(--sp-surface)" strokeWidth="2" />)}
  </>;
}

function CountMarks({ points, max }: { points: Bucket[]; max: number }) {
  const stripes = useId();
  const slot = 100 / points.length;
  return <>
    <defs><pattern id={stripes} width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="var(--sp-chart-failure)" />
      <path d="M-1 1L1 -1 M0 6L6 0 M5 7L7 5" stroke="var(--sp-surface)" />
    </pattern></defs>
    {points.map((p, i) => {
      const left = `calc(${percent(i * slot)} + 1px)`;
      const width = `calc(${percent(slot)} - 2px)`;
      const excluded = p.total - p.eligible;
      return <g key={i}>
        {p.failures > 0 && <rect x={percent(i * slot)} width={percent(slot)} height="100%" fill="var(--sp-bad-soft)" />}
        <rect x={left} width={width} y={percent(y(p.successes, max))} height={percent(100 * p.successes / max)} fill="var(--sp-chart)" />
        <rect x={left} width={width} y={percent(y(p.eligible, max))} height={percent(100 * p.failures / max)} fill={`url(#${stripes})`} />
        {excluded > 0 && <rect x={left} width={width} y={percent(y(p.total, max))} height={percent(100 * excluded / max)} fill="var(--sp-line-strong)" />}
        {p.successes > 0 && p.failures > 0 && <rect x={left} width={width} y={percent(y(p.successes, max))}
          height={`min(2px, ${percent(50 * p.successes / max)})`} fill="var(--sp-surface)" />}
        {p.eligible > 0 && excluded > 0 && <rect x={left} width={width} y={percent(y(p.eligible, max))}
          height={`min(2px, ${percent(50 * (p.failures || p.successes) / max)})`} fill="var(--sp-surface)" />}
      </g>;
    })}
  </>;
}

function description(p: Bucket) {
  return p.label + " · 사용 " + p.total + "건 · 실패 " + p.failures + "건 · 보통 시간 " + formatDuration(p.median);
}

function Plot({ points, labels, duration, baseline, summary }: {
  points: Bucket[]; labels: ReturnType<typeof ticks>; duration?: boolean; baseline: number | null; summary?: string;
}) {
  const id = useId();
  const [selected, setSelected] = useState(() => Math.max(0,
    points.findIndex(p => duration ? p.median !== null : p.total > 0)));
  const [showSelection, setShowSelection] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? (showSelection ? selected : null);
  const tooltipVisible = active !== null;
  useEffect(() => {
    if (!tooltipVisible) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setHovered(null);
      setShowSelection(false);
    }
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [tooltipVisible]);
  function pointAt(event: PointerEvent<HTMLDivElement>) {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - left) / width * points.length);
    return Math.max(0, Math.min(points.length - 1, index));
  }
  function select(index: number) {
    setSelected(index);
    setHovered(null);
    setShowSelection(true);
  }
  const peak = duration
    ? Math.max(plotTime(baseline ?? 0), ...points.map(p => plotTime(p.median ?? 0)))
    : Math.max(...points.map(p => p.total));
  const levels = verticalTicks(peak || (duration ? 1000 : 1), !!duration);
  const max = levels[levels.length - 1];
  const measurements = points.filter(p => p.median !== null);
  const isolatedX = measurements.length === 1 ? center(points.indexOf(measurements[0]), points.length) : null;
  const title = duration ? "걸린 시간" : "사용과 실패";
  return <figure className="flow-figure" aria-labelledby={id}>
    <figcaption id={id}>{title}</figcaption>
    {summary && <p className="flow-summary">{summary}</p>}
    {(!duration || baseline !== null) && <div className="flow-key">{duration ? <>
      <span className="median-key">보통 시간</span>
      {baseline !== null && <span className="baseline-key">평소 {formatDuration(baseline)}</span>}
    </> : <>
      <span className="success-key">성공</span><span className="failure-key">실패</span>
      {points.some(p => p.total > p.eligible) && <span className="excluded-key">판정 제외</span>}
    </>}</div>}
    <div className="flow-coordinates">
      <div className="flow-y">{levels.map(level => <span key={level} style={{top:percent(y(level,max))}}>
        {duration ? (level / 1000).toLocaleString("ko-KR",{maximumFractionDigits:3}) + "초" : level.toLocaleString("ko-KR") + "건"}
      </span>)}</div>
      <div className="flow-plot">
        <svg className="flow-marks" aria-hidden="true">
          {levels.slice(1).map(level => <line key={level} x1="0" x2="100%" y1={percent(y(level,max))} y2={percent(y(level,max))}
            stroke="var(--sp-line-strong)" strokeDasharray="2 4" />)}
          {duration ? <DurationMarks points={points} max={max} baseline={baseline} /> : <CountMarks points={points} max={max} />}
        </svg>
        <div role="slider" tabIndex={0} className="flow-hit" aria-labelledby={id}
          aria-valuemin={1} aria-valuemax={points.length} aria-valuenow={selected + 1} aria-valuetext={description(points[selected])}
          onFocus={() => setShowSelection(true)} onBlur={() => setShowSelection(false)}
          onPointerEnter={e => { if (e.pointerType !== "touch") setHovered(pointAt(e)); }}
          onPointerDown={e => {
            if (!e.isPrimary || e.button !== 0) return;
            e.currentTarget.focus({ preventScroll: true });
            e.currentTarget.setPointerCapture(e.pointerId);
            select(pointAt(e));
          }}
          onPointerMove={e => {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) select(pointAt(e));
            else if (e.pointerType !== "touch") setHovered(pointAt(e));
          }}
          onPointerLeave={() => setHovered(null)}
          onKeyDown={e => {
            switch (e.key) {
              case "ArrowLeft": select(Math.max(0, selected - 1)); break;
              case "ArrowRight": select(Math.min(points.length - 1, selected + 1)); break;
              case "Home": select(0); break;
              case "End": select(points.length - 1); break;
              default: return;
            }
            e.preventDefault();
          }}>
          {active !== null && <span className="flow-selection" style={{ left: percent(active * 100 / points.length),
            width: percent(100 / points.length) }} />}
        </div>
        {duration && isolatedX !== null && <span className={"isolated-value" + (isolatedX >= 50 ? " on-left" : "")}
          style={{ left: percent(isolatedX),
            top: percent(y(plotTime(measurements[0].median!), max)) }}>{formatDuration(measurements[0].median)}</span>}
        {active !== null && <div role="tooltip" className="flow-tip" id={id + "-tip"}>{description(points[active])}</div>}
      </div>
      <div className="flow-x">{labels.map(({ left, label }) => <span key={label}
        style={{ left: `clamp(0%, calc(${left}% - var(--tick-width) / 2), calc(100% - var(--tick-width)))` }}>{label}</span>)}</div>
    </div>
  </figure>;
}

export function Chart({ rows, days, now, baseline }: { rows: Stat[]; days: number; now: number; baseline: number | null }) {
  const start = now - days * day;
  const hourly = days === 1;
  const points = buckets(rows, start, now, hourly ? 24 : 7);
  const labels = ticks(start, now, hourly);
  const period = summarize(rows.filter(r => Date.parse(r.bucket) >= start && Date.parse(r.bucket) <= now));
  const worst = points.reduce((a, b) => a.failures >= b.failures ? a : b);
  const occupied = points.filter(p => p.total > 0).length;
  return <>
    <p className="flow-range">{dateTime.format(start)} ~ {dateTime.format(now)} · 한국 시간</p>
    {occupied <= 3 && <p className="flow-note">{occupied ? "아직 사용 기록이 적어요. 쌓이면 흐름이 보여요." : "이 기간에는 표시할 사용 기록이 없어요."}</p>}
    <div className="flow-plots"><Plot points={points} labels={labels} baseline={null}
      summary={worst.failures ? worst.label + " 구간에 실패 " + worst.failures + "건이 있었어요." : undefined} />
    <Plot points={points} labels={labels} duration baseline={baseline}
      summary={period.median === null ? "선택한 기간에 걸린 시간 측정값이 없어요." : "선택한 기간 보통 " + formatDuration(period.median)} /></div>
    <details><summary>표로 보기</summary>
      <table><caption>최근 {hourly ? "24시간" : "7일"} 기록</caption>
        <thead><tr>{["시간 구간", "사용", "실패", "보통 시간"].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{points.map(p => <tr key={p.label}><th scope="row">{p.label}</th>
          <td>{p.total}</td><td>{p.failures}</td><td>{formatDuration(p.median)}</td></tr>)}</tbody>
      </table>
    </details>
  </>;
}
