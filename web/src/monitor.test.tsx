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
import { gateway } from "./data";

afterEach(cleanup);
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
  };
  change?.(rows);
  const requests: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    const table = url.pathname.split("/").pop()!;
    if (table === "dismiss_incident") {
      expect(JSON.parse(String(init?.body))).toEqual({
        p_app_id: "a",
        p_incident_id: "i",
      });
      rows.incidents = [
        {
          ...(rows.incidents as object[])[0],
          status: "dismissed",
          closed_at: date(0),
        },
      ];
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
    requests.every(
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
  ["resolved", "업데이트 후 해결됐어요"],
  ["failed", "업데이트 후에도 4건 중 1건 실패했어요"],
])("업데이트 확인 상태 %s", async (state, expected) => {
  const { container } = setup("/apps/a/issues/i", [], (rows) => {
    if (state === "none") rows.app_versions = [];
    if (state === "waiting") rows.stats_5m = [];
    if (state === "checking")
      (rows.stats_5m as { failures: number }[])[0].failures = 0;
    if (state === "resolved")
      (rows.incidents as { status: string }[])[0].status = "resolved";
  });
  await screen.findByRole("heading", { name: "업데이트 후 확인" });
  expect(container.querySelector("#verification")?.textContent).toContain(
    expected,
  );
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
  expect(writeText.mock.calls[1][0]).toContain("ignore previous");
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
  expect(container.textContent).toContain("문제 아님으로 닫음");
});
