import { expect, it } from "vitest";
import { buildIssuePrompt } from "./issue-prompt";
import { concurrentIssues, type Incident } from "./monitor-data";

const started = "2026-11-27T14:20:00Z";
const opened = "2026-11-27T14:21:05Z";
const context = {
  slow_start: started, usual_rpm: 1, incident_rpm: 1000,
  client_errors: 1, server_errors: 0, related_server_errors: 3,
};
const issue = {
  id: "place", feature_id: "place", kind: "slow", opened_at: opened, opened_version: "v1.0.0",
  closed_at: "2026-11-27T14:35:00Z", status: "quiet", resolved_version: null,
  metric_at_open: { baseline: 70, p50: 600 }, metric_worst: { p50: 1200 }, notifications: [],
} satisfies Incident;
const peers = [
  { ...issue, id: "bookmark", feature_id: "bookmark", opened_at: "2026-11-27T14:10:00Z" },
  { ...issue, id: "trip", feature_id: "trip", opened_at: "2026-11-27T14:30:00Z" },
  { ...issue, id: "late", feature_id: "late", opened_at: "2026-11-27T14:30:01Z" },
];
const names = [{ id: "bookmark", name: "북마크" }, { id: "trip", name: "여행" }];
const base = { feature: "장소", route: "/place", versions: ["a12b3cd"], opened, kind: issue.kind,
  closed: issue.closed_at, context, baseline: 70, p50: 600, worst: 1200,
  errors: [
    { at: "2026-11-27T14:38:00Z", error_kind: "UNAUTHORIZED", message: null },
    { at: "2026-11-27T14:31:00Z", error_kind: "HTTP_403", message: null },
    { at: "2026-11-27T14:09:59Z", error_kind: "EarlyError", message: null },
  ],
};

it("트루바의 두 시각·분당 부하·동시 장애·HTTP 근거가 복사된다", () => {
  const related = concurrentIssues(issue, started, [issue, ...peers], names);
  const {text, lines} = buildIssuePrompt({ ...base, related });
  expect(lines).toEqual([]);
  expect(text.split("===== 데이터 끝 =====")[0].split("\n").filter(line => /첫 느린|쉽앤핑 감지|분당 요청|동시 장애|^- |4xx|5xx/.test(line))).toEqual([
    "첫 느린 5분 구간 시작 11/27 23:20 KST · 쉽앤핑 감지 11/27 23:21:05 KST",
    "앱 분당 요청(평소는 직전 7일의 장애 구간 제외): 평소 1건 → 사건 중 1,000건 (1,000배)",
    "동시 장애 (시작 ±10분, 다른 기능):",
    "- 북마크 · 느림 · 평소 0.07초 → 감지 0.6초 · 최악 1.2초",
    "- 여행 · 느림 · 평소 0.07초 → 감지 0.6초 · 최악 1.2초",
    "이 기능 5xx 0건 · 같이 느려진 기능 포함 5xx 3건",
    "이 기능 관련 없을 가능성 높은 4xx 1건",
  ]);
  expect(text).toContain("CPU·메모리·steal·DB 연결·스레드");
  expect(text).toContain("클라이언트 시간 초과");
  expect(text).toContain("app_version");
});

it("단일 기능과 희소한 평소 기록에서 배수를 단정하지 않는다", () => {
  const {text} = buildIssuePrompt({ ...base, related: [], context: { ...context, usual_rpm: 0.001 } });
  expect(text).toContain("평소 거의 없음");
  expect(text).not.toContain("배)");
  expect(text).toContain("이 기능의 코드와 최근 배포부터");
  expect(text).not.toContain("같이 느려진 기능 포함");
});

it("동시 장애 기능 중 HTTP 상태를 모르는 기능이 있으면 합계를 최소 건수로 표시한다", () => {
  const related = concurrentIssues(issue, started, peers, names);
  const {text} = buildIssuePrompt({ ...base, related, context: { ...context, related_server_partial: true } });
  expect(text).toContain("이 기능 5xx 0건 · 같이 느려진 기능 포함 5xx 최소 3건 (전체 건수 미확인)");
});

it("느림 원인 후보는 4xx를 먼저 거른 뒤 최대 다섯 건을 고른다", () => {
  const at = opened;
  const row = { at, message: null, error_kind: "CustomError" };
  const clients = Array.from({length: 6}, () => ({...row, http_status: 422}));
  const servers = [ {...row, error_kind: "HTTP_503"}, {...row, http_status: 502} ];
  const errors = [...clients, ...servers];
  const {lines} = buildIssuePrompt({ ...base, errors });
  expect(lines).toEqual(["23:21 KST HTTP_503", "23:21 KST CustomError"]);
  expect(buildIssuePrompt({ ...base, errors, kind: "failure" }).lines).toHaveLength(5);
});

it("같은 기능을 중복 집계하지 않고, 다른 기능 목록도 복사 직전에 가린다", () => {
  const key = "sp_srv_" + "x".repeat(20);
  const related = concurrentIssues(issue, started, [issue, ...peers, { ...peers[0], id: "repeat" }],
    [{id: "bookmark", name: key}, {id: "trip", name: "sample@example.invalid"}]);
  expect(related).toHaveLength(2);
  for (const all of [false,true]) {
    const {text} = buildIssuePrompt({ ...base, related }, all);
    expect(text).not.toContain(key);
    expect(text).not.toContain("example.invalid");
  }
});
