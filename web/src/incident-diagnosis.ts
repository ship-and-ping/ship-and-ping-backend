import type { IssueInput } from "./issue-prompt";
import { isCommitVersion, versionLabel } from "../../worker/src/version.js";

const titles = {
  resource: "서버 자원 부족으로", release: "업데이트 후 고장으로", code: "코드 오류 급증으로",
  restart: "재시작 후 문제로",
  external: "외부 서비스 지연으로", database: "DB 지연으로", memory: "메모리 부족으로",
  auth: "설정·인증 문제로", traffic: "비정상 트래픽으로", silent: "기록 끊김으로", unknown: "종류 불명으로",
};
export type IncidentType = keyof typeof titles;
type Confidence = "높음" | "보통" | "낮음";
function diagnosis(type: IncidentType, confidence: Confidence, ...reasons: string[]) {
  return { type, title: titles[type] + " 보여요", confidence, reasons };
}

export function classifyIncident(input: IssueInput) {
  const ctx = input.context;
  if (input.kind === "silent") return diagnosis("silent", "높음", "살아 있음 신호가 끊겼어요.");
  const onset = Date.parse(ctx?.incident_start ?? ctx?.slow_start ?? input.opened ?? "");
  const versionAge = onset - Date.parse(input.versionFirstSeen ?? "");
  const recentVersion = input.hadPreviousVersion && versionAge >= 0 && versionAge <= 30 * 60_000;
  const version = input.openedVersion ?? input.versions[0] ?? "";
  const label = versionLabel(version);
  const semver = /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;
  const releaseVersion = isCommitVersion(version) || semver.test(version);
  const timestampVersion = /^\d\d\/\d\d /.test(label) || /^(?:\d{10}|\d{13}|\d{4}\.\d{2}\.\d{2}\.\d{4}|v?\d{8}-\d{4})$/.test(version);
  const usual = ctx?.usual_rpm, current = ctx?.incident_rpm;
  const ratio = usual != null && usual >= 0.1 && current != null ? current / usual : null;
  const peers = input.related?.length;
  if (ctx?.auth_spike && ((recentVersion && releaseVersion) || ctx.key_changed))
    return diagnosis("auth", "높음", ctx.key_changed ? "문제 직전에 키를 교체하거나 폐기했어요." : "새 버전 기록 직후에 시작됐어요.",
      "401·403 응답이 3건 이상이고 분당 빈도가 평소의 3배 이상이에요.");
  if (ctx?.repeated_server_error)
    return diagnosis("code", "높음", "서버 오류 응답이 여러 번 발생했어요.", "같은 오류 이름이 두 번 이상 기록됐어요.");
  if (ctx?.single_feature_spike && ctx.client_spike)
    return diagnosis("traffic", "보통", "이 기능만 분당 요청이 3배 이상 늘었어요.", "클라이언트 오류도 3배 이상 늘었어요.");
  if (ctx?.memory_rising)
    return diagnosis("memory", "보통", "사건 중 여러 번 측정한 메모리 사용량이 계속 늘었어요.");
  if (ctx?.db_slow && input.kind === "slow")
    return diagnosis("database", "보통", "이 기능이 느려진 동안 DB 처리 시간도 늘었어요.");
  if (input.kind !== "unconfirmed" && input.queueMs != null && Number.isFinite(input.queueMs) && input.queueMs > 0 &&
      input.queuePct != null && input.queuePct >= 50 && input.queuePct <= 100)
    return diagnosis("resource", ctx?.cpu_high ? "높음" : "보통",
      "전체 응답 시간의 " + input.queuePct + "%를 처리 시작 전에 기다렸어요.",
      ctx?.cpu_high ? "사건 중 서버 CPU 사용률이 85% 이상으로 두 번 이상 측정됐어요." : "사건 시각의 CPU와 스레드 풀 사용량을 확인해 주세요.");
  if (input.kind === "slow" && peers && ratio != null && ratio >= 3 && ctx?.related_server_errors != null &&
      !ctx.related_server_partial && ctx.related_server_errors <= 3)
    return diagnosis("resource", ctx.cpu_high ? "높음" : "보통",
      "여러 기능이 비슷한 시각에 영향을 받았어요.", "앱 분당 요청이 평소의 " + +ratio.toFixed(1) + "배이고 서버 오류는 " + ctx.related_server_errors + "건이에요.",
      ctx.cpu_high ? "사건 중 서버 CPU 사용률이 85% 이상으로 두 번 이상 측정됐어요." : "CPU·메모리·DB 시간은 확인 필요해요.");
  if (ctx?.external_slow && versionAge > 30 * 60_000 && !input.otherRecentVersion)
    return diagnosis("external", "보통", "DB 시간은 비슷하고 여러 외부 호출의 평균 시간이 늘었어요.",
      "문제 직전에 새 버전이 관측되지 않았어요.", ...(ctx.timeout_step ? ["한 단계에서 시간 초과가 반복됐어요."] : []));
  if (recentVersion && peers != null && peers <= 1 && ratio != null && ratio >= 0.5 && ratio <= 1.5) {
    if (releaseVersion)
      return diagnosis("release", "보통", "새 버전의 첫 기록 뒤 30분 안에 시작됐어요.", "영향을 받은 기능이 한두 개예요.", "앱 분당 요청은 평소 수준이에요.");
    if (timestampVersion)
      return diagnosis("restart", "낮음", "시각형 버전이 처음 기록된 뒤 30분 안에 시작됐어요.", "코드 배포 여부는 확인이 필요해요.");
  }
  return diagnosis("unknown", "낮음", "현재 기록만으로 원인을 가릴 수 없어요.", "서버 CPU·메모리·DB 시간 확인이 필요해요.");
}
