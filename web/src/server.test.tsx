import {afterEach,describe,expect,it} from "vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {Chart} from "./Chart";
import {IncidentServerSummary} from "./ServerIncident";
import {buildConnectPrompt} from "./domain";
import {extraConnectPrompt,serverInstructions} from "./server-prompt";

afterEach(cleanup);
describe("앱 서버 기록",() => {
  const base = {rows:[], days:1, now:Date.UTC(2026,10,28), baseline:null};
  it("keeps missing minutes empty and shares the selected slot",() => {
    render(<Chart {...base} resources={[{slot:1,peaks:{process_cpu_pct:0,mem_used_pct:64,gc_pause_ms:8}}]}/>);
    const panel = screen.getByRole("region",{name:"서버 상태"});
    const cpu = within(panel).getByRole("slider",{name:"프로세스 CPU"});
    fireEvent.focus(cpu);
    expect(cpu.getAttribute("aria-valuetext")).toContain("기록 없음");
    fireEvent.keyDown(cpu,{key:"ArrowRight"});
    expect(cpu.getAttribute("aria-valuetext")).toContain("0%");
    expect(within(panel).getByRole("slider",{name:"메모리 사용률"}).getAttribute("aria-valuetext")).toContain("64%");
    expect(screen.getByRole("slider",{name:"사용 건수"}).getAttribute("aria-valuenow")).toBe("2");
  });
  it("explains how to connect when the chart has no samples",() => {
    render(<Chart {...base}/>);
    expect(screen.getByText("추가 연결 요청문으로 서버 상태도 볼 수 있어요")).toBeTruthy();
  });
  it("shows the incident's measured peak and omits unmeasured fields",() => {
    render(<IncidentServerSummary context={{since:"",until:"",peaks:{steal_pct:0}}}/>);
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.queryByText("GC 정지 시간")).toBeNull();
  });
  it("includes the same contract in both prompts and keeps the additional prompt key-free",() => {
    const key = "sp_srv_" + "a".repeat(64);
    expect(buildConnectPrompt(key,"https://example.org")).toContain(serverInstructions);
    expect(extraConnectPrompt).not.toMatch(/sp_(pub|srv)_|https?:\/\//);
    expect(extraConnectPrompt).toMatchSnapshot();
  });
});
