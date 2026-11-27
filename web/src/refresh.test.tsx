import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { MonitorRoute } from "./Monitor";
import type { Gateway } from "./data";
import type { Monitor } from "./monitor-data";

const snapshot: Monitor = { name:"내 앱", features:[], incidents:[], stats:[], versions:[], samples:[], errorKinds:[], now:0 };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function open() {
  vi.useFakeTimers();
  const monitor = vi.fn<Gateway["monitor"]>().mockResolvedValue(snapshot);
  await act(async () => { render(<MemoryRouter initialEntries={["/apps/demo"]}>
    <Routes><Route path="/apps/:id" element={<MonitorRoute api={{monitor} as unknown as Gateway} />} /></Routes>
  </MemoryRouter>); });
  return monitor;
}
const advance = (ms:number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
it("기본 1분, 숨긴 탭 일시 중지, 30초 및 끔을 적용한다", async () => {
  const monitor = await open();
  await advance(59999);
  expect(monitor).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(monitor).toHaveBeenCalledTimes(2);
  const visibility = vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
  fireEvent(document,new Event("visibilitychange"));
  await advance(120000);
  expect(monitor).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue("visible");
  fireEvent(document,new Event("visibilitychange"));
  fireEvent.change(screen.getByRole("combobox",{name:"자동 새로고침"}),{target:{value:"30"}});
  await advance(30000);
  expect(monitor).toHaveBeenCalledTimes(3);
  fireEvent.change(screen.getByRole("combobox",{name:"자동 새로고침"}),{target:{value:"0"}});
  await advance(300000);
  expect(monitor).toHaveBeenCalledTimes(3);
});
it("진행 중 수동·자동 요청을 합치고 실패 후 같은 화면에서 회복한다", async () => {
  const monitor = await open();
  let reject!: (error: Error) => void;
  monitor.mockImplementationOnce(() => new Promise((_,no) => {reject = no;}));
  const refresh = screen.getByRole("button",{name:"새로고침"});
  fireEvent.click(refresh);
  fireEvent.click(refresh);
  await advance(60000);
  expect(monitor).toHaveBeenCalledTimes(2);
  await act(async () => {reject(Error("offline"));});
  expect(screen.getByRole("alert").textContent).toContain("마지막");
  expect(screen.getByRole("heading",{name:"내 앱"})).toBeTruthy();
  await act(async () => {fireEvent.click(refresh);});
  expect(screen.queryByRole("alert")).toBeNull();
});
it("홈의 조회 기간에 맞춰 요청하고 실패하면 직전 기간을 유지한다",async () => {
  const monitor = await open();
  await act(async () => {fireEvent.click(screen.getByRole("button",{name:"1시간"}));});
  expect(monitor).toHaveBeenLastCalledWith("demo",undefined,undefined,1/24);
  expect(screen.getByText("최근 1시간 기록")).toBeTruthy();
  expect(screen.getByRole("slider",{name:"사용과 실패"}).getAttribute("aria-valuemax")).toBe("12");
  monitor.mockRejectedValueOnce(Error("offline"));
  await act(async () => {fireEvent.click(screen.getByRole("button",{name:"7일"}));});
  expect(screen.getByRole("button",{name:"1시간"}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("alert")).toBeTruthy();
});
