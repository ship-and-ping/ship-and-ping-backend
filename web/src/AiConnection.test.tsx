import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiConnection } from "./AiConnection";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps a new key masked on clipboard failure and clears it on revocation", async () => {
  const key = "sk_spai_" + "f".repeat(64);
  const row = { id: "id-1", created_at: new Date().toISOString(), expires_at: new Date().toISOString(), last_used_at: null };
  const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([row]).mockResolvedValue([]);
  const api = { endpoint: "https://example.invalid/mcp", list, issue: vi.fn(async () => ({ id: row.id, key })), revoke: vi.fn() };
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<AiConnection api={api} app="app-1" />);
  const issue = screen.getByRole("button", { name: "AI 조회 키 발급" }) as HTMLButtonElement;
  await waitFor(() => expect(issue.disabled).toBe(false));
  fireEvent.click(issue);
  fireEvent.click(await screen.findByRole("button", { name: "AI 조회 키 복사" }));
  const area = await screen.findByRole("textbox", {name:"AI 조회 키 복사 전문"}) as HTMLTextAreaElement;
  expect(area.value).toBe("••••");
  expect(new XMLSerializer().serializeToString(document.body)).not.toContain(key);
  fireEvent.click(screen.getByRole("button", {name:"키 포함해서 보기"}));
  expect(area.value).toBe(key);
  fireEvent.click(screen.getByRole("button", {name:"조회 키 폐기"}));
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(api.revoke).toHaveBeenCalledWith("app-1",row.id);
  expect(new XMLSerializer().serializeToString(document.body)).not.toContain(key);
});
