import { Link } from "react-router-dom";

export const status = {
  open: "진행 중",
  resolved: "해결됐어요",
  quiet: "잠잠해졌어요",
  dismissed: "문제 아님으로 닫았어요",
};
export function StatusBadge({ state }: { state: keyof typeof status | "healthy" | "waiting" }) {
  const icons = { open: "⚠", resolved: "✓", quiet: "◷", dismissed: "−", healthy: "✓", waiting: "◷" };
  const label = state === "healthy" ? "정상" : state === "waiting" ? "기록 대기" : status[state];
  return <span className={"status-badge " + state}><span aria-hidden="true">{icons[state]}</span> {label}</span>;
}

export function IssueListItem({ summary, state, metric, href, onOpen }: {
  summary: string; state: keyof typeof status; metric: string; href?: string; onOpen?: () => void;
}) {
  const label = <>{summary} <StatusBadge state={state} /></>;
  return <div className="issue-list-item">
    {href ? <Link to={href}>{label}</Link> : <button className="secondary" onClick={onOpen}>{label}</button>}
    <small className="issue-metric">{metric}</small>
  </div>;
}

export function Timeline({ events }: { events: { at: string; text: string; date: string }[] }) {
  return (
    <ol className="timeline">
      {events.map((event, index) => (
        <li key={index}>
          <time dateTime={event.at}>{event.date}</time>
          <strong>{event.text}</strong>
        </li>
      ))}
    </ol>
  );
}
