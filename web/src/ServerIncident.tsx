import {useState} from "react";
import {serverMetrics,formatMetric,type ServerContext} from "./server-data";
import type {Incident} from "./monitor-data";
import {StatusBadge} from "./IncidentSummary";

export function IncidentServerSummary({context}:{context?:ServerContext}) {
  const metrics = serverMetrics.flatMap(([key,label,unit]) => {
    const value = context?.peaks?.[key];
    return value == null ? [] : [<div key={key}><dt>{label}</dt><dd>{formatMetric(value,unit)}</dd></div>];
  });
  return <section className="panel"><h2>사건 구간 서버 기록</h2>{metrics.length
    ? <><p>감지 구간부터 해결 시각 또는 현재까지 측정한 최댓값이에요.</p><dl>{metrics}</dl></>
    : <p>이 구간에 받은 서버 지표가 없어요.</p>}</section>;
}
export function SilentIssue({issue,context,dismiss}:{issue:Incident; context?:ServerContext; dismiss:()=>Promise<void>}) {
  const [error,setError] = useState(false);
  return <><h1 tabIndex={-1}>기록이 끊겼어요</h1><section className="panel">
    <StatusBadge state={issue.status}/><p>평소 기록이 오던 시간에 10분 이상 앱 기록이 도착하지 않았어요.</p>
    <p>감지 시각 · {new Date(issue.opened_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</p>
    {issue.status === "resolved" && <p>기록 전송이 재개됐어요.</p>}
    {issue.status === "open" && <button onClick={() => dismiss().catch(() => setError(true))}>문제 아님으로 닫기</button>}
    {error && <p role="alert">문제를 닫지 못했어요.</p>}
  </section><IncidentServerSummary context={context}/></>;
}
