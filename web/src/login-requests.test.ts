import { expect, it, vi } from "vitest";
import { loginRequests } from "./login-requests";
import type { SupabaseClient } from "@supabase/supabase-js";

it("exchanges the PC grant through verifyOtp without forwarding a mobile session", async () => {
  const verifyOtp = vi.fn().mockResolvedValue({error:null});
  const fetcher = vi.fn().mockResolvedValue(Response.json({status:"approved",token_hash:"fixture-grant"}));
  const api = loginRequests({auth:{verifyOtp}} as unknown as SupabaseClient, "https://worker.invalid", fetcher);
  expect(await api.poll("request","pc-secret")).toBe("approved");
  expect(fetcher.mock.calls[0][1].headers).toEqual({"X-Poll-Secret":"pc-secret"});
  expect(verifyOtp).toHaveBeenCalledWith({type:"magiclink",token_hash:"fixture-grant"});
});
