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

export function compareVersions(row: Insight) {
  const {previous_ms:before, current_ms:after} = row;
  if (row.previous_n < 10 || row.current_n < 10 || before === null || after === null) return null;
  const direction = after * 10 < before * 9 ? "faster" : after * 10 > before * 11 ? "slower" : "similar";
  const ratio = before === after ? 1 : Math.max(after,before) / Math.min(after,before);
  return {before, after, ratio, direction};
}
