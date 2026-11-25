import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { App } from "./App";
import { buildConnectPrompt, validateApp } from "./domain";
import type { Gateway, Snapshot } from "./data";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const pub = "sp_pub_" + "0".repeat(64);
const secret = "sp_srv_" + "1".repeat(64);
const base = "https://ingest.example.invalid";
const app = {
  id: "a",
  name: "모임모아",
  first_record_at: null,
  created_at: new Date().toISOString(),
  issues: 0,
  last: null,
};
function fake(user: string | null = "member"): Gateway {
  return {
    session: vi.fn(async () => user),
    listen: () => () => {},
    login: vi.fn(),
    logout: vi.fn(),
    firstVisit: vi.fn(async () => true),
    apps: vi.fn(async () => [app]),
    create: vi.fn(async () => "a"),
    issue: vi.fn(async (_id, kind) => (kind === "pub" ? pub : secret)),
    snapshot: vi.fn(async () => ({ app, labels: [] })),
    save: vi.fn(),
  };
}
it("서버 키 복사는 현재 앱에 한정되고 요청문은 다시 복사해도 같다", async () => {
  const api = fake();
  const other = { ...app, id: "b", name: "두 번째 앱" };
  vi.mocked(api.apps).mockResolvedValue([app, other]);
  vi.mocked(api.issue).mockImplementation(async (id, kind) =>
    kind === "pub" ? pub : id === "a" ? secret : "sp_srv_" + "2".repeat(64),
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  open("/apps/a/connect", api);
  fireEvent.click(
    await screen.findByRole("button", { name: "새 수집 키 발급" }),
  );
  const copy = await screen.findByRole("button", { name: "연결 요청 복사" });
  fireEvent.click(copy);
  fireEvent.click(copy);
  expect(writeText.mock.calls[0][0]).toBe(writeText.mock.calls[1][0]);
  fireEvent.click(screen.getByRole("button", { name: "서버 키 발급" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 복사" }));
  expect(writeText).toHaveBeenLastCalledWith(secret);
  fireEvent.click(screen.getByRole("link", { name: "내 앱" }));
  fireEvent.click(await screen.findByRole("link", { name: /두 번째 앱/ }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 발급" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 복사" }));
  expect(writeText).toHaveBeenLastCalledWith("sp_srv_" + "2".repeat(64));
});
it.each([
  [true, "앱 등록"],
  [false, "내 앱"],
] as const)("앱이 없는 회원의 첫 방문(%s) 이동", async (first, title) => {
  const api = fake();
  vi.mocked(api.apps).mockResolvedValue([]);
  vi.mocked(api.firstVisit).mockResolvedValue(first);
  open("/login", api);
  expect(
    await screen.findByRole("heading", { level: 1, name: title }),
  ).toBeTruthy();
});
it("클립보드가 막히면 직접 복사할 전문을 선택한다", async () => {
  const api = fake();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  open("/apps/a/connect", api);
  fireEvent.click(
    await screen.findByRole("button", { name: "새 수집 키 발급" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "연결 요청 복사" }),
  );
  await screen.findByText(/자동 복사가 막혔어요/);
  const field = screen.getByLabelText(
    "연결 요청 복사 전문",
  ) as HTMLTextAreaElement;
  expect(document.activeElement).toBe(field);
  expect(field.selectionEnd - field.selectionStart).toBe(field.value.length);
});
function open(path: string, api = fake()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App api={api} ingest={base} />
    </MemoryRouter>,
  );
}
describe("연결 요청문과 등록 입력", () => {
  it("공개 수집 키와 환경변수 이름만 제공한다", () => {
    const prompt = buildConnectPrompt(pub, base);
    expect(prompt).toContain(pub);
    expect(prompt).not.toContain("sp_srv_");
    for (const rule of [
      "SHIPPING_SERVER_KEY",
      "깃에 올리지 마",
      "멈추고 나에게 물어봐",
      "/v1/feature-map",
    ])
      expect(prompt).toContain(rule);
    expect(() => buildConnectPrompt(secret, base)).toThrow();
    expect(() => buildConnectPrompt(pub, base + "/" + secret)).toThrow();
  });
  it("이름 길이와 https 주소를 검사한다", () => {
    expect(validateApp("   ", "")).toHaveProperty("name");
    expect(validateApp("가".repeat(41), "")).toHaveProperty("name");
    expect(validateApp("가", "http://example.org")).toHaveProperty("url");
    expect(validateApp("가".repeat(40), "")).toEqual({});
  });
});
it("로그인하지 않은 내 앱 방문자를 로그인으로 보낸다", async () => {
  const api = fake(null);
  const { container } = open("/apps", api);
  await screen.findByRole("button", { name: /Google/ });
  expect(api.apps).not.toHaveBeenCalled();
  expect(
    (await axe(container, { rules: { "color-contrast": { enabled: false } } }))
      .violations,
  ).toEqual([]);
});
it("메뉴를 열고 Esc로 닫는다", async () => {
  open("/apps");
  const toggle = await screen.findByRole("button", { name: "메뉴" });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(toggle, { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
it("첫 기록을 확인한 뒤 수정한 이름과 숨김을 저장한다", async () => {
  const api = fake();
  const arrived: Snapshot = {
    app: { ...app, first_record_at: "2026-11-25" },
    labels: [
      { id: "f", method: "POST", route: "/join", name: "신청", hidden: false },
    ],
  };
  vi.mocked(api.snapshot)
    .mockResolvedValueOnce({ app, labels: [] })
    .mockResolvedValue(arrived);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  open("/apps/a/connect", api);
  await act(async () => {});
  expect(screen.getByText("첫 기록을 기다리고 있어요")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  vi.useRealTimers();
  expect(screen.getByText(/기능 1개를 찾았어요/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("기능 이름 1"), {
    target: { value: "참가 신청" },
  });
  fireEvent.click(screen.getByLabelText("이 기능 숨기기"));
  fireEvent.click(screen.getByRole("button", { name: "모두 확인" }));
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ id: "f", name: "참가 신청", hidden: true }),
    ),
  );
});
