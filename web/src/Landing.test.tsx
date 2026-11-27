import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Landing } from "./Layout";

afterEach(cleanup);

function visit() {
  return render(<MemoryRouter><Landing/></MemoryRouter>);
}

it("헤더에서 로그인과 회원가입을 선택하고 각 가입 버튼으로 회원가입 화면에 간다", () => {
  const {container} = visit();
  expect(screen.getByRole("heading", {level:1}).textContent).toContain("양이 알려드려요");
  const nav = screen.getByRole("navigation", {name:"시작 메뉴"});
  expect(within(nav).getByRole("link", {name:"로그인"}).getAttribute("href")).toBe("/login");
  expect(within(nav).getByRole("link", {name:"회원가입"}).getAttribute("href")).toBe("/signup");
  for (const selector of [".lp-hero-start", ".lp-mobile-start", ".lp-footer .lp-start"]) {
    const link = container.querySelector(selector);
    expect(link?.textContent).toContain("회원가입");
    expect(link?.getAttribute("href")).toBe("/signup");
  }
  expect(container.textContent).not.toContain("무료로 시작");
});

it("알림 탭을 클릭하거나 방향키로 선택하면 초점과 패널이 함께 바뀐다", () => {
  visit();
  const list = screen.getByRole("tablist", {name:"알림 예시 채널"});
  const slack = within(list).getByRole("tab", {name:"슬랙"});
  const mail = within(list).getByRole("tab", {name:"이메일"});
  fireEvent.click(mail);
  expect(mail.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel", {name:"이메일"}).id).toBe(mail.getAttribute("aria-controls"));
  for (const [start, key, end] of [[mail,"ArrowRight",slack], [slack,"End",mail],
    [mail,"Home",slack], [slack,"ArrowLeft",mail]] as const) {
    fireEvent.keyDown(start, {key});
    expect(document.activeElement).toBe(end);
    expect(start.tabIndex).toBe(-1);
    expect(end.tabIndex).toBe(0);
    expect(screen.getByRole("tabpanel").id).toBe(end.getAttribute("aria-controls"));
  }
});

it.each(["슬랙", "이메일"])("%s 알림에서 같은 결제 지연의 상세를 연다", channel => {
  visit();
  fireEvent.click(screen.getByRole("tab", {name:channel}));
  const panel = within(screen.getByRole("tabpanel", {name:channel}));
  expect(panel.getByRole("heading", {name:/결제가 느려졌어요/})).toBeTruthy();
  const action = panel.getByText("쉽앤핑에서 보기");
  fireEvent.click(action);
  const detail = action.closest("details");
  expect(detail?.open).toBe(true);
  const content = within(detail!);
  expect(content.getByRole("heading", {name:"모임모아 · 결제 문제 상세"})).toBeTruthy();
  expect(content.getByText("결제 24건 · 평소 1.1초 → 최근 30분 3.4초")).toBeTruthy();
});

it("다섯 질문의 답을 각각 열고 다시 닫을 수 있다", () => {
  const {container} = visit();
  const disclosures = container.querySelectorAll<HTMLDetailsElement>(".lp-faq details");
  expect(disclosures).toHaveLength(5);
  for (const details of disclosures) {
    const summary = details.querySelector("summary")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
  }
});

it("알림 사례 띠를 멈추고 다시 재생한다", () => {
  const {container} = visit();
  fireEvent.click(screen.getByRole("button", {name:"알림 예시 띠 일시정지"}));
  expect(container.querySelector(".lp-track")?.getAttribute("data-paused")).toBe("true");
  fireEvent.click(screen.getByRole("button", {name:"알림 예시 띠 재생"}));
  expect(container.querySelector(".lp-track")?.getAttribute("data-paused")).toBe("false");
});
