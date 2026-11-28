import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const show = useToast();
  return <>
    <button onClick={() => show({ kind: "success", title: "복사했어요", detail: "붙여 넣어 주세요." })}>복사</button>
    {["앱 정보", "기능 이름표", "알림 설정"].map(name =>
      <button key={name} onClick={() => show({ kind: "success", title: name + " 저장 완료" })}>{name}</button>)}
  </>;
}

function open() {
  render(<ToastProvider><Trigger /></ToastProvider>);
  fireEvent.click(screen.getByText("복사"));
  return screen.getByText("복사했어요");
}

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("서로 다른 결과를 최대 세 개 쌓고 가장 오래된 것부터 뺀다", () => {
  const first = open();
  for (const name of ["앱 정보", "기능 이름표"]) fireEvent.click(screen.getByText(name));
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(first.isConnected).toBe(true);
  fireEvent.click(screen.getByText("알림 설정"));
  expect(first.isConnected).toBe(false);
  expect(screen.getAllByRole("article").map(el => el.querySelector("strong")?.textContent))
    .toEqual(["앱 정보 저장 완료", "기능 이름표 저장 완료", "알림 설정 저장 완료"]);
});

it("중복 안내는 같은 요소에서 시간을 연장하고 다른 안내의 만료는 유지한다", () => {
  const title = open();
  fireEvent.click(screen.getByText("앱 정보"));
  tick(4000);
  fireEvent.click(screen.getByText("복사"));
  expect(screen.getByText("복사했어요")).toBe(title);
  tick(500);
  tick(200);
  expect(screen.queryByText("앱 정보 저장 완료")).toBeNull();
  tick(3799);
  expect(title.isConnected).toBe(true);
  tick(1);
  tick(200);
  expect(title.isConnected).toBe(false);
});

it("닫히는 중 같은 안내가 오면 같은 요소로 다시 4.5초를 유지한다", () => {
  const title = open();
  tick(4500);
  fireEvent.click(screen.getByText("복사"));
  tick(200);
  expect(screen.getByText("복사했어요")).toBe(title);
  tick(4300);
  tick(200);
  expect(title.isConnected).toBe(false);
});

it("제목과 설명을 polite 영역에서 읽고 4.5초 뒤 닫는다", () => {
  open();
  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(within(status).getByText("붙여 넣어 주세요.")).toBeTruthy();
  tick(4499);
  expect(screen.getByText("복사했어요")).toBeTruthy();
  tick(1);
  tick(200);
  expect(screen.queryByText("복사했어요")).toBeNull();
});

it("마우스를 올리면 멈추고 떠나면 남은 시간만큼 보여 준다", () => {
  const title = open();
  tick(3000);
  fireEvent.mouseEnter(title.closest("article")!);
  tick(6000);
  expect(title.isConnected).toBe(true);
  fireEvent.mouseLeave(title.closest("article")!);
  tick(1499);
  expect(title.isConnected).toBe(true);
  tick(1);
  tick(200);
  expect(title.isConnected).toBe(false);
});

it("버튼으로 바로 닫을 수 있다", () => {
  const title = open();
  fireEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
  tick(200);
  expect(title.isConnected).toBe(false);
});

it("닫기 버튼에 초점을 두면 읽을 시간을 유지한다", () => {
  const title = open();
  const close = screen.getByRole("button", { name: "안내 닫기" });
  fireEvent.focus(close);
  tick(5000);
  tick(200);
  expect(title.isConnected).toBe(true);
  fireEvent.blur(close);
  tick(4500);
  tick(200);
  expect(title.isConnected).toBe(false);
});

it("세로 스크롤은 허용하고 가로로 밀면 닫는다", () => {
  const toast = open().closest("article")!;
  const start = () => fireEvent.touchStart(toast, { touches: [{ clientX: 10, clientY: 10 }] });
  start();
  fireEvent.touchEnd(toast, { changedTouches: [{ clientX: 30, clientY: 100 }] });
  tick(200);
  expect(toast.isConnected).toBe(true);
  start();
  fireEvent.touchEnd(toast, { changedTouches: [{ clientX: 100, clientY: 15 }] });
  tick(200);
  expect(toast.isConnected).toBe(false);
});
