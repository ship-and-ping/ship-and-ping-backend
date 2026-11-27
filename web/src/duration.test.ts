import { expect, it } from "vitest";
import { buildIssuePrompt } from "./issue-prompt";
import { summarize, type Stat } from "./monitor-data";

function row(bins: number, entries: [number, number][]): Stat {
  const hist = Array<number>(bins).fill(0);
  for (const [index, count] of entries) hist[index] = count;
  return { feature_id: "f", version: "v", bucket: "", total: hist.reduce((a, b) => a + b, 0), failures: 0, hist };
}

it("reads medians across empty, legacy and refined five-minute buckets", () => {
  expect(summarize([]).median).toBeNull();
  expect(summarize([row(30, [])]).median).toBeNull();
  expect(summarize([row(30, [[20, 3], [21, 20], [22, 7]])]).median).toBe(6300);
  expect(summarize([row(30, [[9, 1], [10, 15], [11, 14]])]).median).toBe(3300);
  const legacy = row(16, [[11, 31]]);
  const fine = row(30, [[21, 30]]);
  expect(summarize([fine, legacy]).median).toBe(7500);
  expect(summarize([fine, legacy]).min).toBe(5000);
});

it("copies the incident snapshot and baseline into the problem report", () => {
  const prompt = buildIssuePrompt({
    feature: "검색", route: "/search", versions: ["v1"], errors: [], kind: "slow", p50: 6300, baseline: 3300,
  });
  expect(prompt.text).toContain("보통 약 6.3초, 평소 약 3.3초");
});
