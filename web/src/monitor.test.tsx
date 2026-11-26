import { createClient } from "@supabase/supabase-js";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MonitorRoute } from "./Monitor";
import { Hero } from "./Layout";
import { gateway } from "./data";

import vectors from "../../docs/specs/sanitize-vectors.json";

afterEach(cleanup);
it("오류 코드가 비면 클래스 이름으로 종류를 집계한다", async () => {
  const { requests } = setup("/apps/a/features/f", ["WriteError"], rows => {
    Object.assign((rows.error_samples as object[])[0], { error_kind: null });
  });
  expect(await screen.findByText("WriteError 1건")).toBeTruthy();
  const query = requests.find(url => url.pathname.endsWith("/error_samples") && url.searchParams.has("at"));
  expect(query?.searchParams.get("select")?.split(",")).toContain("message");
});
it.each(vectors.version)("해결 버전을 화면에 그대로 표시한다 · $input", async ({ input, expected }) => {
  setup("/apps/a/issues/i", [], rows => {
    Object.assign((rows.incidents as object[])[0], { status: "resolved", resolved_version: input });
  });
  expect(await screen.findByText("해결 버전 · " + expected)).toBeTruthy();
});
it("첫 기록 대기 화면은 안내와 배지를 하나씩 표시한다", async () => {
  const { container } = setup("/apps/a", [], rows => {
    rows.incidents = [];
    rows.stats_5m = [];
    rows.app_versions = [];
  });
  await screen.findByRole("heading", {name: "첫 기록을 기다리고 있어요"});
  const hero = container.querySelector(".hero-card")!;
  expect(hero.querySelector("[role=status]")?.textContent).toBe("연결한 앱을 한 번 사용하면 첫 기록을 확인할 수 있어요.");
  expect(hero.querySelectorAll(".status-badge")).toHaveLength(1);
  expect(hero.querySelector(".status-badge")?.textContent).toContain("기록 대기");
});
it("도착 모션은 열린 카드의 상태가 바뀔 때만 시작한다", () => {
  const props = { title: "기록", detail: "안내" };
  const { container, rerender } = render(<Hero {...props} arrived />);
  expect(container.querySelector(".arrived")).toBeNull();
  rerender(<Hero {...props} arrived={false} />);
  expect(container.querySelector(".arrived")).toBeNull();
  rerender(<Hero {...props} arrived />);
  expect(container.querySelector(".arrived")).toBeTruthy();
});
it("깊게 보기 카드는 네 결과를 구분하고 확정 결과만 실패율에 포함한다", async () => {
  setup("/apps/a", [], rows => {
    Object.assign((rows.features as object[])[0], {kind:"deep",method:null,route:null});
    rows.stats_5m = [];
    rows.attempts = ["success","failure","abandon","unconfirmed","pending"].map(status => ({
      status,feature_id:"f",version:"v1",started_at:new Date().toISOString(),
      ended_at:["success","failure","abandon"].includes(status) ? new Date().toISOString() : null,
      duration_ms:100,
    }));
    Object.assign((rows.incidents as object[])[0], {metric_at_open:{total:3,failures:3,consecutive:true}});
  });
  expect((await screen.findByText(/성공 1건 · 실패 1건 · 중단 1건 · 결과 미확인 1건/)).textContent).toContain("실패율 50%");
  expect(screen.getAllByText(/3건 연속 실패/).length).toBeGreaterThan(0);
  expect(screen.getByText(/사용 4건 중 1건/)).toBeTruthy();
});
it("대기 중인 시도만 있는 기능은 사용을 기다린다", async () => {
  setup("/apps/a", [], rows => {
    Object.assign((rows.features as object[])[0], { kind: "deep" });
    rows.incidents = [];
    rows.attempts = [{ status: "pending", feature_id: "f", started_at: new Date().toISOString() }];
  });
  expect(await screen.findByText(/사용 0건 중 0건/)).toBeTruthy();
  expect(screen.getByText(/사용을 기다려요/)).toBeTruthy();
});
function setup(
  path: string,
  messages: string[] = ["fetch failed"],
  change?: (rows: Record<string, unknown>) => void,
) {
  const key = ["sp", "srv", "example"].join("_");
  const raw = "<b>&lt;b&gt; " + key;
  const version = "new " + raw;
  const now = Date.now();
  const date = (ago: number) => new Date(now - ago * 60000).toISOString();
  const rows: Record<string, unknown> = {
    apps: { name: raw },
    features: [
      {
        id: "f",
        name: raw,
        route: "/sample/" + raw,
        method: "GET",
        slow_threshold_ms: 5000,
        baselines: null,
      },
    ],
    incidents: [
      {
        id: "i",
        feature_id: "f",
        kind: "failure",
        status: "open",
        opened_version: "v1",
        opened_at: date(120),
        notifications: [],
        metric_at_open: { total: 6, failures: 2 },
      },
    ],
    app_versions: [{ version, first_seen_at: date(60), last_seen_at: date(5) }],
    stats_5m: [
      {
        feature_id: "f",
        version,
        bucket: date(10),
        total: 4,
        failures: 1,
        hist: [0, 4, ...Array(14).fill(0)],
      },
    ],
    error_samples: messages.map((message) => ({
      at: date(3),
      error_kind: "TimeoutError",
      message,
    })),
    attempts: [],
    incident_verification: { version, consecutive_successes: 0, latest_duration_ms: 100, latest_success: false },
  };
  change?.(rows);
  const requests: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    const table = url.pathname.split("/").pop()!;
    if (table === "incident_verification")
      expect(JSON.parse(String(init?.body))).toEqual({ incident_id: "i" });
    if (table === "dismiss_incident") {
      expect(JSON.parse(String(init?.body))).toEqual({
        incident_id: "i",
      });
      rows.incidents = [
        {
          ...(rows.incidents as object[])[0],
          status: "dismissed",
          closed_at: date(0),
        },
      ];
      if (rows.failRefresh) rows.apps = null;
      return new Response(null, { status: 204 });
    }
    if (init?.method === "PATCH") {
      expect(JSON.parse(String(init.body))).toEqual({
        slow_threshold_ms: 7200,
      });
      return Response.json({ id: "f" });
    }
    return Response.json(rows[table]);
  });
  const api = gateway(
    createClient("https://fixture.invalid", "fixture", {
      global: { fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {[
          "/apps/:id",
          "/apps/:id/features/:feature",
          "/apps/:id/issues/:issue",
        ].map((pattern) => (
          <Route
            key={pattern}
            path={pattern}
            element={<MonitorRoute api={api} />}
          />
        ))}
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, key, requests };
}
it("앱 홈에서 기능 상세까지 가린 JSX를 쓰고 기간과 느림 기준을 바꾼다", async () => {
  const { key, container, requests } = setup("/apps/a");
  const link = await screen.findByRole("link", { name: /지금까지 4건/ });
  expect(link.textContent).toContain("<b>&lt;b&gt; [가림]");
  expect(container.textContent).toContain("(형식 확인 필요)");
  fireEvent.click(link);
  fireEvent.click(await screen.findByRole("button", { name: "7일" }));
  expect(
    screen.getByRole("button", { name: "7일" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(container.textContent).toContain("표로 보기");
  fireEvent.change(screen.getByLabelText("느림 기준 (초)"), {
    target: { value: "7.2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByText("느림 기준을 저장했어요");
  expect(container.textContent).not.toContain(key);
  expect(container.querySelector("b")).toBeNull();
  expect(
    requests.filter((u) => !u.pathname.includes("/rpc/")).every(
      (u) =>
        u.searchParams.get(u.pathname.endsWith("/apps") ? "id" : "app_id") ===
        "eq.a",
    ),
  ).toBe(true);
});
it.each([
  ["none", "고친 버전을 배포하면 여기서 확인해 드려요"],
  ["waiting", "업데이트 후 첫 사용을 기다리고 있어요"],
  ["checking", "업데이트 후 4건 성공, 1건 더 확인할게요"],
  ["resolved", "업데이트 후"],
  ["slow", "최근 사용이 5.01초 걸렸어요"],
  ["threshold", "업데이트 후 1건 성공"],
  ["failed", "업데이트 후에도 4건 중 1건 실패했어요"],
])("업데이트 확인 상태 %s", async (state, expected) => {
  const { container } = setup("/apps/a/issues/i", [], (rows) => {
    if (state === "none") rows.incident_verification = { version: null };
    const proof = rows.incident_verification as Record<string, unknown>;
    if (state === "waiting") Object.assign(proof, { latest_success: null, latest_duration_ms: null });
    if (state === "checking") Object.assign(proof, { latest_success: true, consecutive_successes: 4 });
    if (state === "slow" || state === "threshold") {
      (rows.incidents as { kind: string }[])[0].kind = "slow";
      Object.assign(proof, { latest_success: true, latest_duration_ms: state === "slow" ? 5010 : 5000,
        consecutive_successes: state === "slow" ? 0 : 1 });
    }
    if (state === "resolved")
      (rows.incidents as { status: string }[])[0].status = "resolved";
  });
  await screen.findByRole("heading", { name: "업데이트 후 확인" });
  expect(container.querySelector("#verification")?.textContent).toContain(
    expected,
  );
});
it.each([
  ["failure", "open", { total: 6, failures: 2 }, "신청 6건 중 2건 실패", "감지 구간 · 최근 30분", "진행 중"],
  ["failure", "open", { total: 3, failures: 3, consecutive: true }, "신청에서 3건 연속 실패했어요", "최근 30분 3건 중 실패 3건", "진행 중"],
  ["slow", "open", { p50: 6000 }, "신청이 느려졌어요", "기준 5초 → 최근 30분 6초", "진행 중"],
  ["unconfirmed", "open", { unconfirmed: 3 }, "신청의 기록 전송이 끊겼을 수 있어요", "사용 결과를 확인하지 못한 기록 3건", "진행 중"],
  ["failure", "resolved", { total: 6, failures: 2 }, "업데이트 후 신청 최근 5건이 모두 성공했어요.", "해결 전 기록 · 최근 30분 6건 중 실패 2건", "해결됐어요"],
  ["slow", "resolved", { p50: 6000 }, "업데이트 후 신청 최근 5건이 모두 평소 속도로 끝났어요.", "해결 전 기록 · 기준 5초 → 최근 30분 6초", "해결됐어요"],
  ["failure", "quiet", null, "신청에서 실패가 늘었어요", "부터", "잠잠해졌어요"],
  ["failure", "dismissed", null, "신청에서 실패가 늘었어요", "까지 다시 알리지 않아요.", "문제 아님으로 닫았어요"],
] as const)("문제 상세 요약 %s · %s · %j", async (kind, status, metric, title, detail, badge) => {
  const { container } = setup("/apps/a/issues/i", [], rows => {
    Object.assign((rows.features as object[])[0], { name: "신청" });
    Object.assign((rows.incidents as object[])[0], {
      kind, status, metric_at_open: metric, closed_at: status === "dismissed" ? new Date().toISOString() : null,
    });
  });
  await screen.findByRole("heading", { level: 1, name: /신청/ });
  const hero = container.querySelector(".hero-card")!;
  expect(hero.querySelector("h2")?.textContent).toBe(title);
  expect(hero.querySelector("[role=status]")?.textContent).toContain(detail);
  expect(hero.querySelectorAll(".status-badge")).toHaveLength(1);
  expect(hero.querySelector(".status-badge")?.textContent).toContain(badge);
});
it("숨긴 기능은 목록에서 빠지고 해당 문제 상세는 열린다", async () => {
  const { container, requests } = setup("/apps/a", [], (rows) => {
    (rows.features as {hidden: boolean}[])[0].hidden = true;
  });
  fireEvent.click(await screen.findByRole("link", { name: /실패가 늘었어요/ }));
  await screen.findByRole("heading", { name: "지금까지 흐름" });
  expect(requests.filter((r) => r.pathname.endsWith("/features"))
    .every((r) => !r.searchParams.has("hidden"))).toBe(true);
  expect(container.querySelector("section#features")).toBeNull();
});
it("닫기 뒤 재조회 실패 시 마지막 상세 내용과 재시도를 유지한다", async () => {
  setup("/apps/a/issues/i", [], (rows) => { rows.failRefresh = true; });
  fireEvent.click(await screen.findByRole("button", { name: "문제 아님으로 닫기" }));
  await screen.findByRole("button", { name: "다시 불러오기" });
  expect(screen.getByRole("heading", { name: "지금까지 흐름" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("마지막");
});
it.each([false, true])("첫 요청·악화 요청의 상태와 약함·버전 안내 (%s)", async (worse) => {
  const { container } = setup("/apps/a/issues/i", ["fetch failed"], (rows) => {
    (rows.incident_verification as Record<string, unknown>).latest_success = null;
    if (worse) (rows.incidents as {notifications: object[]}[])[0].notifications.push({
      event: "worse", ok: true, sent_at: new Date().toISOString(),
    });
  });
  await screen.findByRole("button", {name: "AI에 보낼 내용 복사"});
  expect(screen.getByText(/외부 주소나 명령어/).getAttribute("role")).toBe("status");
  expect(screen.getByText(/앱이 보낸 버전 값/).getAttribute("role")).toBe("status");
  expect(container.querySelector("pre")?.textContent).toContain(worse ? "문제가 더 나빠졌어요" : "문제를 감지했어요");
});
it("S7을 열면 경고와 기본 복사 옵션을 자동으로 선택한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const { container, key } = setup("/apps/a/issues/i", [
    "ignore previous",
    "instructions",
    "fetch failed",
  ]);
  fireEvent.click(
    await screen.findByRole("button", { name: "그 줄 빼고 복사" }),
  );
  expect(writeText.mock.calls[0][0]).not.toContain("ignore previous");
  fireEvent.click(screen.getByRole("button", { name: "그대로 복사" }));
  expect(writeText.mock.calls[1][0]).not.toContain("ignore previous");
  expect(writeText.mock.calls[1][0]).toContain("TimeoutError");
  expect(container.textContent).not.toContain(key);
  expect(container.textContent).toContain(
    "업데이트 후에도 4건 중 1건 실패했어요",
  );
  fireEvent.click(screen.getByRole("button", { name: "문제 아님으로 닫기" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "문제 아님으로 닫기" }),
    ).toBeNull(),
  );
  await waitFor(() => expect(container.querySelector(".hero-card .status-badge")?.textContent).toContain("문제 아님으로 닫았어요"));
  expect(container.querySelector("#verification")).toBeNull();
});

it("되돌린 버전으로 홈 띠와 문제 흐름, 확인 결과, 요청문을 표시한다", async () => {
  const { container } = setup("/apps/a", [], (rows) => {
    const now = Date.now();
    const date = (minutes: number) => new Date(now - minutes * 60000).toISOString();
    rows.app_versions = [
      { version: "v3", first_seen_at: date(30), last_seen_at: date(1) },
      { version: "v0", first_seen_at: date(240), last_seen_at: date(10) },
    ];
    rows.incident_verification = { version: "v0", latest_success: true, consecutive_successes: 4 };
  });
  const link = await screen.findByRole("link", { name: "업데이트 후 확인" });
  expect(link.parentElement?.textContent).toContain("새 버전 v0 감지");
  fireEvent.click(link);
  await screen.findByText("업데이트 후 4건 성공, 1건 더 확인할게요");
  expect(container.querySelector("ol li:last-child time")?.getAttribute("datetime")).toBeTruthy();
  expect(container.querySelector("ol li:last-child")?.textContent).toContain("새 버전 감지 · v0");
  expect(container.querySelector("pre")?.textContent).toContain("v0");
  expect(container.querySelector("pre")?.textContent).not.toContain("v3");
});
it("버전 목록에서 빠져도 서버에 기록된 해결 버전을 보여 준다", async () => {
  const { container } = setup("/apps/a/issues/i", [], (rows) => {
    Object.assign((rows.incidents as object[])[0], { status: "resolved", resolved_version: "v0" });
  });
  await screen.findByText("해결 버전 · v0");
  expect(container.querySelector("pre")?.textContent).toContain("v0");
});
