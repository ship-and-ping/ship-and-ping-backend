import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
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
    account: vi.fn(async () => ({email:"<me>@example.invalid", joined:app.created_at, method:"이메일 링크"})),
    withdraw: vi.fn(async () => "done" as const),
    checkAccount: vi.fn(async () => "exists" as const),
    appKeys: vi.fn(async () => []),
    editApp: vi.fn(), removeApp: vi.fn(), revokeKey: vi.fn(),
    settings: vi.fn(async () => ({
      email: false,
      channel: null,
      connected: false,
      broken: false,
    })),
    deepFeatures: vi.fn(),
    saveDeep: vi.fn(),
    deleteDeep: vi.fn(),
    deepCounts: vi.fn(),
    firstResult: vi.fn(),
    emailSetting: vi.fn(),
    testSlack: vi.fn(),
    disconnectSlack: vi.fn(),
    slack: vi.fn(),
    session: vi.fn(async () => user),
    listen: () => () => {},
    login: vi.fn(),
    passwordLogin: vi.fn(),
    signup: vi.fn(),
    requestReset: vi.fn(),
    updatePassword: vi.fn(),
    reauthenticate: vi.fn(),
    logout: vi.fn(async () => {}),
    firstVisit: vi.fn(async () => true),
    apps: vi.fn(async () => [app]),
    create: vi.fn(async () => "a"),
    issue: vi.fn(async (_id, kind) => (kind === "pub" ? pub : secret)),
    monitor: vi.fn(),
    threshold: vi.fn(),
    dismiss: vi.fn(),
    snapshot: vi.fn(async () => ({ app, labels: [] })),
    save: vi.fn(async () => []),
  };
}
it("requires a PC number before mobile approval and allows immediate refusal", async () => {
  const api = fake();
  api.requests = {create:vi.fn(),poll:vi.fn(),decide:vi.fn()
    .mockResolvedValueOnce({status:"pending",client_info:{browser:"Firefox",place:"KR"},created_at:app.created_at})
    .mockResolvedValueOnce({status:"denied"})};
  open("/login/approve?req=sample&proof=fixture",api);
  const approve = await screen.findByRole<HTMLButtonElement>("button",{name:"이 PC 로그인 승인"});
  expect(approve.disabled).toBe(true);
  expect(screen.getByText(/직접 로그인하려는 게 아니라면/)).toBeTruthy();
  const input = screen.getByRole("textbox",{name:"PC 확인 숫자 두 자리"});
  fireEvent.change(input,{target:{value:"0"}});
  expect(approve.disabled).toBe(true);
  fireEvent.change(input,{target:{value:"07"}});
  expect(approve.disabled).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"거절"}));
  expect(await screen.findByText("휴대폰에서 거절했어요.")).toBeTruthy();
  expect(api.requests.decide).toHaveBeenLastCalledWith("sample","deny","fixture","07");
});
it("기존 세션으로 요청 번호만 열면 메일 링크를 안내한다", async () => {
  const api = fake();
  api.requests = {create:vi.fn(),poll:vi.fn(),decide:vi.fn()};
  open("/login/approve?req=sample",api);
  expect(await screen.findByText("메일의 링크를 다시 눌러 주세요.")).toBeTruthy();
  expect(api.requests.decide).not.toHaveBeenCalled();
});
it("로그인은 기본 제출이고 메일 링크는 구분선 다음 보조 행동이다", async () => {
  vi.stubEnv("VITE_GOOGLE_LOGIN_ENABLED", "");
  try {
    open("/login", fake(null));
    const primary = await screen.findByRole("button", {name:"로그인"});
    const divider = screen.getByRole("separator", {name:"또는"});
    const mail = screen.getByRole("button", {name:/메일 링크로 받기/});
    expect(primary.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(mail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mail.classList.contains("secondary")).toBe(true);
    expect(screen.queryByRole("button", {name:/Google/})).toBeNull();
  } finally { vi.unstubAllEnvs(); }
});
it("설정된 Google 보조 버튼은 이메일 없이 인증을 시작한다", async () => {
  vi.stubEnv("VITE_GOOGLE_LOGIN_ENABLED", "true");
  try {
    const api = fake(null);
    open("/login", api);
    const google = await screen.findByRole("button", {name:"Google로 로그인"});
    expect(google.classList.contains("secondary")).toBe(true);
    fireEvent.click(google);
    await waitFor(() => expect(api.login).toHaveBeenCalledWith());
  } finally { vi.unstubAllEnvs(); }
});
it("비밀번호 토글은 초점과 입력값을 유지하고 표시 상태를 읽어 준다", async () => {
  open("/login", fake(null));
  const field = await screen.findByLabelText<HTMLInputElement>("비밀번호");
  const toggle = screen.getByRole("button", {name:"비밀번호 보기", pressed:false});
  fireEvent.change(field, {target:{value:"test-only"}});
  toggle.focus();
  fireEvent.click(toggle);
  expect(screen.getByRole("button", {name:"비밀번호 숨기기", pressed:true})).toBe(document.activeElement);
  expect(field.type).toBe("text");
  fireEvent.click(toggle);
  expect(field.type).toBe("password");
  expect(field.value).toBe("test-only");
});
it("잘못된 로그인은 계정 유무를 드러내지 않는다", async () => {
  const api = fake(null);
  vi.mocked(api.passwordLogin).mockRejectedValue(Error());
  open("/login", api);
  fireEvent.change(await screen.findByLabelText("이메일 주소"), {target:{value:"member@example.invalid"}});
  fireEvent.change(screen.getByLabelText("비밀번호"), {target:{value:"incorrect"}});
  fireEvent.click(screen.getByRole("button", {name:"로그인"}));
  expect((await screen.findByRole("alert")).textContent).toBe("이메일이나 비밀번호가 맞지 않아요");
  expect(api.passwordLogin).toHaveBeenCalledTimes(1);
});
it.each([
  ["Ａ마트", "A마트"],
  ["<b>" + secret, "<b>[가림]"],
])("S10 compares the exact displayed name for %s", async (raw, shown) => {
  const api = fake();
  vi.mocked(api.snapshot).mockResolvedValue({app:{...app,name:raw}, labels:[]});
  open("/apps/a/settings", api);
  const field = await screen.findByLabelText("앱 이름 다시 입력");
  expect(document.body.textContent).not.toContain(secret);
  expect(screen.getByText(/화면에 보이는 그대로/).textContent?.includes("[가림] 포함")).toBe(shown.includes("[가림]"));
  const button = screen.getByRole("button", {name:"앱 삭제"});
  fireEvent.change(field,{target:{value:raw}});
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.change(field,{target:{value:shown}});
  fireEvent.click(button);
  expect(api.removeApp).toHaveBeenCalledWith("a");
});
it("S10 keeps the failed deletion confirmation locked for retry", async () => {
  const api = fake();
  vi.mocked(api.removeApp).mockRejectedValueOnce(Error());
  open("/apps/a/settings", api);
  const field = await screen.findByLabelText("앱 이름 다시 입력");
  const submit = screen.getByRole("button",{name:"앱 삭제"});
  expect(submit.getAttribute("aria-disabled")).toBe("true");
  fireEvent.change(field,{target:{value:app.name}});
  expect(submit.getAttribute("aria-disabled")).toBe("false");
  fireEvent.click(submit);
  const retry = await screen.findByRole("button",{name:"다시 시도"});
  expect(field.hasAttribute("disabled")).toBe(true);
  expect(document.activeElement).toBe(retry);
  fireEvent.click(retry);
  expect(api.removeApp).toHaveBeenCalledTimes(2);
});
it.each([secret, "name=Jane Doe", "계정 user_id=sample"])("S10 requires a replacement for masked label %s before saving", async (labelName) => {
  const api = fake();
  vi.mocked(api.snapshot).mockResolvedValue({app,labels:[{id:"l",method:"GET",route:"/a",name:labelName,hidden:false}]});
  open("/apps/a/settings", api);
  const field = await screen.findByLabelText(/기능 이름$/);
  expect((field as HTMLInputElement).value).toBe("");
  fireEvent.change(field,{target:{value:"[가림]"}});
  expect(screen.getByRole("button",{name:"이름 저장"}).hasAttribute("disabled")).toBe(true);
  fireEvent.change(field,{target:{value:"신청"}});
  fireEvent.click(screen.getByRole("button",{name:"이름 저장"}));
  expect(api.save).toHaveBeenCalledWith("a",[expect.objectContaining({name:"신청"})]);
});
it("탈퇴 재시도가 제한되면 확인 대기 없이 다시 시도할 수 있다", async () => {
  const api = fake();
  vi.mocked(api.withdraw).mockResolvedValueOnce("failed").mockResolvedValueOnce("limited");
  open("/account",api);
  fireEvent.click(await screen.findByRole("button",{name:"회원 탈퇴"}));
  fireEvent.change(screen.getByLabelText("로그인 이메일 다시 입력"),{target:{value:"<me>@example.invalid"}});
  fireEvent.click(screen.getByRole("button",{name:"모든 앱과 기록을 지우고 탈퇴"}));
  fireEvent.click(await screen.findByRole("button",{name:"다시 시도"}));
  await screen.findByText("잠시 뒤 다시 시도해 주세요.");
  expect(document.activeElement).toBe(screen.getByRole("button",{name:"다시 시도"}));
  expect(api.checkAccount).not.toHaveBeenCalled();
});
it("S11 lets the member log out after a failed withdrawal", async () => {
  const api = fake();
  vi.mocked(api.withdraw).mockResolvedValueOnce("failed");
  let emit: (id: string | null) => void = () => {};
  api.listen = listener => { emit = listener; return () => {}; };
  open("/account", api);
  fireEvent.click(await screen.findByRole("button",{name:"회원 탈퇴"}));
  fireEvent.change(screen.getByLabelText("로그인 이메일 다시 입력"),{target:{value:"<me>@example.invalid"}});
  fireEvent.click(screen.getByRole("button",{name:"모든 앱과 기록을 지우고 탈퇴"}));
  await screen.findByRole("button",{name:"다시 시도"});
  vi.mocked(api.logout).mockImplementationOnce(async () => emit(null));
  fireEvent.click(screen.getByRole("button",{name:"로그아웃"}));
  await screen.findByText("로그아웃했어요");
});
it("S11 sends an invalid session after retry to the login notice", async () => {
  const api = fake();
  vi.mocked(api.withdraw).mockResolvedValueOnce("failed").mockResolvedValueOnce("unauthorized");
  open("/account", api);
  fireEvent.click(await screen.findByRole("button",{name:"회원 탈퇴"}));
  fireEvent.change(screen.getByLabelText("로그인 이메일 다시 입력"),{target:{value:"<me>@example.invalid"}});
  fireEvent.click(screen.getByRole("button",{name:"모든 앱과 기록을 지우고 탈퇴"}));
  fireEvent.click(await screen.findByRole("button",{name:"다시 시도"}));
  await screen.findByText(/탈퇴가 이미 끝났을 수 있어요/);
  expect(screen.queryByText(/계정은 아직 남아/)).toBeNull();
});
it("탈퇴 요청 전 세션이 없으면 로그인 화면에서 재로그인을 안내한다", async () => {
  const api = fake();
  vi.mocked(api.withdraw).mockResolvedValue("login_required");
  open("/account", api);
  fireEvent.click(await screen.findByRole("button",{name:"회원 탈퇴"}));
  fireEvent.change(screen.getByLabelText("로그인 이메일 다시 입력"),{target:{value:"<me>@example.invalid"}});
  fireEvent.click(screen.getByRole("button",{name:"모든 앱과 기록을 지우고 탈퇴"}));
  await screen.findByRole("heading",{name:"로그인"});
  await screen.findByText("다시 로그인해 주세요.");
});
it("S11 keeps the exact email through a failed request and retries", async () => {
  const api = fake();
  vi.mocked(api.withdraw).mockResolvedValueOnce("failed");
  open("/account",api);
  fireEvent.click(await screen.findByRole("button",{name:"회원 탈퇴"}));
  const input = screen.getByLabelText("로그인 이메일 다시 입력");
  const submit = screen.getByRole("button",{name:"모든 앱과 기록을 지우고 탈퇴"});
  fireEvent.change(input,{target:{value:"<ME>@example.invalid"}});
  expect(submit.hasAttribute("disabled")).toBe(true);
  fireEvent.change(input,{target:{value:"<me>@example.invalid"}});
  fireEvent.click(submit);
  fireEvent.click(await screen.findByRole("button",{name:"다시 시도"}));
  await screen.findByText("탈퇴를 마쳤어요");
  expect(api.withdraw).toHaveBeenCalledTimes(2);
});
it.each(["exists","deleted","unknown"] as const)("S11 checks interrupted responses every ten seconds (%s)",async outcome=>{
  const api=fake();
  vi.mocked(api.withdraw).mockResolvedValue("unknown");
  vi.mocked(api.checkAccount).mockResolvedValue(outcome);
  open("/account",api);
  fireEvent.click(await screen.findByRole("button",{name:"회원 탈퇴"}));
  fireEvent.change(screen.getByLabelText("로그인 이메일 다시 입력"),{target:{value:"<me>@example.invalid"}});
  fireEvent.click(screen.getByRole("button",{name:"모든 앱과 기록을 지우고 탈퇴"}));
  // Install the test clock before the checking effect schedules its interval.
  vi.useFakeTimers();
  await act(async()=>{});
  await act(()=>vi.advanceTimersByTimeAsync(9999));
  expect(api.checkAccount).not.toHaveBeenCalled();
  await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(api.checkAccount).toHaveBeenCalledTimes(1);
  if(outcome==="deleted") expect(screen.getByText("탈퇴를 마쳤어요")).toBeTruthy();
  else {
    await act(()=>vi.advanceTimersByTimeAsync(110000));
    expect(api.checkAccount).toHaveBeenCalledTimes(12);
    expect(screen.getByRole("button",{name:"다시 시도"})).toBeTruthy();
  }
});
it("S10 copies only the newly issued key of the selected app",async()=>{
  const copy=vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}});
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(true);
  try {
    for(const id of ["a","b"]){
      const api=fake();
      const raw=["sp","srv",id.repeat(64)].join("_");
      vi.mocked(api.issue).mockResolvedValue(raw);
      open("/apps/"+id+"/settings",api);
      fireEvent.click(await screen.findByRole("button",{name:"서버 키 재발급"}));
      fireEvent.click(await screen.findByRole("button",{name:"서버 키 복사"}));
      expect(api.issue).toHaveBeenCalledWith(id,"srv");
      expect(copy).toHaveBeenLastCalledWith(raw);
      expect(document.body.textContent).not.toContain(raw);
      cleanup();
    }
  } finally {confirm.mockRestore();}
});
it("S11 summary masks app names and keeps literal markup in text nodes",async()=>{
  const api=fake();
  vi.mocked(api.apps).mockResolvedValue([{...app,name:"<i>&lt;b&gt;"+secret}]);
  open("/account",api);
  expect(await screen.findByRole("link",{name:"<i>&lt;b&gt;[가림]"})).toBeTruthy();
  expect(document.body.textContent).not.toContain(secret);
});
it("알림 앱 목록은 실패한 뒤에만 재시도를 제공한다", async () => {
  const api = fake();
  vi.mocked(api.apps).mockRejectedValueOnce(Error("offline"));
  vi.mocked(api.apps).mockImplementationOnce(() => new Promise(() => {}));
  open("/apps/notifications", api);
  fireEvent.click(await screen.findByRole("button", { name: "앱 목록 다시 불러오기" }));
  await screen.findByText("알림을 설정할 앱을 불러오는 중이에요.");
  expect(screen.queryByRole("button", { name: "앱 목록 다시 불러오기" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
it("시작한 탭의 state만 슬랙 코드 교환에 사용한다", async () => {
  const api = fake();
  sessionStorage.setItem("ship-ping-slack-state", "original");
  open("/apps/notifications#slack_state=wrong&slack_code=fixture", api);
  await screen.findByText("연결 요청을 확인할 수 없어요. 다시 시작해 주세요.");
  expect(api.slack).not.toHaveBeenCalled();
  cleanup();
  sessionStorage.setItem("ship-ping-slack-state", "original");
  vi.mocked(api.slack).mockResolvedValue({app:"a"});
  open("/apps/notifications#slack_state=original&slack_code=fixture", api);
  await waitFor(() => expect(api.slack).toHaveBeenCalledWith("callback", base, {state:"original",code:"fixture"}));
  expect(sessionStorage.getItem("ship-ping-slack-state")).toBeNull();
});
it("슬랙 연결을 시작할 수 없으면 알림 설정에 서버 안내를 표시한다", async () => {
  const api = fake();
  const message = "슬랙 연결이 아직 준비되지 않았어요.";
  vi.mocked(api.slack).mockRejectedValueOnce(new Error(message));
  open("/apps/a/notifications", api);
  fireEvent.click(await screen.findByRole("button", { name: "Slack에 추가" }));
  expect(await screen.findByText(message)).toBeTruthy();
});
it("받을 곳 없음, 연결 끊김, 연결됨 상태와 시험 알림을 표시한다", async () => {
  const api = fake();
  open("/apps/a/notifications", api);
  await screen.findByText("알림을 받을 곳이 없어요.");
  expect(screen.getByRole("button", { name: "Slack에 추가" })).toBeTruthy();
  vi.mocked(api.settings).mockResolvedValue({
    email: true,
    broken: true,
    connected: false,
    channel: "#모임",
  });
  fireEvent.click(screen.getByRole("switch"));
  expect((await screen.findByText("연결이 끊겼어요")).classList.contains("bad")).toBe(true);
  vi.mocked(api.settings).mockResolvedValue({
    email: false,
    broken: false,
    connected: true,
    channel: "#모임",
  });
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(
    await screen.findByRole("button", { name: "시험 알림 보내기" }),
  );
  await waitFor(() => expect(api.testSlack).toHaveBeenCalledWith("a"));
});
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
it("베타 정원이 차면 앱 등록 화면에 이유를 표시한다", async () => {
  const api = fake();
  vi.mocked(api.create).mockRejectedValue({ code: "PT409", message: "beta capacity reached" });
  open("/apps/new", api);
  fireEvent.change(await screen.findByLabelText("앱 이름 (필수)"), {
    target: { value: "새 앱" },
  });
  fireEvent.click(screen.getByRole("button", { name: "등록" }));
  expect(await screen.findByText("베타 정원이 찼어요")).toBeTruthy();
  expect(api.issue).not.toHaveBeenCalled();
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
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 없이 메일 링크로 받기" }));
  await waitFor(() => expect(api.login).toHaveBeenCalledWith(email.value));
});
it("가입은 일치하는 비밀번호로 한 번만 요청하고 메일 안내를 표시한다", async () => {
  const api = fake(null);
  open("/signup", api);
  fireEvent.change(await screen.findByLabelText("이메일 주소"), {target:{value:"member@example.invalid"}});
  const password = screen.getByLabelText("새 비밀번호") as HTMLInputElement;
  const confirm = screen.getByLabelText("비밀번호 확인");
  fireEvent.change(password, {target:{value:"example phrase"}});
  fireEvent.change(confirm, {target:{value:"different phrase"}});
  const button = screen.getByRole("button", {name:"회원 가입"});
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(api.signup).not.toHaveBeenCalled();
  fireEvent.change(confirm, {target:{value:"example phrase"}});
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByText("이 메일 링크는 링크를 연 기기에서 로그인돼요.");
  expect(api.signup).toHaveBeenCalledTimes(1);
  expect(password.value).toBe("");
});
it("일반 로그인 세션에서 재설정 주소를 열면 메일을 다시 요청한다", async () => {
  const api = fake();
  open("/reset-password", api);
  fireEvent.click(await screen.findByRole("link", {name:"재설정 메일 다시 받기"}));
  fireEvent.change(await screen.findByLabelText("이메일 주소"), {target:{value:"member@example.invalid"}});
  fireEvent.click(screen.getByRole("button",{name:"비밀번호 찾기"}));
  await screen.findByText(/재설정 메일을 받을 수 있어요/);
  expect(api.requestReset).toHaveBeenCalledWith("member@example.invalid");
  expect(api.updatePassword).not.toHaveBeenCalled();
});
it("복구 세션에서 저장하면 내 앱으로 이동한다", async () => {
  const api = fake();
  api.listen = listener => { listener("member", true); return () => {}; };
  open("/reset-password", api);
  fireEvent.change(await screen.findByLabelText("새 비밀번호"), {target:{value:"example phrase"}});
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), {target:{value:"example phrase"}});
  fireEvent.click(screen.getByRole("button",{name:"새 비밀번호 정하기"}));
  await screen.findByRole("heading",{name:"내 앱"});
  expect(api.updatePassword).toHaveBeenCalledWith("example phrase");
});
it.each(["weak_password","same_password"])("복구 중 %s는 비밀번호 칸에서 고친다", async code => {
  const api = fake();
  api.listen = listener => { listener("member", true); return () => {}; };
  vi.mocked(api.updatePassword).mockRejectedValue({code});
  open("/reset-password", api);
  const field = await screen.findByLabelText("새 비밀번호");
  fireEvent.change(field,{target:{value:"example phrase"}});
  fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"example phrase"}});
  fireEvent.click(screen.getByRole("button",{name:"새 비밀번호 정하기"}));
  await screen.findByRole("alert");
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(field);
});
it("재인증 번호 오류와 만료 후 재전송하고, 재조회 실패에도 저장 안내와 초점을 유지한다", async () => {
  const api = fake();
  vi.mocked(api.account).mockResolvedValueOnce({email:"member@example.invalid",joined:app.created_at,method:"메일 링크"})
    .mockRejectedValue(new Error("offline"));
  vi.mocked(api.updatePassword).mockRejectedValueOnce({code:"reauthentication_needed"})
    .mockRejectedValueOnce({code:"reauthentication_not_valid"}).mockRejectedValueOnce({code:"otp_expired"});
  open("/account",api);
  fireEvent.click(await screen.findByRole("button",{name:"비밀번호 만들기"}));
  fireEvent.change(screen.getByLabelText("새 비밀번호"),{target:{value:"example phrase"}});
  fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"example phrase"}});
  const save = screen.getByRole("button",{name:"비밀번호 저장"});
  fireEvent.click(save);
  const field = await screen.findByLabelText("메일 인증번호");
  expect(api.reauthenticate).toHaveBeenCalledTimes(1);
  fireEvent.change(field,{target:{value:"123123"}});
  save.focus();
  expect(document.activeElement).toBe(save);
  fireEvent.click(save);
  await screen.findByText(/번호를 다시 확인/);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(field);
  save.focus();
  expect(document.activeElement).toBe(save);
  fireEvent.click(save);
  await screen.findByText(/번호가 만료/);
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(field);
  fireEvent.click(screen.getByRole("button",{name:"번호 다시 받기"}));
  await waitFor(() => expect(api.reauthenticate).toHaveBeenCalledTimes(2));
  fireEvent.change(field,{target:{value:"456456"}});
  fireEvent.click(save);
  await screen.findByText("비밀번호를 저장했어요.");
  expect(api.updatePassword).toHaveBeenLastCalledWith("example phrase","456456");
  expect(api.account).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(screen.getByRole("button",{name:"비밀번호 바꾸기"}));
});
it("메일 링크 회원이 비밀번호를 만들면 방법과 변경 단추가 갱신된다", async () => {
  const api = fake();
  vi.mocked(api.account).mockResolvedValueOnce({email:"member@example.invalid",joined:app.created_at,method:"메일 링크"})
    .mockResolvedValue({email:"member@example.invalid",joined:app.created_at,method:"이메일과 비밀번호, 메일 링크",hasPassword:true});
  open("/account", api);
  fireEvent.click(await screen.findByRole("button",{name:"비밀번호 만들기"}));
  fireEvent.change(screen.getByLabelText("새 비밀번호"), {target:{value:"example phrase"}});
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), {target:{value:"example phrase"}});
  fireEvent.click(screen.getByRole("button",{name:"비밀번호 저장"}));
  await screen.findByRole("button",{name:"비밀번호 바꾸기"});
  await screen.findByText("이메일과 비밀번호, 메일 링크");
  expect(api.account).toHaveBeenCalledTimes(2);
  expect(screen.queryByDisplayValue("example phrase")).toBeNull();
});
it("인증번호 발송 실패 후 다시 받고 빈 번호 제출 시 입력 칸으로 돌아간다", async () => {
  const api = fake();
  vi.mocked(api.updatePassword).mockRejectedValueOnce({code:"reauthentication_needed"});
  vi.mocked(api.reauthenticate).mockRejectedValueOnce(Error("offline"));
  open("/account",api);
  fireEvent.click(await screen.findByRole("button",{name:"비밀번호 만들기"}));
  fireEvent.change(screen.getByLabelText("새 비밀번호"),{target:{value:"example phrase"}});
  fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"example phrase"}});
  const save = screen.getByRole("button",{name:"비밀번호 저장"});
  fireEvent.click(save);
  await screen.findByText("인증번호를 보내지 못했어요. 잠시 뒤 번호를 다시 받아 주세요.");
  fireEvent.click(screen.getByRole("button",{name:"번호 다시 받기"}));
  await screen.findByText("본인 확인을 위해 메일로 보낸 번호를 적어 주세요.");
  const field = screen.getByLabelText("메일 인증번호");
  expect(document.activeElement).toBe(field);
  save.focus();
  fireEvent.click(save);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("메일로 받은 번호를 적어 주세요.");
  expect(field.getAttribute("aria-describedby")).toBe(alert.id);
  expect(document.activeElement).toBe(field);
  expect(api.updatePassword).toHaveBeenCalledTimes(1);
});

it.each([
  [500, "저장하지 못했어요. 다른 비밀번호로 다시 시도해 주세요."],
  [429, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."],
] as const)("비밀번호 저장 %s 오류를 안내하고 재시도를 허용한다", async (status, message) => {
  const api = fake();
  vi.mocked(api.updatePassword).mockRejectedValueOnce({status});
  open("/account",api);
  fireEvent.click(await screen.findByRole("button",{name:"비밀번호 만들기"}));
  fireEvent.change(screen.getByLabelText("새 비밀번호"),{target:{value:"example phrase"}});
  fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"example phrase"}});
  const save = screen.getByRole("button",{name:"비밀번호 저장"});
  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toBe(message);
  fireEvent.click(save);
  await screen.findByText("비밀번호를 저장했어요.");
});
it.each(["Ab!12", "password"])("가입에서 취약한 비밀번호 %s 제출을 막는다", async password => {
  const api = fake(null);
  open("/signup", api);
  fireEvent.change(await screen.findByLabelText("이메일 주소"), {target:{value:"member@example.invalid"}});
  const field = screen.getByLabelText("새 비밀번호");
  fireEvent.change(field, {target:{value:password}});
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), {target:{value:password}});
  fireEvent.click(screen.getByRole("button",{name:"회원 가입"}));
  expect(field.getAttribute("aria-describedby")?.split(" ")).toContain((await screen.findByRole("alert")).id);
  expect(document.activeElement).toBe(field);
  expect(api.signup).not.toHaveBeenCalled();
});

it.each([
  ["/login", "로그인", new TypeError("Failed to fetch"), /인터넷 연결/],
  ["/login", "로그인", {status:429}, /요청이 너무 많/],
  ["/forgot-password", "비밀번호 찾기", {status:429}, /요청이 너무 많/],
  ["/forgot-password", "비밀번호 찾기", {status:500}, /메일을 보내지 못/],
] as const)("인증 실패 원인을 구분한다 %s %s %o", async (path, button, error, message) => {
  const api = fake(null);
  vi.mocked(api.passwordLogin).mockRejectedValue(error);
  vi.mocked(api.requestReset).mockRejectedValue(error);
  open(path, api);
  fireEvent.change(await screen.findByLabelText("이메일 주소"), {target:{value:"member@example.invalid"}});
  if (path === "/login") fireEvent.change(screen.getByLabelText("비밀번호"), {target:{value:"example phrase"}});
  fireEvent.click(screen.getByRole("button",{name:button}));
  expect((await screen.findByRole("alert")).textContent).toMatch(message);
});

it("저장 뒤 계정 재조회가 실패하면 계정 정보를 다시 불러올 수 있다", async () => {
  const api = fake();
  const member = {email:"member@example.invalid",joined:app.created_at,method:"메일 링크"};
  vi.mocked(api.account).mockResolvedValueOnce(member).mockRejectedValueOnce(Error())
    .mockResolvedValue({...member,hasPassword:true,method:"이메일과 비밀번호, 메일 링크"});
  open("/account",api);
  fireEvent.click(await screen.findByRole("button",{name:"비밀번호 만들기"}));
  fireEvent.change(screen.getByLabelText("새 비밀번호"),{target:{value:"example phrase"}});
  fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"example phrase"}});
  fireEvent.click(screen.getByRole("button",{name:"비밀번호 저장"}));
  expect((await screen.findByRole("alert")).textContent).toContain("계정");
  fireEvent.click(screen.getByRole("button",{name:"다시 불러오기"}));
  await screen.findByText("이메일과 비밀번호, 메일 링크");
  expect(api.account).toHaveBeenCalledTimes(3);
  await screen.findByRole("button",{name:"비밀번호 바꾸기"});
  expect(api.updatePassword).toHaveBeenCalledTimes(1);
});

it.each(["완료","취소","만료", "저장 중 만료"])("복구 %s 뒤 같은 회원이 다시 열어도 새 링크가 필요하다", async reason => {
  const api = fake();
  let notify: Parameters<Gateway["listen"]>[0] = () => {};
  api.listen = listener => { notify = listener; listener("member", true); return () => {}; };
  render(<MemoryRouter initialEntries={["/reset-password"]}><Link to="/reset-password">복구 주소 열기</Link><App api={api} ingest={base}/></MemoryRouter>);
  const field = await screen.findByLabelText("새 비밀번호");
  if (reason === "완료") {
    fireEvent.change(field,{target:{value:"example phrase"}});
    fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"example phrase"}});
    fireEvent.click(screen.getByRole("button",{name:"새 비밀번호 정하기"}));
    await screen.findByRole("heading",{name:"내 앱"});
  } else if (reason === "취소") {
    fireEvent.click(screen.getByRole("link",{name:"재설정 메일 다시 받기"}));
    await screen.findByRole("heading",{name:"비밀번호 찾기"});
  } else if (reason === "저장 중 만료") {
    vi.mocked(api.updatePassword).mockRejectedValue({code:"session_expired"});
    fireEvent.change(field,{target:{value:"example phrase"}});
    fireEvent.change(screen.getByLabelText("비밀번호 확인"),{target:{value:"example phrase"}});
    fireEvent.click(screen.getByRole("button",{name:"새 비밀번호 정하기"}));
    await screen.findByRole("alert");
  } else {
    act(() => notify(null));
    act(() => notify("member"));
  }
  fireEvent.click(screen.getByRole("link",{name:"복구 주소 열기"}));
  expect((await screen.findByRole("alert")).textContent).toContain("만료");
  expect(screen.queryByLabelText("새 비밀번호")).toBeNull();
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
  await screen.findByRole("button", { name: "로그인" });
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
