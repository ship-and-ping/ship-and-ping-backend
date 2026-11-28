import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { axe } from "vitest-axe";
import { App } from "./App";
import { LoginWaiting } from "./LoginApproval";
import { buildConnectPrompt, validateApp } from "./domain";
import type { Gateway, Snapshot } from "./data";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.removeItem("ship-ping-login-request");
  sessionStorage.removeItem("ship-ping-login-issue");
});
const pub = "sp_pub_" + "0".repeat(64);
const secret = "sp_srv_" + "1".repeat(64);
const renderedDocument = () => new XMLSerializer().serializeToString(document.body);
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
    devices: vi.fn(async () => []), removeDevice: vi.fn(),
    withPushRegistration: action => action({registerPush:vi.fn(),removeEndpoint:vi.fn()}),
    pushEnabled: vi.fn(), testPush: vi.fn(),
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
it("PC 로그인 요청을 승인할 수 있는 시간을 대기 화면에 안내한다", () => {
  const request = {request_id:"sample", poll_secret:"fixture", match_code:"07", expires_at:new Date(Date.now()+600000).toISOString()};
  render(<LoginWaiting api={fake(null)} request={request} restart={vi.fn()}/>);
  expect(screen.getByText(/PC의 로그인 요청은 10분 동안만 승인할 수 있어요/)).toBeTruthy();
});
it("requires a PC number before mobile approval and allows immediate refusal", async () => {
  const api = fake();
  api.requests = {create:vi.fn(),poll:vi.fn(),decide:vi.fn()
    .mockResolvedValueOnce({status:"pending",client_info:{browser:"Firefox",place:"KR"},created_at:app.created_at})
    .mockResolvedValueOnce({status:"denied"})};
  open("/login/approve?req=sample&proof=fixture",api);
  const approve = await screen.findByRole<HTMLButtonElement>("button",{name:"이 PC 로그인 승인"});
  expect(approve.disabled).toBe(true);
  expect(screen.getByText(/요청한 적이 없다면 숫자 없이 거절/)).toBeTruthy();
  const input = screen.getByRole("textbox",{name:"PC 확인 숫자 두 자리"});
  expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("내가 쓰는 PC인지");
  fireEvent.change(input,{target:{value:"0"}});
  expect(approve.disabled).toBe(true);
  fireEvent.change(input,{target:{value:"07"}});
  expect(approve.disabled).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"거절"}));
  expect(await screen.findByText("휴대폰에서 거절했어요.")).toBeTruthy();
  expect(screen.getByRole("heading",{name:"PC 로그인 요청 결과"})).toBeTruthy();
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

const issuePath = "/apps/10000000-0000-0000-0000-000000000001/issues/20000000-0000-0000-0000-000000000002";
const issueHint = "알림에서 온 문제를 열려면 로그인해 주세요.";
function LocationProbe() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}
function openWithPath(path: string, api: Gateway) {
  return render(<MemoryRouter initialEntries={[path]}><LocationProbe/><App api={api} ingest={base}/></MemoryRouter>);
}
it.each(["/login", "/login/"])("%s 상단에는 회원 가입 링크를 표시한다", async path => {
  open(path, fake(null));
  const menu = within(await screen.findByRole("navigation", {name:"시작 메뉴"}));
  expect(menu.getByRole("link", {name:"회원 가입"}).getAttribute("href")).toBe("/signup");
  expect(menu.queryByRole("link", {name:"로그인"})).toBeNull();
});

const approvalUrl = "/login/approve?req=sample&proof=fixture";
const pendingRequest = () => ({
  request_id:"sample", poll_secret:"fixture", match_code:"07", expires_at:new Date(Date.now()+600000).toISOString(),
});

it("메일 로그인을 요청한 브라우저의 새 탭에서 승인하면 원래 문제를 한 번 연다", async () => {
  const guest = fake(null);
  vi.mocked(guest.login).mockResolvedValue(pendingRequest());
  guest.requests = {create:vi.fn(), poll:vi.fn().mockResolvedValue("pending"), decide:vi.fn()};
  const requestTab = openWithPath(issuePath + "?source=mail#extra", guest);
  await screen.findByText(issueHint);
  fireEvent.change(screen.getByLabelText("이메일 주소"), {target:{value:"member@example.invalid"}});
  fireEvent.click(screen.getByRole("button", {name:/메일 링크로 받기/}));
  await screen.findByRole("heading", {name:"메일을 확인해 주세요"});
  requestTab.unmount();
  sessionStorage.removeItem("ship-ping-login-issue"); // A new tab shares localStorage only.
  const member = fake();
  vi.mocked(member.monitor).mockRejectedValue(Error("not available"));
  member.requests = {create:vi.fn(), poll:vi.fn(), decide:vi.fn()
    .mockResolvedValueOnce({status:"used", local_consumed:true}).mockResolvedValue({status:"used"})};
  const approvalTab = openWithPath(approvalUrl, member);
  await waitFor(() => expect(screen.getByTestId("path").textContent).toBe(issuePath));
  expect(member.requests.decide).toHaveBeenCalledWith("sample","local","fixture",undefined,"fixture");
  expect(localStorage.getItem("ship-ping-login-request")).toBeNull();
  approvalTab.unmount();
  openWithPath(approvalUrl, member);
  await screen.findByText("이미 처리한 요청이에요.");
  expect(screen.getByTestId("path").textContent).toBe("/login/approve");
});

it("다른 기기의 승인 탭은 숫자를 확인한 뒤 요청 PC에서 계속하도록 안내한다", async () => {
  const member = fake();
  member.requests = {create:vi.fn(), poll:vi.fn(), decide:vi.fn()
    .mockResolvedValueOnce({status:"pending"}).mockResolvedValueOnce({status:"approved"})};
  openWithPath(approvalUrl + "&next=" + issuePath, member);
  const code = await screen.findByRole("textbox", {name:"PC 확인 숫자 두 자리"});
  fireEvent.change(code, {target:{value:"07"}});
  fireEvent.click(screen.getByRole("button", {name:"이 PC 로그인 승인"}));
  await screen.findByRole("heading", {name:"승인했어요."});
  expect(screen.getByText("로그인을 요청한 기기에서 이어서 보세요.")).toBeTruthy();
  expect(member.requests.decide).toHaveBeenCalledWith("sample","approve","fixture","07");
  expect(screen.getByTestId("path").textContent).toBe("/login/complete");
  fireEvent.click(screen.getByRole("link", {name:"내 앱으로 가기"}));
  await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/apps"));
});

it("동시에 두 승인 탭이 used를 받아도 요청을 소비한 탭만 원래 문제로 간다", async () => {
  localStorage.setItem("ship-ping-login-request", JSON.stringify({...pendingRequest(), issuePath}));
  const member = fake();
  vi.mocked(member.monitor).mockRejectedValue(Error("not available"));
  const replies: ((result: {status:string; local_consumed?:boolean}) => void)[] = [];
  const decide = vi.fn(() => new Promise<{status:string; local_consumed?:boolean}>(resolve => replies.push(resolve)));
  member.requests = {create:vi.fn(), poll:vi.fn(), decide};
  const winner = openWithPath(approvalUrl, member);
  const duplicate = openWithPath(approvalUrl, member);
  await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
  await act(async () => replies[1]({status:"used"}));
  expect(within(duplicate.container).getByText("이미 처리한 요청이에요.")).toBeTruthy();
  expect(localStorage.getItem("ship-ping-login-request")).toBeTruthy();
  await act(async () => replies[0]({status:"used",local_consumed:true}));
  expect(within(winner.container).getByTestId("path").textContent).toBe(issuePath);
  expect(within(duplicate.container).getByTestId("path").textContent).toBe("/login/approve");
  expect(localStorage.getItem("ship-ping-login-request")).toBeNull();
  expect(member.monitor).toHaveBeenCalledTimes(1);
});

it.each(["//outside.invalid", "https://outside.invalid", issuePath.replace("/issues/", "\\issues/"), encodeURIComponent(issuePath), issuePath + "?extra=1"])(
  "새 탭은 승인 요청에 저장된 잘못된 복귀 경로 %s를 버린다", async issue => {
    localStorage.setItem("ship-ping-login-request", JSON.stringify({...pendingRequest(), issuePath:issue}));
    const member = fake();
    member.requests = {create:vi.fn(), poll:vi.fn(), decide:vi.fn().mockResolvedValue({status:"used",local_consumed:true})};
    openWithPath(approvalUrl, member);
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/apps"));
    expect(localStorage.getItem("ship-ping-login-request")).toBeNull();
  },
);
it("알림 문제 경로만 새로고침 후 로그인에서 한 번 복원하고 기존 권한 오류를 표시한다", async () => {
  const guest = fake(null);
  const first = openWithPath(issuePath + "?source=email#details", guest);
  await screen.findByText(issueHint);
  expect(screen.getByTestId("path").textContent).toBe("/login");
  first.unmount();
  const member = fake(null);
  vi.mocked(member.monitor).mockRejectedValue(Error("not available"));
  let session!: (id: string | null) => void;
  member.listen = callback => { session = callback; return () => {}; };
  const second = openWithPath("/login", member);
  await screen.findByText(issueHint);
  await act(async () => session("another-member"));
  await screen.findByRole("heading", { name: "기록을 불러오지 못했어요" });
  expect(screen.getByTestId("path").textContent).toBe(issuePath);
  second.unmount();
  openWithPath("/login", fake());
  await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/apps"));
});

it.each(["//outside.invalid/path", "https://outside.invalid", "/account", "/apps/a/issues/%2Foutside"])(
  "저장된 값 %s은 알림 문제 경로로 사용하지 않는다", async value => {
    sessionStorage.setItem("ship-ping-login-issue", value);
    openWithPath("/login", fake());
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/apps"));
    expect(sessionStorage.getItem("ship-ping-login-issue")).toBeNull();
  },
);
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
it.each([false,true])("로그아웃 실패 시 계정 화면을 유지하고 선택한 방법으로 마친다 (기기만 %s)", async deviceOnly => {
  const api = fake();
  vi.mocked(api.logout).mockRejectedValueOnce(Error("offline"));
  open("/account",api);
  const account = within(await screen.findByRole("main"));
  fireEvent.click(await account.findByRole("button",{name:"로그아웃"}));
  await account.findByText("로그아웃을 끝내지 못했어요. 인터넷 연결 후 다시 시도해 주세요.");
  expect(account.getByText("이 기기에서 알림 내용은 가려지지만, 다시 로그인하기 전까지 '쉽앤핑 알림이 있어요' 표시가 올 수 있어요.")).toBeTruthy();
  expect(account.getByRole("heading",{name:"내 계정"})).toBeTruthy();
  fireEvent.click(account.getByRole("button",{name:deviceOnly ? "그래도 이 기기에서 로그아웃" : "다시 시도"}));
  await screen.findByRole("heading",{name:"로그인"});
  expect(api.logout).toHaveBeenLastCalledWith({deviceOnly});
  const title = await screen.findByText(deviceOnly ? "이 기기에서 로그아웃했어요" : "로그아웃했어요");
  const toast = within(title.closest('[role="status"]') as HTMLElement);
  expect(toast.getByText(deviceOnly ? /알림 내용은 가려지지만/ : "푸시 알림은 다시 로그인하면 알림 설정에서 켤 수 있어요.")).toBeTruthy();
});

it.each([false,true])("waits for sign-out without repeating the withdrawal (device only %s)", async deviceOnly => {
  const api = fake();
  let finish!: () => void;
  vi.mocked(api.logout).mockRejectedValueOnce(Error("sign-out unavailable"))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open("/account",api);
  fireEvent.click(await screen.findByRole("button",{name:"회원 탈퇴"}));
  fireEvent.change(screen.getByLabelText("로그인 이메일 다시 입력"),{target:{value:"<me>@example.invalid"}});
  fireEvent.click(screen.getByRole("button",{name:"모든 앱과 기록을 지우고 탈퇴"}));
  await screen.findByText("로그아웃을 끝내지 못했어요. 인터넷 연결 후 다시 시도해 주세요.");
  expect(screen.getByRole("heading",{name:"회원 탈퇴"})).toBeTruthy();
  fireEvent.click(await screen.findByRole("button",{name:deviceOnly ? "그래도 이 기기에서 로그아웃" : "다시 시도"}));
  expect(screen.queryByText("탈퇴를 마쳤어요")).toBeNull();
  await act(async () => finish());
  await screen.findByText("탈퇴를 마쳤어요");
  expect(api.logout).toHaveBeenCalledTimes(2);
  expect(api.logout).toHaveBeenLastCalledWith({accountDeleted:true,deviceOnly});
  expect(api.withdraw).toHaveBeenCalledOnce();
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
      fireEvent.click(screen.getByRole("button",{name:"키 교체 요청문 복사(새 키 포함)"}));
      const prompt = copy.mock.lastCall?.[0] as string;
      expect(prompt.match(/sp_(?:pub|srv)_\w+/g)).toEqual([raw]);
      expect(prompt.split("\n")).toContain("이 앱의 새 쉽앤핑 키: " + raw);
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
it("알림 설정은 앱 푸시, 이메일, 선택형 슬랙 순서로 읽는다", async () => {
  open("/apps/a/notifications", fake());
  const push = (await screen.findByRole("heading", {name:"앱 푸시"})).closest("section")!;
  expect(push.textContent).toContain("홈 화면");
  expect(push.nextElementSibling?.querySelector("h2")?.textContent).toBe("이메일");
  expect(push.nextElementSibling?.nextElementSibling?.querySelector("h2")?.textContent).toBe("슬랙");
});
it("이메일 설정 저장 중에는 이전 상태를 유지하고 실패하면 다시 시도할 수 있다", async () => {
  const api = fake();
  let rejectSave!: (reason: Error) => void;
  vi.mocked(api.emailSetting).mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
  open("/apps/a/notifications", api);
  const toggle = await screen.findByRole<HTMLButtonElement>("switch", {name:"이메일로도 받기"});
  fireEvent.click(toggle);
  expect(toggle.disabled).toBe(true);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("이메일 알림 설정을 저장하는 중이에요.")).toBeTruthy();
  fireEvent.click(toggle);
  expect(api.emailSetting).toHaveBeenCalledTimes(1);
  rejectSave(new Error("다시 시도해 주세요."));
  await screen.findByText("다시 시도해 주세요.");
  expect(toggle.disabled).toBe(false);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  vi.mocked(api.settings).mockResolvedValueOnce({email:true,connected:false,broken:false,channel:null});
  fireEvent.click(toggle);
  await screen.findByText("이메일 알림이 켜졌어요.");
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});
it.each([false, true])("이메일 설정(%s)을 바꾼 뒤 재조회가 실패해도 저장한 값을 유지한다", async email => {
  const api = fake();
  const settings = {email, connected:false, broken:false, channel:null};
  vi.mocked(api.settings).mockResolvedValueOnce(settings)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({...settings, email:!email, connected:true, channel:"#모임"});
  open("/apps/a/notifications", api);
  const toggle = await screen.findByRole("switch");
  fireEvent.click(toggle);
  await screen.findByText(/최신 상태를 불러오지 못했어요/);
  expect(toggle.getAttribute("aria-checked")).toBe(String(!email));
  expect(screen.getByText(email ? "이메일 알림이 꺼졌어요." : "이메일 알림이 켜졌어요.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"다시 불러오기"}));
  await screen.findByText("#모임 채널로 보내요.");
  expect(screen.queryByText(/최신 상태를 불러오지 못했어요/)).toBeNull();
  expect(api.emailSetting).toHaveBeenCalledTimes(1);
  expect(api.emailSetting).toHaveBeenCalledWith("a", !email);
});
it.each([
  [true, "잠시 뒤 슬랙에서 확인해 주세요."],
  [false, "잠시 뒤 다시 시도해 주세요. 시험 알림은 분당 한 번 보낼 수 있어요."],
] as const)("시험 슬랙 예약 성공(%s)은 토스트에 표시하고 재조회 실패와 구분한다", async (reserved, result) => {
  const api = fake();
  const settings = {email:false, connected:true, broken:false, channel:"#모임"};
  let finish!: (reserved: boolean) => void;
  let failRefresh!: (error: Error) => void;
  vi.mocked(api.testSlack).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(api.settings).mockResolvedValueOnce(settings)
    .mockImplementationOnce(() => new Promise((_, reject) => { failRefresh = reject; }))
    .mockResolvedValue(settings);
  open("/apps/a/notifications", api);
  const send = await screen.findByRole("button", {name:"시험 알림 보내기"});
  const panel = within(send.closest("section")!);
  fireEvent.click(send);
  expect(panel.getByRole<HTMLButtonElement>("button", {name:"시험 알림 요청 중"}).disabled).toBe(true);
  await act(async () => finish(reserved));
  expect(panel.getByRole("button", {name:"시험 알림 보내기"})).toBeTruthy();
  const feedback = reserved ? within(screen.getByRole("article")) : panel;
  expect(feedback.getByText(result)).toBeTruthy();
  if (!reserved) expect(screen.queryByRole("article")).toBeNull();
  await act(async () => failRefresh(new Error("offline")));
  await screen.findByText(/최신 상태를 불러오지 못했어요/);
  expect(feedback.getByText(result)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"다시 불러오기"}));
  await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(3));
  expect(api.testSlack).toHaveBeenCalledTimes(1);
});
it.each(["지연", "실패"] as const)("슬랙 해제 후 재조회 %s 중에도 해제된 상태를 표시한다", async (refresh) => {
  const api = fake();
  let finishDisconnect!: () => void;
  vi.mocked(api.disconnectSlack).mockImplementationOnce(() => new Promise(resolve => { finishDisconnect = resolve; }));
  vi.mocked(api.settings)
    .mockResolvedValueOnce({ email: false, connected: true, broken: false, channel: "#모임" })
    .mockImplementationOnce(() => refresh === "지연" ? new Promise(() => {}) : Promise.reject(new Error("offline")));
  open("/apps/a/notifications", api);
  const disconnect = await screen.findByRole("button", { name: "슬랙 연결 끊기" });
  expect(screen.getByRole("button", { name: "시험 알림 보내기" })).toBeTruthy();
  expect(screen.queryByText("알림을 받을 곳이 없어요.")).toBeNull();
  fireEvent.click(disconnect);
  expect(screen.getByText(/연결됐어요/)).toBeTruthy();
  await act(async () => finishDisconnect());
  if (refresh === "지연") {
    await screen.findByText("최신 상태를 불러오는 중이에요.");
  } else {
    await screen.findByText(/최신 상태를 불러오지 못했어요/);
  }
  expect(api.disconnectSlack).toHaveBeenCalledWith("a");
  expect(screen.queryByText(/연결됐어요/)).toBeNull();
  expect(screen.queryByRole("button", { name: "시험 알림 보내기" })).toBeNull();
  expect(screen.getByRole("button", { name: "Slack에 추가" })).toBeTruthy();
  expect(screen.getByText("알림을 받을 곳이 없어요.")).toBeTruthy();
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
    await screen.findByRole("button", { name: "수집 키 재발급" }),
  );
  const copy = await screen.findByRole("button", { name: "연결 요청문 복사(키 포함)" });
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
  fireEvent.click(screen.getByRole("button", { name: "서버 있음" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 재발급" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 복사" }));
  expect(writeText).toHaveBeenLastCalledWith(secret);
  expect(new XMLSerializer().serializeToString(document.body)).not.toContain(
    secret,
  );
  fireEvent.click(screen.getByRole("link", { name: "내 앱" }));
  fireEvent.click(await screen.findByRole("link", { name: /두 번째 앱/ }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 있음" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 재발급" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 복사" }));
  expect(writeText).toHaveBeenLastCalledWith("sp_srv_" + "2".repeat(64));
  fireEvent.click(screen.getByRole("button", { name: "연결 요청문 복사(키 포함)" }));
  expect(writeText).toHaveBeenLastCalledWith(buildConnectPrompt("sp_srv_" + "2".repeat(64), base));
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
    await screen.findByRole("button", { name: "수집 키 재발급" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "연결 요청문 복사(키 포함)" }),
  );
  await screen.findByText(/자동 복사가 막혔어요/);
  const field = screen.getByLabelText(
    "연결 요청문 복사(키 포함) 전문",
  ) as HTMLTextAreaElement;
  expect(field.value).toContain("••••");
  expect(renderedDocument()).not.toContain(pub);
  expect(screen.getByText("화면을 공유 중이라면 먼저 공유를 멈춰 주세요. 이 글에는 앱 키가 들어 있어요.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "키 포함해서 보기" }));
  expect(document.activeElement).toBe(field);
  expect(field.selectionEnd - field.selectionStart).toBe(field.value.length);
  expect(field.value).toBe(buildConnectPrompt(pub, base));
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(renderedDocument()).not.toContain(pub);
  expect(field.value).not.toContain(pub);
});
it("설정에서 닫은 키 교체 요청문은 복사를 다시 시도해도 가려진다", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  try {
    open("/apps/a/settings");
    fireEvent.click(await screen.findByRole("button", { name: "서버 키 재발급" }));
    const copyTitle = "키 교체 요청문 복사(새 키 포함)";
    fireEvent.click(await screen.findByRole("button", { name: copyTitle }));
    const reveal = await screen.findByRole("button", { name: "키 포함해서 보기" });
    const field = screen.getByLabelText(copyTitle + " 전문") as HTMLTextAreaElement;
    expect(renderedDocument()).not.toContain(secret);
    fireEvent.click(reveal);
    expect(field.value).toContain("이 앱의 새 쉽앤핑 키: " + secret);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("button", { name: copyTitle }));
    await screen.findByRole("button", { name: "키 포함해서 보기" });
    expect(field.value).toContain("••••");
    expect(renderedDocument()).not.toContain(secret);
  } finally {
    confirm.mockRestore();
  }
});
it("베타 정원이 차면 앱 등록 화면에 이유를 표시한다", async () => {
  const api = fake();
  vi.mocked(api.create).mockRejectedValue({ code: "PT409", message: "beta capacity reached" });
  open("/apps/new", api);
  fireEvent.change(await screen.findByLabelText("앱 이름 (필수)"), {
    target: { value: "새 앱" },
  });
  fireEvent.click(screen.getByRole("button", { name: "등록하고 연결하기" }));
  expect(await screen.findByText("베타 정원이 찼어요")).toBeTruthy();
  expect(api.issue).not.toHaveBeenCalled();
});
it("등록한 수집 키는 미리 보기에서 가리고 화면을 다시 열면 폐기한다", async () => {
  const api = fake();
  open("/apps/new", api);
  fireEvent.change(await screen.findByLabelText("앱 이름 (필수)"), {
    target: { value: " 내 앱 " },
  });
  fireEvent.click(screen.getByRole("button", { name: "등록하고 연결하기" }));
  const preview = (await screen.findByLabelText(
    "연결 요청문 복사(키 포함) 전문",
  )) as HTMLTextAreaElement;
  expect(api.create).toHaveBeenCalledWith("내 앱", "");
  expect(api.issue).toHaveBeenCalledWith("a", "pub");
  expect(preview.value).not.toContain(pub);
  expect(preview.value).toContain("••••");
  fireEvent.click(screen.getByRole("link", { name: "내 앱" }));
  fireEvent.click(await screen.findByRole("link", { name: /모임모아/ }));
  expect(
    await screen.findByRole("button", { name: "수집 키 재발급" }),
  ).toBeTruthy();
  expect(api.issue).toHaveBeenCalledTimes(1);
});
it("지도 이름을 바로 표시하고 나중에 도착한 이름도 확인 없이 표시한다", async () => {
  const api = fake();
  const proposed = {
    id: "a",
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
  expect(screen.getByDisplayValue("신청")).toBeTruthy();
  expect(screen.getByText("AI가 붙인 이름이에요. 고칠 것만 고치세요.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "모두 확인" })).toBeNull();
  expect(api.save).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByDisplayValue("예약")).toBeTruthy();
});
it("서버 키 단독 복사는 가리고 요청문은 키 포함해서 보기를 눌러야 공개한다", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  open("/apps/a/connect");
  fireEvent.click(await screen.findByRole("button", { name: "서버 있음" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 재발급" }));
  fireEvent.click(await screen.findByRole("button", { name: "서버 키 복사" }));
  expect(await screen.findByText(/클립보드 권한/)).toBeTruthy();
  expect(new XMLSerializer().serializeToString(document.body)).not.toContain(
    secret,
  );
  expect(screen.queryByLabelText("서버 키 복사 전문")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "연결 요청문 복사(키 포함)" }));
  const reveal = await screen.findByRole("button", { name: "키 포함해서 보기" });
  expect(renderedDocument()).not.toContain(secret);
  fireEvent.click(reveal);
  expect(screen.getByDisplayValue(buildConnectPrompt(secret, base), { normalizer: value => value })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "내 앱" }));
  await screen.findByRole("link", { name: /모임모아/ });
  expect(renderedDocument()).not.toContain(secret);
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
  await waitFor(() => expect(api.account).toHaveBeenCalledTimes(2));
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
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
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
  fireEvent.change(await screen.findByLabelText("기능 이름 1"), {target:{value:"새 이름"}});
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  expect(await screen.findByText(/200개를 넘어 저장하지 못했어요/)).toBeTruthy();
  expect(screen.queryByText(/저장했어요/)).toBeNull();
  expect(screen.queryByDisplayValue("초과")).toBeNull();
});
describe("연결 요청문과 등록 입력", () => {
  it.each(["/apps/new", "/apps/a/settings"])("%s 주소 칸에 선택 사항과 연결 방법을 안내한다", async path => {
    open(path);
    const field = await screen.findByLabelText("앱 주소 (선택 · 웹사이트나 스토어 링크)");
    expect(field.getAttribute("placeholder")).toBe("https://");
    expect(document.getElementById(field.getAttribute("aria-describedby")!)?.textContent)
      .toBe("비워 둬도 돼요. 연결은 주소가 아니라 다음 단계의 연결 키로 해요.");
  });
  it.each([
    "https://play.google.com/store/apps/details?id=com.example.app",
    "https://apps.apple.com/kr/app/example/id123456789",
  ])("스토어 주소 %s를 허용한다", url => {
    expect(validateApp("모임모아", url)).toEqual({});
  });
  it("휴대폰 앱의 연결 방식을 안내한다", async () => {
    open("/apps/a/connect");
    const guide = await screen.findByText(/휴대폰 앱\(플레이스토어·앱스토어\)이라면/);
    expect(guide.textContent).toBe("휴대폰 앱(플레이스토어·앱스토어)이라면 앱 서버에서 기록을 보내도록 서버 있음을 골라 주세요. 휴대폰 앱 코드는 바꾸지 않아도 돼요.");
  });
  it("공개 수집 키와 환경변수 이름만 제공한다", () => {
    const prompt = buildConnectPrompt(pub, base);
    expect(prompt).toContain(pub);
    expect(prompt).not.toContain("sp_srv_");
    for (const rule of [
      "SHIP_AND_PING_KEY",
      ".gitignore",
      "멈추고 나에게 물어봐",
      "/v1/feature-map",
      "쉽앤핑 수집 주소(INGEST_URL)는 예외",
    ])
      expect(prompt).toContain(rule);
    expect(() => buildConnectPrompt(secret + "\n", base)).toThrow();
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
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith("a", [
      expect.objectContaining({ id: "f", name: "참가 신청", hidden: true }),
    ]),
  );
});
