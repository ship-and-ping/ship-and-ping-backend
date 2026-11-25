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
    save: vi.fn(async () => []),
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
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(copy);
  });
  expect(copy.textContent).toBe("복사했어요");
  fireEvent.click(copy);
  expect(writeText).toHaveBeenCalledTimes(1);
  await act(async () => {
    vi.advanceTimersByTime(2600);
  });
  vi.useRealTimers();
  fireEvent.click(copy);
  expect(writeText.mock.calls[0][0]).toBe(writeText.mock.calls[1][0]);
  expect(writeText.mock.calls[0][0]).toBe(buildConnectPrompt(pub, base));
  fireEvent.click(screen.getByRole("button", { name: "서버 키 발급" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 복사" }));
  expect(writeText).toHaveBeenLastCalledWith(secret);
  expect(new XMLSerializer().serializeToString(document.body)).not.toContain(
    secret,
  );
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
  expect(field.value).toBe(buildConnectPrompt(pub, base));
});
it("등록한 수집 키는 미리 보기에서 가리고 화면을 다시 열면 폐기한다", async () => {
  const api = fake();
  open("/apps/new", api);
  fireEvent.change(await screen.findByLabelText("앱 이름 (필수)"), {
    target: { value: " 내 앱 " },
  });
  fireEvent.click(screen.getByRole("button", { name: "등록" }));
  const preview = (await screen.findByLabelText(
    "연결 요청 복사 전문",
  )) as HTMLTextAreaElement;
  expect(api.create).toHaveBeenCalledWith("내 앱", "");
  expect(api.issue).toHaveBeenCalledWith("a", "pub");
  expect(preview.value).not.toContain(pub);
  expect(preview.value).toContain("••••");
  fireEvent.click(screen.getByRole("link", { name: "내 앱" }));
  fireEvent.click(await screen.findByRole("link", { name: /모임모아/ }));
  expect(
    await screen.findByRole("button", { name: "새 수집 키 발급" }),
  ).toBeTruthy();
  expect(api.issue).toHaveBeenCalledTimes(1);
});
it("선택한 제안만 저장하고 이름 없는 주소에 늦게 온 제안을 보여 준다", async () => {
  const api = fake();
  const proposed = {
    id: null,
    method: "GET",
    route: "/a",
    name: "신청",
    hidden: false,
  };
  const unnamed = { ...proposed, id: "b", route: "/b", name: "" };
  const snapshot = {
    app: { ...app, first_record_at: "2026-11-25" },
    labels: [proposed, unnamed],
  };
  vi.mocked(api.snapshot)
    .mockResolvedValueOnce(snapshot)
    .mockResolvedValue({
      ...snapshot,
      labels: [proposed, { ...unnamed, name: "예약" }],
    });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  open("/apps/a/connect", api);
  await act(async () => {});
  expect(screen.getByText(/기능 1개를 찾았어요/)).toBeTruthy();
  fireEvent.click(screen.getAllByLabelText("이 이름 확인")[0]);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "모두 확인" }));
  });
  expect(api.save).toHaveBeenCalledWith("a", [proposed]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByDisplayValue("예약")).toBeTruthy();
});
it("서버 키 복사가 거절되어도 DOM에 원문을 남기지 않는다", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  open("/apps/a/connect");
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 발급" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 복사" }));
  expect(await screen.findByText(/브라우저의 복사 권한/)).toBeTruthy();
  expect(new XMLSerializer().serializeToString(document.body)).not.toContain(
    secret,
  );
  expect(screen.queryByLabelText("서버 키 복사 전문")).toBeNull();
});
it("회원 앱 카드·연결 안내·이름표·주소는 가린 글자로 보인다", async () => {
  const api = fake();
  const name = "＜em＞앱＜/em＞ ＳＰ＿ＳＲＶ＿private";
  vi.mocked(api.apps).mockResolvedValue([{ ...app, name }]);
  vi.mocked(api.snapshot).mockResolvedValue({
    app: { ...app, name, created_at: "2020-01-01" },
    labels: [
      {
        id: "f",
        method: "GET",
        route: "/xSP_pub_fixture/<b>",
        name: "기능 &lt;b&gt; s\u200bk_0123456789abcdef",
        hidden: false,
      },
    ],
  });
  open("/apps", api);
  const link = await screen.findByRole("link", {
    name: /<em>앱<\/em> \[가림\]/,
  });
  expect(link.querySelector("em")).toBeNull();
  fireEvent.click(link);
  expect(
    await screen.findByText(/앱<\/em> \[가림\]에서 보낸 기록/),
  ).toBeTruthy();
  expect(screen.getByDisplayValue("기능 &lt;b&gt; [가림]")).toBeTruthy();
  expect(screen.getByText("GET /:id/<b>").children.length).toBe(0);
  for (const selector of [".compact", "#member-menu"]) {
    const menu = document.querySelector(selector)!;
    await waitFor(() => expect(menu.textContent).toContain("<em>앱</em> [가림]"));
    expect(menu.querySelector("em")).toBeNull();
  }
  const check = screen.getByLabelText(
    "확인 문장 복사 전문",
  ) as HTMLTextAreaElement;
  expect(check.value).toContain("멈추고 나에게 물어봐");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  fireEvent.click(screen.getByRole("button", { name: "확인 문장 복사" }));
  expect(writeText).toHaveBeenCalledWith(check.value);
  expect(check.value).not.toMatch(
    /(?:sp_srv|sp_pub|sb_secret|sb_publishable)_/i,
  );
});
it("로그인 이메일은 보이는 원문대로 제출한다", async () => {
  const api = fake(null);
  open("/login", api);
  const email = (await screen.findByLabelText(
    "이메일 주소",
  )) as HTMLInputElement;
  fireEvent.change(email, { target: { value: "sk_fixture@example.test" } });
  expect(email.value).toBe("sk_fixture@example.test");
  fireEvent.click(screen.getByRole("button", { name: "이메일 링크 받기" }));
  await waitFor(() => expect(api.login).toHaveBeenCalledWith(email.value));
});
function open(path: string, api = fake()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App api={api} ingest={base} />
    </MemoryRouter>,
  );
}
it("한글 조합과 편집 원문을 유지하고 저장할 때 정규화한다", async () => {
  const api = fake();
  const label = { id: "f", method: "GET", route: "/a", name: "sp_srv_fixture", hidden: false };
  vi.mocked(api.snapshot).mockResolvedValue({ app, labels: [label] });
  open("/apps/a/connect", api);
  const field = (await screen.findByLabelText("기능 이름 1")) as HTMLInputElement;
  expect(field.value).toBe("[가림]");
  fireEvent.compositionStart(field);
  fireEvent.change(field, { target: { value: "ㅎ" } });
  expect(field.value).toBe("ㅎ");
  fireEvent.change(field, { target: { value: "한" } });
  fireEvent.compositionEnd(field, { data: "한" });
  const draft = " 한 desk_ Ａ sp_srv_fixture ";
  fireEvent.change(field, { target: { value: draft } });
  expect(field.value).toBe(draft);
  fireEvent.click(screen.getByRole("button", { name: "모두 확인" }));
  await waitFor(() => expect(api.save).toHaveBeenCalledWith("a", [
    { ...label, name: "한 desk_ A [가림]" },
  ]));
  expect(field.value).toBe("한 desk_ A [가림]");
});
it("200개 한도를 넘긴 이름은 저장 성공으로 표시하지 않는다", async () => {
  const api = fake();
  const label = { id: null, method: "GET", route: "/extra", name: "초과", hidden: false };
  vi.mocked(api.snapshot).mockResolvedValue({ app, labels: [label] });
  vi.mocked(api.save).mockResolvedValue([{ method: "GET", route: "/extra" }]);
  open("/apps/a/connect", api);
  fireEvent.click(await screen.findByLabelText("이 이름 확인"));
  fireEvent.click(screen.getByRole("button", { name: "모두 확인" }));
  expect(await screen.findByText(/200개를 넘어 저장하지 못했어요/)).toBeTruthy();
  expect(screen.queryByText(/저장했어요/)).toBeNull();
  expect(screen.queryByDisplayValue("초과")).toBeNull();
});
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
      "쉽앤핑 수집 주소(INGEST_URL)는 예외",
    ])
      expect(prompt).toContain(rule);
    expect(() => buildConnectPrompt(secret, base)).toThrow();
    expect(() => buildConnectPrompt(pub, base + "/" + secret)).toThrow();
  });
  it("이름 길이와 https 주소를 검사한다", () => {
    expect(validateApp("   ", "")).toHaveProperty("name");
    expect(validateApp("가".repeat(41), "")).toHaveProperty("name");
    expect(validateApp("가", "http://example.org")).toHaveProperty("url");
    expect(
      validateApp("가", "https://example.test/" + "a".repeat(2048)),
    ).toHaveProperty("url");
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
    expect(api.save).toHaveBeenCalledWith("a", [
      expect.objectContaining({ id: "f", name: "참가 신청", hidden: true }),
    ]),
  );
});
