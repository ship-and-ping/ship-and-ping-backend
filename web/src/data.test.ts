import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { gateway } from "./data";

it("가입 여부와 관계없이 같은 응답을 주고 복구 메일을 현재 사이트로 연결한다", async () => {
  const auth = {
    signUp: vi.fn().mockResolvedValueOnce({error:null}).mockResolvedValueOnce({error:{code:"user_already_exists"}}),
    resetPasswordForEmail: vi.fn().mockResolvedValue({error:null}),
  };
  const api = gateway({auth} as unknown as SupabaseClient);
  const email = "member@example.invalid";
  await expect(api.signup(email, "example phrase")).resolves.toBeUndefined();
  await expect(api.signup(email, "example phrase")).resolves.toBeUndefined();
  await api.requestReset(email);
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(email,{redirectTo:location.origin + "/reset-password"});
});
it.each([
  [504, undefined, "unknown"],
  [502, undefined, "unknown"],
  [429, undefined, "unknown"],
  [503, undefined, "failed"],
  [401, "bad_jwt", "unauthorized"],
  [401, "user_not_found", "done"],
] as const)("withdrawal maps HTTP %s and Auth %s to %s", async (status, code, expected) => {
  const auth = {
    getSession: async () => ({data:{session:{access_token:"fixture"}}}),
    getUser: vi.fn(async () => ({error:{code}})),
  };
  const api = gateway({auth} as unknown as SupabaseClient);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null,{status})));
  try {
    expect(await api.withdraw("http://localhost")).toBe(expected);
    expect(auth.getUser).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("gateway merges proposed, confirmed, unnamed and overflow rows and sends one scoped RPC", async () => {
  const requests: { path: string; body: string; query: URLSearchParams }[] = [];
  const row = {
    id: "a",
    name: "App",
    created_at: "2026-11-25",
    first_record_at: null,
  };
  const f = (
    route: string,
    name: string,
    name_source: string,
    method = "GET",
  ) => ({ id: route, method, route, name, name_source, hidden: false });
  const rows: Record<string, unknown> = {
    apps: row,
    features: [
      f("/a", "이름 없는 기능", "route"),
      f("/b", "Confirmed", "confirmed"),
      f("/c", "이름 없는 기능", "route"),
      f("*", "기타", "route", "*"),
    ],
    feature_map_suggestions: [
      { method: "GET", route: "/a", name: "Late" },
      { method: "GET", route: "/d", name: "New" },
    ],
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)),
      path = url.pathname.split("/").pop()!;
    requests.push({
      path,
      body: String(init?.body ?? ""),
      query: url.searchParams,
    });
    return path === "confirm_feature_names"
      ? Response.json([{ method: "GET", route: "/d" }])
      : Response.json(rows[path]);
  });
  const api = gateway(
    createClient("https://local.example.invalid", "publishable-fixture", {
      global: { fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
  const result = await api.snapshot("a");
  expect(result.labels.map((l) => l.name)).toEqual([
    "Late",
    "Confirmed",
    "",
    "기타",
    "New",
  ]);
  expect(
    requests.every(
      (r) => r.query.get(r.path === "apps" ? "id" : "app_id") === "eq.a",
    ),
  ).toBe(true);
  expect(await api.save("a", [result.labels[0], result.labels[4]])).toEqual([
    { method: "GET", route: "/d" },
  ]);
  expect(requests.at(-1)?.path).toBe("confirm_feature_names");
  expect(JSON.parse(requests.at(-1)!.body)).toEqual({
    p_app_id: "a",
    p_items: [
      { method: "GET", route: "/a", name: "Late", hidden: false },
      { method: "GET", route: "/d", name: "New", hidden: false },
    ],
  });
});
