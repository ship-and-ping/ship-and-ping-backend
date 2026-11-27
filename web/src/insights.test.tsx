import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Chart } from "./Chart";
import { compareVersions, satisfaction, type Insight } from "./insights";

afterEach(cleanup);
const row: Insight = {feature_id:"f", fast:24, measured:25, failures:3,
  previous_ms:1400, current_ms:300, previous_n:10, current_n:10};

it("weights successful requests and keeps slow requests and failures visible", () => {
  expect(satisfaction([row])).toEqual({percent:96, slow:1, failures:3});
  expect(satisfaction([row, {...row, fast:0, measured:75, failures:2}])).toEqual({percent:24, slow:76, failures:5});
  expect(satisfaction([])).toBeNull();
  expect(satisfaction([{...row, fast:null}])).toBeNull();
  expect(satisfaction([{...row, fast:0, measured:0}])).toEqual({percent:null, slow:0, failures:3});
});

it("requires ten measured successes in both adjacent versions", () => {
  expect(compareVersions({...row, previous_n:9})).toBeNull();
  expect(compareVersions({...row, current_n:9})).toBeNull();
  expect(compareVersions(row)?.direction).toBe("faster");
  expect(compareVersions({...row, current_ms:2000})?.direction).toBe("slower");
  for (const current_ms of [900, 1000, 1100])
    expect(compareVersions({...row, previous_ms:1000, current_ms})?.direction).toBe("similar");
});

it("draws the band, highlights above it and explains a missing range", () => {
  const now = Date.UTC(2026,10,27);
  const rows = [{bucket:new Date(now).toISOString(), feature_id:"f", version:"v2", hist:[0,0,0,1], total:1, failures:0}];
  const view = render(<Chart rows={rows} now={now} days={1} baseline={100} p95={200} samples={30} />);
  expect(view.container.querySelector("rect.usual-band")).toBeTruthy();
  expect(view.container.querySelector("circle.above-range")).toBeTruthy();
  expect(view.getByText(/평소 범위/)).toBeTruthy();
  view.rerender(<Chart rows={rows} now={now} days={1} baseline={null} p95={null} samples={12} />);
  expect(view.container.querySelector(".usual-band")).toBeNull();
  expect(view.getByText("평소 범위는 성공 30번 뒤에 생겨요 (지금 12번)")).toBeTruthy();
});

it("distinguishes the automatic overflow bin from a measured ten-minute duration", () => {
  const overflow = {...row, current_ms:600000};
  expect(compareVersions(overflow,true)).toMatchObject({after:Infinity, direction:"slower", bounded:true});
  expect(compareVersions({...overflow,previous_ms:30000},true)?.direction).toBe("unknown");
  expect(compareVersions(overflow,false)).toMatchObject({after:600000, bounded:false});
});
