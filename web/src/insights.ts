import { displayMeasuredMs } from "./monitor-data";

export interface Insight {
  feature_id: string;
  fast: number | null;
  measured: number;
  failures: number;
  previous_n: number;
  current_n: number;
  previous_ms: number | null;
  current_ms: number | null;
}

export function satisfaction(rows: Insight[]) {
  const eligible = rows.filter(row => row.fast !== null);
  if (!eligible.length) return null;
  let fast = 0, measured = 0, failures = 0;
  for (const row of eligible) {
    fast += row.fast ?? 0;
    measured += row.measured;
    failures += row.failures;
  }
  if (!measured && !failures) return null;
  return {percent:measured ? Math.round(100 * fast / measured) : null, slow:measured - fast, failures};
}

export function compareVersions(row: Insight, automatic = false) {
  const before = displayMeasuredMs(row.previous_ms, automatic);
  const after = displayMeasuredMs(row.current_ms, automatic);
  if (row.previous_n < 10 || row.current_n < 10 || before === null || after === null) return null;
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    const upperIsCurrent = after === Infinity;
    const shorter = Math.min(after, before);
    // A median anywhere above 30s can still be within 10% of a 30s observation.
    const certain = upperIsCurrent ? 30000 >= shorter * 1.1 : shorter <= 30000 * 0.9;
    return {before, after, direction:certain ? (upperIsCurrent ? "slower" : "faster") : "unknown",
      ratio:certain ? 30000 / shorter : 1, bounded:true};
  }
  const direction = after * 10 < before * 9 ? "faster" : after * 10 > before * 11 ? "slower" : "similar";
  const ratio = before === after ? 1 : Math.max(after,before) / Math.min(after,before);
  return {before, after, ratio, direction, bounded:false};
}

