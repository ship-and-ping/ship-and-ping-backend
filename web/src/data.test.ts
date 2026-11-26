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

it.each([false, true])("비밀번호 표식에 따라 로그인 방법을 표시한다 (%s)", async (set) => {
  const user = { email: "member@example.invalid", app_metadata: {}, user_metadata: set ? {ship_ping_password_set:true} : {} };
  const auth = { getUser: async () => ({data:{user}}), updateUser: vi.fn().mockResolvedValue({error:null}) };
  const api = gateway({auth} as unknown as SupabaseClient);
  expect(await api.account()).toMatchObject({hasPassword:set, method:set ? "이메일과 비밀번호, 메일 링크" : "메일 링크"});
  await api.updatePassword("example phrase");
  expect(auth.updateUser).toHaveBeenCalledWith({password:"example phrase", data:{ship_ping_password_set:true}});
});

it("가입과 복구는 계정 유무 오류만 숨긴다", async () => {
  const limited = {status:429};
  const auth = {
    signUp: vi.fn().mockResolvedValueOnce({error:{code:"email_exists"}}).mockResolvedValue({error:limited}),
    resetPasswordForEmail: vi.fn().mockResolvedValueOnce({error:{code:"user_not_found"}}).mockResolvedValue({error:limited}),
  };
  const api = gateway({auth} as unknown as SupabaseClient);
  await api.signup("member@example.invalid","example phrase");
  expect(auth.signUp.mock.calls[0][0].options.data.ship_ping_password_set).toBe(true);
  await api.requestReset("member@example.invalid");
  await expect(api.signup("member@example.invalid","example phrase")).rejects.toBe(limited);
  await expect(api.requestReset("member@example.invalid")).rejects.toBe(limited);
});

it("화면 구독 전 도착한 복구 이벤트를 한 번만 다시 전달한다", () => {
  const original = location.href;
  history.replaceState(null, "", "/reset-password");
  try {
    const unsubscribe = vi.fn();
    type Listener = (event: string, session: {user:{id:string}}) => void;
    const auth = {onAuthStateChange: vi.fn<(listener: Listener) => {data:{subscription:{unsubscribe:typeof unsubscribe}}}>()
      .mockReturnValue({data:{subscription:{unsubscribe}}})};
    const api = gateway({auth} as unknown as SupabaseClient);
    auth.onAuthStateChange.mock.calls[0][0]("PASSWORD_RECOVERY", {user:{id:"member"}});
    const first = vi.fn();
    api.listen(first)();
    expect(first.mock.calls).toEqual([["member",true]]);
    const next = vi.fn();
    api.listen(next)();
    expect(next).not.toHaveBeenCalled();
  } finally {
    history.replaceState(null, "", original);
  }
});
