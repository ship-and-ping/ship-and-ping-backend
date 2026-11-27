import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Landing } from "./Layout";

afterEach(cleanup);

function visit() {
  return render(<MemoryRouter><Landing/></MemoryRouter>);
}

it("첫 화면과 휴대폰 고정 버튼이 로그인으로 이어진다", () => {
  const {container} = visit();
  expect(screen.getByRole("heading", {level:1}).textContent).toContain("양이 알려드려요");
  const nav = screen.getByRole("navigation", {name:"시작 메뉴"});
  expect(within(nav).getByRole("link", {name:"로그인"}).getAttribute("href")).toBe("/login");
  expect(container.querySelector(".lp-mobile-start")?.getAttribute("href")).toBe("/login");
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

it("다섯 질문의 답을 각각 열고 다시 닫을 수 있다", () => {
  const {container} = visit();
  const disclosures = container.querySelectorAll("details");
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
