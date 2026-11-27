import { compareVersions, satisfaction } from "./insights";
import { displayVersion } from "./issue-prompt";
import { approximateDuration, type Monitor } from "./monitor-data";
import { displayText } from "./normalize";

export function SpeedInsights({data, featureId}: {data:Monitor; featureId?:string}) {
  const features = new Map(data.features.filter(f => !f.hidden).map(f => [f.id, f]));
  const rows = (data.insights ?? []).filter(r => features.has(r.feature_id) && (!featureId || r.feature_id === featureId));
  const speed = satisfaction(rows);
  const changes = rows.flatMap(row => {
    const change = compareVersions(row);
    return change && (featureId || ["faster","slower"].includes(change.direction)) ? [{...change, id:row.feature_id}] : [];
  });
  const change = changes.sort((a,b) => b.ratio - a.ratio)[0];
  if (!speed && !change) return null;
  const factor = change && Number.isFinite(change.ratio) ? change.ratio.toLocaleString("ko-KR",{maximumFractionDigits:1}) + "배 " : "";
  return <div className="speed-insights">
    {speed && <div>
      {speed.percent !== null && <p>최근 1시간 성공 요청의 <strong>{speed.percent}%</strong>가 평소처럼 빨랐어요</p>}
      <small>평소 범위가 있는 기능 기준 · 느림 {speed.slow}건 / 실패 {speed.failures}건</small>
    </div>}
    {change && <div>
      <small>{featureId ? "버전별 보통 시간" : displayText(features.get(change.id)!.name) + " · 가장 큰 변화"}
        {data.versions.length >= 2 && <> · {displayVersion(data.versions[1].version)} → {displayVersion(data.versions[0].version)}</>}</small>
      <p>업데이트 후 {approximateDuration(change.before)} → {approximateDuration(change.after)},{' '}
        <strong className={"speed-" + change.direction}><span aria-hidden="true">{change.direction === "faster" ? "↗" : change.direction === "slower" ? "↘" : "≈"}</span>{' '}
          {change.direction === "similar" ? "비슷해요" : factor + (change.direction === "faster" ? "빨라졌어요" : "느려졌어요")}</strong></p>
    </div>}
  </div>;
}
