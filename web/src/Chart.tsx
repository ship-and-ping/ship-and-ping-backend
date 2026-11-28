import { useEffect, useId, useMemo, useState, type PointerEvent } from "react";
import { approximateDuration, formatDuration, summarize, type Stat } from "./monitor-data";
import { periodName } from "./MonitorToolbar";
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

function buckets(rows: Stat[], start: number, now: number, count: number, thresholds?:ReadonlyMap<string,number>) {
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
    const startLabel = width >= day ? weekday : from % hour === 0 ? clock : clockMinute;
    return { label: dateTime.format(from) + " ~ " + endLabel.format(until), startLabel:startLabel.format(from),
      hasRecords:group.length > 0, ...summarize(group,thresholds) };
  });
}
type Bucket = ReturnType<typeof buckets>[number];

function ticks(start: number, now: number, days: number) {
  const step = days < 1 ? hour/4 : days === 1 ? 4*hour : day;
  // Place ticks at Korean clock hours or civil midnights, independent of the query minute.
  const offset = 9 * hour;
  const first = Math.ceil((start + offset) / step) * step - offset;
  const labels = [];
  for (let at = first; at < now; at += step) {
    const left = 100 * (at - start) / (now - start);
    labels.push({ left, label: (days < 1 ? clockMinute : days === 1 ? clock : weekday).format(at) });
  }
  return labels;
}

const percent = (n: number) => n + "%";
const center = (i: number, count: number) => 100 * (i + 0.5) / count;
const height = 100;
const y = (value: number, max: number) => height - height * value / max;
const plotTime = (ms: number) => ms === Infinity ? 30001 : ms;

function lineSegments(values:(number|null)[], ordinate:(n:number) => number, bottom:number) {
  const segments:{line:string; first:number; last:number}[] = [];
  values.forEach((value,i) => {
    if (value === null) return;
    const x = center(i,values.length);
    const coordinate = x+" "+ordinate(value);
    if (!i || values[i-1] === null) segments.push({line:"M"+coordinate,first:x,last:x});
    else {
      const segment = segments[segments.length-1];
      segment.line += " L"+coordinate;
      segment.last = x;
    }
  });
  return segments.filter(s => s.first !== s.last).map(s => ({line:s.line,area:s.line+" L"+s.last+" "+bottom+" L"+s.first+" "+bottom+" Z"}));
}

function verticalTicks(peak: number, duration: boolean, divisions = 5) {
  const required = Math.max(peak / divisions, duration ? 10 : 1);
  const power = 10 ** Math.floor(Math.log10(required));
  const step = [1, 2, 2.5, 5, 10].map(n => n * power)
    .find(n => n >= required && (duration || Number.isInteger(n)))!;
  const count = Math.max(3, Math.ceil(peak / step));
  return Array.from({length:count + 1}, (_, index) => index * step);
}

function DurationMarks({ points, max, baseline, p95, active }: { points: Bucket[]; max: number; baseline: number | null; p95: number | null; active:number | null }) {
  const clip = useId();
  const top = p95 === null ? null : y(plotTime(p95), max);
  const runs = lineSegments(points.map(p => p.median), ms => y(plotTime(ms),max),100);
  return <>
    {baseline !== null && top !== null && <rect className="usual-band" x="0" width="100%"
      y={percent(top)} height={baseline === p95 ? 2 : percent(y(plotTime(baseline),max) - top)} />}
    {baseline !== null && <line className="usual-duration" x1="0" x2="100%"
      y1={percent(y(plotTime(baseline), max))} y2={percent(y(plotTime(baseline), max))} />}
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs><linearGradient id={clip+"-area"} x2="0" y2="1">
        <stop stopColor="var(--sp-chart-time)" stopOpacity=".2"/><stop offset="1" stopColor="var(--sp-chart-time)" stopOpacity=".015"/>
      </linearGradient></defs>
      {runs.map(run => <path key={run.line} d={run.area} fill={`url(#${clip}-area)`}/>)}
      {top !== null && <defs><clipPath id={clip}><rect width="100" height={top} /></clipPath></defs>}
      {runs.map(run => <path key={run.line} className="duration-run" d={run.line} vectorEffect="non-scaling-stroke" />)}
      {top !== null && <g clipPath={`url(#${clip})`}>{runs.map(run =>
        <path key={run.line} className="above-run" d={run.line} vectorEffect="non-scaling-stroke" />)}</g>}
    </svg>
    {points.map(({ median }, i) => median !== null && <circle key={i}
      className={p95 !== null && median > p95 ? "above-range" : undefined}
      cx={percent(center(i, points.length))} cy={percent(y(plotTime(median), max))} r={i === active ? 6 : 3}
      stroke="var(--sp-surface)" strokeWidth="2" />)}
  </>;
}

function CountMarks({ points, max, active }: { points: Bucket[]; max: number; active:number | null }) {
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
      return <g key={i} className={active === null || active === i ? "" : "muted-bar"}>
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

function values(p:Bucket,p95:number|null) {
  return [["사용",p.total+"건"],["실패",p.failures+"건"],["실패율",rate(p.eligible,p.failures)],
    ["보통 시간",approximateDuration(p.median)+(p95 !== null && p.median !== null && p.median > p95 ? " · 평소 범위 초과" : "")],
    ["만족도",p.satisfaction === null ? "기록 없음" : p.satisfaction+"%"]];
}
const rate = (eligible:number,failures:number) => eligible ? Math.round(100*failures/eligible)+"%" : "기록 없음";
function description(p:Bucket,p95:number|null) {
  return p.label + values(p,p95).map(([name,value]) => " · "+name+" "+value).join("");
}
type Cursor = {index:number; owner:string};
type Selection = {
  active:Cursor|null; selected:number; focus:(cursor:Cursor|null) => void; hover:(cursor:Cursor|null) => void;
};

function PanelHelp({title,text}:{title:string; text:string}) {
  const id = useId();
  const [open,setOpen] = useState(false);
  return <span className="panel-help" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
    <button type="button" aria-label={title+" 설명"} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)}
      onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={e => {if (e.key === "Escape") setOpen(false);}}>ⓘ</button>
    {open && <span id={id} role="tooltip">{text}</span>}</span>;
}

function StatPanel({title,help,value,series,unit,selection,points,p95}:{title:string; help:string; value:string; series:(number|null)[];
  unit:"건"|"초"|"%"; selection:Selection; points:Bucket[]; p95:number|null}) {
  const active = selection.active?.index;
  const peak = Math.max(0,...series.map(n => plotTime(n ?? 0)));
  const levels = unit === "%" ? [0,50,100] : verticalTicks(peak,unit === "초",3);
  const max = levels[levels.length-1];
  // Leave room for the selected dot at both ends of the value axis.
  const pointY = (n:number) => 88 - 76 * plotTime(n) / max;
  const runs = lineSegments(series,pointY,pointY(0));
  function reading(index:number) {
    const n = series[index];
    const label = n === null ? "기록 없음" : unit === "초" ? formatDuration(n)
      : Math.round(n).toLocaleString("ko-KR") + unit;
    return points[index].startLabel + " · " + label;
  }
  return <article className="stat-panel">
    <header><h3>{title}</h3><PanelHelp title={title} text={help}/></header>
    <strong className="stat-value">{value}</strong>
    <div className="spark-plot"><svg aria-hidden="true">
      {levels.map(level => <line key={level} className={level === 0 ? "spark-zero" : undefined}
        x1="0" x2="100%" y1={percent(pointY(level))} y2={percent(pointY(level))}
        stroke="var(--sp-line-strong)" strokeDasharray={level === 0 ? undefined : "2 4"}/>)}
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {runs.map(run => <g key={run.line}><path d={run.area} fill="currentColor" opacity=".12"/>
          <path d={run.line} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/></g>)}
      </svg>
      {series.map((n,i) => n !== null && (series[i-1] == null && series[i+1] == null || i === active) &&
        <circle key={i} className={i === active ? "spark-active" : undefined}
          cx={percent(center(i,series.length))} cy={percent(pointY(n))} r={i === active ? 4 : 2.5} fill="currentColor"/>)}
    </svg><CursorTarget owner={title} points={points} selection={selection} p95={p95} reading={reading} crosshair/>
    </div>
    {selection.active?.owner === title && <div className="spark-readout">
      <div role="tooltip" className="flow-tip"><strong>{reading(selection.active.index)}</strong></div>
    </div>}
  </article>;
}

function Plot({ points, labels, duration = false, baseline, p95 = null, samples = 0, summary, learnsRange = true, selection, aggregate }: {
  points: Bucket[]; labels: ReturnType<typeof ticks>; duration?: boolean; baseline: number | null; summary?: string;
  p95?: number | null; samples?: number;
  learnsRange?: boolean;
  selection:Selection; aggregate?:boolean;
}) {
  const id = useId();
  const active = selection.active?.index ?? null;
  const peak = duration
    ? Math.max(plotTime(p95 ?? baseline ?? 0), ...points.map(p => plotTime(p.median ?? 0)))
    : Math.max(...points.map(p => p.total));
  const levels = verticalTicks(peak || (duration ? 1000 : 1), !!duration);
  const max = levels[levels.length - 1];
  const measurements = points.filter(p => p.median !== null);
  const isolatedX = measurements.length === 1 ? center(points.indexOf(measurements[0]), points.length) : null;
  const title = duration ? "걸린 시간" : "사용과 실패";
  return <figure className="flow-figure" aria-labelledby={id}>
    <figcaption><span id={id}>{title}</span><PanelHelp title={title} text={duration ? "성공 요청의 보통 시간을 구간별로 보여줘요." : "각 구간에 사용한 횟수와 결과를 보여줘요."}/></figcaption>
    {summary && <p className="flow-summary">{summary}</p>}
    {duration && p95 === null && <p className="flow-note">{aggregate ? "기능을 고르면 해당 기능의 평소 범위를 볼 수 있어요." : learnsRange ? `평소 범위는 성공 30번 뒤에 생겨요 (지금 ${samples}번)` : "여러 기능을 모은 기타 요청은 평소 범위를 계산하지 않아요."}</p>}
    {(!duration || baseline !== null) && <div className="flow-key">{duration ? <>
      <span className="median-key">보통 시간</span>
      {baseline !== null && p95 !== null && <span className="range-key">평소 범위 · {approximateDuration(baseline)} ~ {approximateDuration(p95)}</span>}
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
          {labels.map(t => <line key={t.label} className="time-grid" x1={percent(t.left)} x2={percent(t.left)} y1="0" y2="100%" />)}
          {duration ? <DurationMarks points={points} max={max} baseline={baseline} p95={p95} active={active} /> : <CountMarks points={points} max={max} active={active}/>}
        </svg>
        <CursorTarget owner={title} points={points} p95={p95} selection={selection} crosshair/>
        {duration && isolatedX !== null && <span className={"isolated-value" + (isolatedX >= 50 ? " on-left" : "")}
          style={{ left: percent(isolatedX),
            top: percent(y(plotTime(measurements[0].median!), max)) }}>{approximateDuration(measurements[0].median)}</span>}
      </div>
      <div className="flow-x">{labels.map(({ left, label }) => <span key={label}
        style={{ left: `clamp(0%, calc(${left}% - var(--tick-width) / 2), calc(100% - var(--tick-width)))` }}>{label}</span>)}</div>
      {selection.active?.owner === title && <div className="plot-readout">
        <CursorTip index={selection.active.index} points={points} p95={p95}/>
      </div>}
    </div>
  </figure>;
}

function CursorTarget({owner,points,p95,selection,crosshair=false,reading}:{owner:string; points:Bucket[]; p95:number|null; selection:Selection; crosshair?:boolean; reading?:(index:number) => string}) {
  const active = selection.active?.index;
  const selected = active ?? selection.selected;
  function select(index:number) {
    selection.hover(null);
    selection.focus({owner,index});
  }
  function pointAt(event:PointerEvent<HTMLDivElement>) {
    const {left,width} = event.currentTarget.getBoundingClientRect();
    return width ? Math.max(0, Math.min(points.length-1, Math.floor((event.clientX-left)*points.length/width))) : selected;
  }
  return <>
    <div role="slider" tabIndex={0} className="flow-hit" aria-label={owner} aria-valuemin={1} aria-valuemax={points.length}
      aria-valuenow={selected+1} aria-valuetext={reading ? reading(selected) : description(points[selected],p95)}
      onFocus={() => select(selected)} onBlur={() => selection.focus(null)}
      onPointerEnter={e => {if (e.pointerType !== "touch") selection.hover({owner,index:pointAt(e)});}}
      onPointerDown={e => {
        if (!e.isPrimary || e.button !== 0) return;
        e.currentTarget.focus({preventScroll:true});
        e.currentTarget.setPointerCapture(e.pointerId);
        select(pointAt(e));
      }}
      onPointerMove={e => {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) select(pointAt(e));
        else if (e.pointerType !== "touch") selection.hover({owner,index:pointAt(e)});
      }}
      onPointerLeave={() => selection.hover(null)}
      onPointerCancel={() => {selection.hover(null); selection.focus(null);}}
      onKeyDown={e => {
        switch(e.key) {
          case "ArrowLeft": select(Math.max(0,selected-1)); break;
          case "ArrowRight": select(Math.min(points.length-1,selected+1)); break;
          case "Home": select(0); break;
          case "End": select(points.length-1); break;
          default: return;
        }
        e.preventDefault();
      }}>
      {crosshair && active !== undefined && <span className="flow-selection" style={{left:percent(center(active,points.length))}}/>}
    </div>
  </>;
}

function CursorTip({index,points,p95}:{index:number; points:Bucket[]; p95:number|null}) {
  const x = center(index,points.length);
  return <div role="tooltip" className="flow-tip"
    style={x < 50 ? {left:`min(calc(${x}% + 8px), 100% - var(--tip-width))`} :
      {right:`min(calc(${100-x}% + 8px), 100% - var(--tip-width))`}}>
    <strong>{points[index].label}</strong>{values(points[index],p95).map(([name,value]) =>
      <span key={name}><span className="tip-label">{" · "+name+" "}</span><em>{value}</em></span>)}</div>;
}

export function Chart({ rows, days, now, baseline, p95 = null, samples, learnsRange = true, thresholds, aggregate }: {
  rows: Stat[]; days: number; now: number; baseline: number | null; p95?: number | null; samples?: number;
  learnsRange?: boolean;
  thresholds?:ReadonlyMap<string,number>; aggregate?:boolean;
}) {
  const start = now - days * day;
  const points = useMemo(() => buckets(rows, start, now, days < 1 ? 12 : days === 1 ? 24 : 7, thresholds),[rows,start,now,days,thresholds]);
  const labels = useMemo(() => ticks(start, now, days),[start,now,days]);
  const period = useMemo(() => summarize(rows.filter(r => Date.parse(r.bucket) >= start && Date.parse(r.bucket) <= now),thresholds),[rows,start,now,thresholds]);
  const [selected,setSelected] = useState(() => Math.max(0,points.findIndex(p => p.total > 0)));
  const [focused,setFocused] = useState<Cursor|null>(null);
  const [hovered,hover] = useState<Cursor|null>(null);
  const active = hovered ?? focused;
  const selection:Selection = {selected,active,hover,focus:cursor => {setFocused(cursor); if (cursor) setSelected(cursor.index);}};
  useEffect(() => {
    function escape(e:KeyboardEvent) { if (e.key === "Escape") {setFocused(null); hover(null);} }
    document.addEventListener("keydown",escape);
    return () => document.removeEventListener("keydown",escape);
  },[]);
  const worst = points.reduce((a, b) => a.failures >= b.failures ? a : b);
  const occupied = points.filter(p => p.total > 0).length;
  const shared = {selection,points,p95};
  return <>
    <p className="flow-range">{dateTime.format(start)} ~ {dateTime.format(now)} · 한국 시간</p>
    <div className="stat-grid">
      <StatPanel {...shared} title="사용 건수" unit="건" help="선택한 기간의 전체 사용 횟수예요." value={period.total.toLocaleString("ko-KR")+"건"} series={points.map(p => p.hasRecords ? p.total : null)}/>
      <StatPanel {...shared} title="실패율" unit="%" help="판정할 수 있는 요청 중 실패한 비율이에요." value={rate(period.eligible,period.failures)} series={points.map(p => p.eligible ? 100*p.failures/p.eligible : null)}/>
      <StatPanel {...shared} title="보통 속도" unit="초" help="성공 요청에 걸린 시간의 중앙값이에요." value={approximateDuration(period.median)} series={points.map(p => p.median)}/>
      {!!thresholds?.size && <StatPanel {...shared} title="만족도" unit="%" help="선택 기간 중 평소 상한 안에 끝난 성공 요청 비율이에요." value={period.satisfaction === null ? "기록 없음" : period.satisfaction+"%"} series={points.map(p => p.satisfaction)}/>}
    </div>
    {occupied <= 3 && <p className="flow-note">{occupied ? "아직 사용 기록이 적어요. 쌓이면 흐름이 보여요." : "이 기간에는 표시할 사용 기록이 없어요."}</p>}
    <div className="flow-plots"><Plot points={points} labels={labels} baseline={null} p95={p95} selection={selection}
      summary={worst.failures ? worst.label + " 구간에 실패 " + worst.failures + "건이 있었어요." : undefined} />
    <Plot points={points} labels={labels} duration baseline={baseline} p95={p95} samples={samples} learnsRange={learnsRange} selection={selection} aggregate={aggregate}
      summary={period.median === null ? "선택한 기간에 걸린 시간 측정값이 없어요." : "선택한 기간 보통 " + approximateDuration(period.median)} /></div>
    <details><summary>표로 보기</summary>
      <table><caption>최근 {periodName(days)} 기록</caption>
        <thead><tr>{["시간 구간", "사용", "실패", "보통 시간"].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{points.map(p => <tr key={p.label}><th scope="row">{p.label}</th>
          <td>{p.total}</td><td>{p.failures}</td><td>{approximateDuration(p.median)}</td></tr>)}</tbody>
      </table>
    </details>
  </>;
}
