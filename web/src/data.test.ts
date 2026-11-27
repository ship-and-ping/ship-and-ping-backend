import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { gateway } from "./data";

const {webcrypto,hash} = await vi.importActual<{
  webcrypto: Crypto; hash(algorithm: string, input: string): string;
}>("node:crypto");

it.each([429, 503])("승인 요청 생성이 %s여도 일반 메일 로그인과 가입을 계속한다", async status => {
  const auth = {
    signInWithOtp: vi.fn().mockResolvedValue({error:null}),
    signUp: vi.fn().mockResolvedValue({error:null}),
  };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {status})));
  try {
    const api = gateway({auth} as unknown as SupabaseClient, "https://worker.invalid");
    const email = "member@example.invalid";
    await expect(api.login(email)).resolves.toBeUndefined();
    await expect(api.signup(email, "example phrase")).resolves.toBeUndefined();
    const emailRedirectTo = location.origin + "/login";
    expect(auth.signInWithOtp).toHaveBeenCalledWith({email, options:{emailRedirectTo}});
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({email, options:expect.objectContaining({emailRedirectTo})}));
  } finally { vi.unstubAllGlobals(); }
});

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
  [429, undefined, "limited"],
  [503, undefined, "failed"],
  [401, "bad_jwt", "login_required"],
  [401, "user_not_found", "done"],
] as const)("withdrawal maps HTTP %s and Auth %s to %s", async (status, code, expected) => {
  const auth = {
    getSession: async () => ({data:{session:{access_token:"fixture"}}}),
    refreshSession: vi.fn(async () => ({data:{user:null},error:{code:"refresh_token_not_found"}})),
    getUser: vi.fn(async () => ({error:{code}})),
  };
  const api = gateway({auth} as unknown as SupabaseClient);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null,{status})));
  try {
    expect(await api.withdraw("http://localhost")).toBe(expected);
    expect(auth.refreshSession).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    expect(auth.getUser).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([
  [{data:{user:{id:"member"}},error:null}, "failed"],
  [{data:{user:null},error:{code:"user_not_found"}}, "done"],
  [{data:{user:null},error:{name:"AuthSessionMissingError"}}, "login_required"],
  [{data:{user:null},error:{status:503}}, "unknown"],
] as const)("구 세션의 401 뒤 갱신 결과를 반영한다", async (refresh, expected) => {
  const auth = {
    getSession: async () => ({data:{session:{access_token:"fixture"}}}),
    refreshSession: vi.fn().mockResolvedValue(refresh),
    getUser: vi.fn().mockResolvedValue({error:{code:"bad_jwt"}}),
  };
  vi.stubGlobal("fetch",vi.fn(async () => new Response(null,{status:401})));
  try {
    expect(await gateway({auth} as unknown as SupabaseClient).withdraw("http://localhost")).toBe(expected);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
it.each([true, false])("이전 탈퇴 결과가 불명확하면 세션 소실을 재시도로 안내한다 (로컬 세션 %s)", async (hasSession) => {
  const session = {access_token:"fixture"};
  const auth = {
    getSession: vi.fn().mockResolvedValueOnce({data:{session}})
      .mockResolvedValueOnce({data:{session:hasSession ? session : null}}),
    refreshSession: vi.fn().mockResolvedValue({data:{user:null},error:{name:"AuthSessionMissingError"}}),
    getUser: vi.fn().mockResolvedValue({error:{code:"bad_jwt"}}),
  };
  const request = vi.fn().mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(new Response(null,{status:401}));
  vi.stubGlobal("fetch", request);
  const api = gateway({auth} as unknown as SupabaseClient);
  try {
    expect(await api.withdraw("http://localhost")).toBe("unknown");
    expect(await api.withdraw("http://localhost")).toBe("unauthorized");
    expect(request).toHaveBeenCalledTimes(hasSession ? 2 : 1);
  } finally { vi.unstubAllGlobals(); }
});
it("탈퇴 요청 전 세션이 없으면 요청을 보내지 않는다", async () => {
  const auth = {getSession: async () => ({data:{session:null}})};
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  try {
    expect(await gateway({auth} as unknown as SupabaseClient).withdraw("http://localhost")).toBe("login_required");
    expect(request).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it("401 뒤 세션 갱신 중 통신 예외가 나면 결과 확인을 계속한다", async () => {
  const auth = {
    getSession: async () => ({data:{session:{access_token:"fixture"}}}),
    refreshSession: vi.fn().mockRejectedValue(new TypeError("offline")),
  };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null,{status:401})));
  try {
    expect(await gateway({auth} as unknown as SupabaseClient).withdraw("http://localhost")).toBe("unknown");
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
it("재인증 메일을 요청하고 저장 시 받은 번호를 전달한다", async () => {
  const auth = {reauthenticate:vi.fn().mockResolvedValue({error:null}),updateUser:vi.fn().mockResolvedValue({error:null})};
  const api = gateway({auth} as unknown as SupabaseClient);
  await api.reauthenticate();
  expect(auth.reauthenticate).toHaveBeenCalledTimes(1);
  await api.updatePassword("example phrase","123123");
  expect(auth.updateUser).toHaveBeenCalledWith({password:"example phrase",nonce:"123123",data:{ship_ping_password_set:true}});
});

it("gateway displays applied AI names, confirmed names and unnamed routes without confirmation", async () => {
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
      f("/a", "Late", "ai"),
      f("/b", "Confirmed", "confirmed"),
      f("/c", "이름 없는 기능", "route"),
      f("*", "기타", "route", "*"),
    ],
    feature_map_suggestions: [
      { method: "GET", route: "/a", name: "Stale proposal" },
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
      ? Response.json([])
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
  ]);
  expect(
    requests.every(
      (r) => r.query.get(r.path === "apps" ? "id" : "app_id") === "eq.a",
    ),
  ).toBe(true);
  expect(await api.save("a", [{ ...result.labels[0], name: "Edited" },
    { ...result.labels[1], name: undefined, hidden: true }])).toEqual([]);
  expect(requests.at(-1)?.path).toBe("confirm_feature_names");
  expect(JSON.parse(requests.at(-1)!.body)).toEqual({
    p_app_id: "a",
    p_items: [
      { method: "GET", route: "/a", name: "Edited", hidden: false },
      { method: "GET", route: "/b", hidden: true },
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

afterEach(() => {
  localStorage.removeItem("ship-ping-push-cleanup");
  localStorage.removeItem("ship-ping-last-member");
});

function pushFixture() {
  vi.stubGlobal("crypto",webcrypto);
  const endpoint = "https://web.push.apple.com/shared";
  const close = vi.fn();
  const unsubscribe = vi.fn(async () => true);
  const keys = {p256dh:"fixture-key",auth:"fixture-auth"};
  const sub = {endpoint,toJSON:() => ({keys}),unsubscribe};
  const registration = {getNotifications:async () => [{close}],pushManager:{getSubscription:vi.fn(async ():Promise<typeof sub | null> => sub)}};
  vi.stubGlobal("navigator",{serviceWorker:{getRegistration:async () => registration}});
  const abortSignal = vi.fn().mockResolvedValue({error:null});
  const rpc = vi.fn(() => ({abortSignal}));
  const signOut = vi.fn(async () => ({error:null}));
  type Listener = (event:string,session:{user:{id:string}} | null)=>void;
  const onAuthStateChange = vi.fn<(fn:Listener) => {data:{subscription:{unsubscribe:()=>void}}}>()
    .mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});
  const reload = () => gateway({rpc,auth:{onAuthStateChange,signOut}} as unknown as SupabaseClient);
  const proof = hash("sha256",[endpoint,keys.p256dh,keys.auth].join("\n"));
  return {api:reload(),reload,sub,registration,abortSignal,rpc,close,signOut,onAuthStateChange,proof};
}

it.each(["success","server offline","browser failure","both offline","deleted account"])("ends the local session after push cleanup (%s)", async reason => {
  const {api,sub,proof,rpc,abortSignal,close,signOut} = pushFixture();
  if (reason === "server offline" || reason === "both offline") abortSignal.mockRejectedValue(Error("offline"));
  if (reason === "browser failure" || reason === "both offline") sub.unsubscribe.mockRejectedValue(Error("browser unavailable"));
  try {
    await api.logout(reason === "deleted account" || undefined);
    if (reason === "deleted account") expect(rpc).not.toHaveBeenCalled();
    else expect(rpc).toHaveBeenCalledExactlyOnceWith("revoke_push_by_proof",{proof});
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledExactlyOnceWith({scope:"local"});
    expect(signOut.mock.invocationCallOrder[0]).toBeGreaterThan(sub.unsubscribe.mock.invocationCallOrder[0]);
  } finally { vi.unstubAllGlobals(); }
});

it("closes displayed notifications even without a subscription", async () => {
  const {api,registration,close,signOut} = pushFixture();
  registration.pushManager.getSubscription.mockResolvedValue(null);
  try {
    await api.logout();
    expect(close).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

it.each(["SIGNED_IN","INITIAL_SESSION"])("discards the previous member's subscription on a live switch or redirect (%s)", async event => {
  const {api,sub,rpc,proof,close,onAuthStateChange} = pushFixture();
  localStorage.setItem("ship-ping-last-member","former");
  const stop = api.listen(vi.fn());
  const emit = onAuthStateChange.mock.calls[0][0];
  try {
    emit(event,{user:{id:"next"}});
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledExactlyOnceWith("revoke_push_by_proof",{proof});
    expect(close).toHaveBeenCalledOnce();
    emit("SIGNED_IN",{user:{id:"next"}});
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(localStorage.getItem("ship-ping-last-member")).toBe("next");
  } finally { stop(); localStorage.removeItem("ship-ping-last-member"); vi.unstubAllGlobals(); }
});

it.each(["pending RPC","RPC error","pending unsubscribe","unsubscribe false"])("resumes interrupted account cleanup on startup (%s)", async phase => {
  const {api,reload,sub,registration,rpc,proof,abortSignal,onAuthStateChange} = pushFixture();
  const key = "ship-ping-last-member";
  const marker = "ship-ping-push-cleanup";
  localStorage.setItem(key,"former");
  if (phase === "pending RPC") abortSignal.mockImplementationOnce(() => new Promise(() => {}));
  if (phase === "RPC error") abortSignal.mockResolvedValueOnce({error:Error("offline")});
  if (phase === "pending unsubscribe") sub.unsubscribe.mockImplementationOnce(() => new Promise(() => {}));
  if (phase === "unsubscribe false") sub.unsubscribe.mockResolvedValueOnce(false);
  const session = {user:{id:"next"}};
  const stop = api.listen(vi.fn());
  try {
    onAuthStateChange.mock.calls[0][0]("SIGNED_IN",session);
    expect(localStorage.getItem(marker)).toBeTruthy();
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledOnce());
    expect(localStorage.getItem(key)).toBe("former");
    expect(localStorage.getItem(marker)).toBe(proof);
    stop(); // Discard this tab's gateway and its unfinished promises.
    if (phase === "pending RPC" || phase === "RPC error") registration.pushManager.getSubscription.mockResolvedValue(null);
    // Returning to the recorded account must also honor an outstanding marker.
    const restart = reload().listen(vi.fn());
    try {
      const restored = phase === "RPC error" ? "former" : "next";
      onAuthStateChange.mock.calls[1][0]("INITIAL_SESSION",{user:{id:restored}});
      await vi.waitFor(() => expect(localStorage.getItem(marker)).toBeNull());
      expect(localStorage.getItem(key)).toBe(restored);
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc).toHaveBeenLastCalledWith("revoke_push_by_proof",{proof});
      expect(sub.unsubscribe).toHaveBeenCalledTimes(phase === "pending RPC" || phase === "RPC error" ? 1 : 2);
    } finally { restart(); }
  } finally { vi.unstubAllGlobals(); }
});

it("keeps an existing subscription on a page reload in the same session", () => {
  const {api,registration,onAuthStateChange,rpc} = pushFixture();
  localStorage.setItem("ship-ping-last-member","same");
  const stop = api.listen(vi.fn());
  try {
    onAuthStateChange.mock.calls[0][0]("INITIAL_SESSION",{user:{id:"same"}});
    expect(registration.pushManager.getSubscription).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  } finally { stop(); localStorage.removeItem("ship-ping-last-member"); vi.unstubAllGlobals(); }
});

it("does not register a device again when the same member logs back in", async () => {
  const {api,registration,sub,rpc,onAuthStateChange} = pushFixture();
  localStorage.setItem("ship-ping-last-member","same");
  sub.unsubscribe.mockImplementation(async () => {
    registration.pushManager.getSubscription.mockResolvedValue(null);
    return true;
  });
  const stop = api.listen(vi.fn());
  const emit = onAuthStateChange.mock.calls[0][0];
  try {
    emit("INITIAL_SESSION",{user:{id:"same"}});
    await api.logout();
    emit("SIGNED_OUT",null);
    emit("SIGNED_IN",{user:{id:"same"}});
    expect(await registration.pushManager.getSubscription()).toBeNull();
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toContain("revoke_push_by_proof");
  } finally { stop(); localStorage.removeItem("ship-ping-last-member"); vi.unstubAllGlobals(); }
});
