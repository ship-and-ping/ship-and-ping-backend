import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { gateway } from "./data";

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

it("logs out only after revoking this endpoint under the current session and unsubscribing locally", async () => {
  const endpoint = "https://web.push.apple.com/shared";
  const operations: string[] = [];
  const sub = {endpoint,unsubscribe:async () => { operations.push("unsubscribe"); return true; }};
  vi.stubGlobal("navigator",{serviceWorker:{getRegistration:async () => ({pushManager:{getSubscription:async () => sub}})}});
  vi.stubGlobal("caches",{open:async () => ({delete:async () => operations.push("unbind")})});
  const eq = vi.fn(async () => { operations.push("delete"); return {error:null}; });
  const client = {from:vi.fn(() => ({delete:() => ({eq})})),
    auth:{signOut:async () => { operations.push("logout"); return {error:null}; }}};
  try {
    await gateway(client as unknown as SupabaseClient).logout();
    expect(client.from).toHaveBeenCalledWith("push_subscriptions");
    expect(eq).toHaveBeenCalledWith("endpoint",endpoint);
    expect(operations).toEqual(["unbind","delete","unsubscribe","logout"]);
  } finally { vi.unstubAllGlobals(); }
});
it("reclaims an existing browser subscription after sign-in without prompting or enabling an app", async () => {
  const sub = {endpoint:"https://web.push.apple.com/shared",keys:{p256dh:"device-key",auth:"device-auth"}};
  const put = vi.fn();
  vi.stubGlobal("navigator",{userAgent:"PC",serviceWorker:{getRegistration:async () => ({pushManager:{
    getSubscription:async () => ({toJSON:() => sub,options:{applicationServerKey:null}})}})}});
  vi.stubGlobal("caches",{open:async () => ({delete:vi.fn(),put})});
  const rpc = vi.fn(async () => ({data:"new-binding",error:null}));
  const session = {user:{id:"next-member"}};
  const client = {rpc,auth:{getSession:async () => ({data:{session}}),
    onAuthStateChange:(fn: (event: string,s: typeof session) => void) => {
      fn("SIGNED_IN",session); return {data:{subscription:{unsubscribe:vi.fn()}}};
    }}};
  try {
    gateway(client as unknown as SupabaseClient).listen(vi.fn());
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledWith("register_push",{app:null,p_endpoint:sub.endpoint,p_key:sub.keys.p256dh,
      p_auth:sub.keys.auth,p_agent:"PC",p_fingerprint:null});
    expect(await (put.mock.calls[0][1] as Response).json()).toEqual({owner:"next-member",device:"new-binding"});
  } finally { vi.unstubAllGlobals(); }
});

it("closes already displayed notifications even if logout has no subscription", async () => {
  const notices = [{close:vi.fn()},{close:vi.fn()}];
  vi.stubGlobal("navigator",{serviceWorker:{getRegistration:async () => ({
    getNotifications:async () => notices, pushManager:{getSubscription:async () => null},
  })}});
  const signOut = vi.fn(async () => ({error:null}));
  try {
    await gateway({auth:{signOut}} as unknown as SupabaseClient).logout();
    for (const notice of notices) expect(notice.close).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledWith({scope:"local"});
  } finally { vi.unstubAllGlobals(); }
});

it("keeps ordinary logout retryable when the server fails to remove the current device", async () => {
  const sub = {endpoint:"device",unsubscribe:vi.fn(async () => true)};
  vi.stubGlobal("navigator",{serviceWorker:{getRegistration:async () => ({pushManager:{getSubscription:async () => sub}})}});
  const eq = vi.fn().mockResolvedValueOnce({error:Error("offline")}).mockResolvedValue({error:null});
  const signOut = vi.fn(async () => ({error:null}));
  const api = gateway({from:() => ({delete:() => ({eq})}),auth:{signOut}} as unknown as SupabaseClient);
  try {
    await expect(api.logout()).rejects.toThrow("offline");
    expect(signOut).not.toHaveBeenCalled();
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    await api.logout();
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

it.each(["registration","notification center","binding","subscription"])("withdrawal signs out after %s cleanup fails", async step => {
  const fail = () => { throw Error("unavailable"); };
  const unsubscribe = vi.fn(step === "subscription" ? fail : async () => true);
  const reg = {getNotifications:step === "notification center" ? fail : async () => [],
    pushManager:{getSubscription:async () => ({unsubscribe})}};
  vi.stubGlobal("navigator",{serviceWorker:{getRegistration:step === "registration" ? fail : async () => reg}});
  vi.stubGlobal("caches",{open:async () => ({delete:step === "binding" ? fail : vi.fn()})});
  const signOut = vi.fn(async () => ({error:null}));
  try {
    await gateway({auth:{signOut}} as unknown as SupabaseClient).logout(true);
    expect(signOut).toHaveBeenCalledExactlyOnceWith({scope:"local"});
    if (step !== "registration") expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

it("closes a previous member's notices on account change without a subscription", async () => {
  vi.useFakeTimers();
  const close = vi.fn();
  const session = {user:{id:"next"}};
  const reg = {getNotifications:async () => [{close}],pushManager:{getSubscription:async () => null}};
  vi.stubGlobal("navigator",{serviceWorker:{getRegistration:async () => reg}});
  const remove = vi.fn();
  vi.stubGlobal("caches",{open:async () => ({match:async () => Response.json({device:"old",owner:"former"}),delete:remove})});
  const client = {auth:{getSession:async () => ({data:{session}}),
    onAuthStateChange:(fn:(event:string,s:typeof session)=>void) => {
      fn("SIGNED_IN",session); return {data:{subscription:{unsubscribe:vi.fn()}}};
    }}};
  try {
    const stop = gateway(client as unknown as SupabaseClient).listen(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("/.push-device");
    stop();
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it("signals an invalid binding on restore failure and retries the same member without another auth event", async () => {
  vi.useFakeTimers();
  const session = {user:{id:"member"}};
  const sub = {options:{applicationServerKey:null},toJSON:() => ({endpoint:"device",keys:{}})};
  vi.stubGlobal("navigator",{serviceWorker:{getRegistration:async () => ({pushManager:{getSubscription:async () => sub}})}});
  const put = vi.fn(), remove = vi.fn(), changed = vi.fn();
  vi.stubGlobal("caches",{open:async () => ({match:async () => Response.json({device:"same",owner:"member"}),delete:remove,put})});
  const rpc = vi.fn().mockResolvedValueOnce({error:Error("offline")}).mockResolvedValue({data:"same"});
  const client = {rpc,auth:{getSession:async () => ({data:{session}}),
    onAuthStateChange:(fn:(event:string,s:typeof session)=>void) => {
      fn("INITIAL_SESSION",session); return {data:{subscription:{unsubscribe:vi.fn()}}};
    }}};
  window.addEventListener("push-device-change",changed);
  try {
    const stop = gateway(client as unknown as SupabaseClient).listen(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(remove).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(await put.mock.calls[0][1].json()).toEqual({device:"same",owner:"member"});
    stop();
  } finally { window.removeEventListener("push-device-change",changed); vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it.each([
  ["member","member","device",true], ["next","next","device",false],
  ["member","next","device",false], ["member","member",null,false],
] as const)("confirms a worker notification only for a currently owned RLS row (%s, %s, %s)", async (before,after,row,expected) => {
  const controller = {};
  const addEventListener = vi.fn();
  vi.stubGlobal("navigator",{serviceWorker:{controller,addEventListener}});
  const getSession = vi.fn()
    .mockResolvedValueOnce({data:{session:{user:{id:before}}}})
    .mockResolvedValueOnce({data:{session:{user:{id:after}}}});
  const eq = vi.fn(() => ({maybeSingle:async () => ({data:row ? {id:row} : null})}));
  const client = {from:() => ({select:() => ({eq})}),auth:{getSession,
    onAuthStateChange:() => ({data:{subscription:{unsubscribe:vi.fn()}}})}};
  try {
    const stop = gateway(client as unknown as SupabaseClient).listen(vi.fn());
    const postMessage = vi.fn();
    addEventListener.mock.calls[0][1]({source:controller,ports:[{postMessage}],
      data:{type:"confirm-push-owner",device:"device",owner:"member"}});
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expected));
    if (before === "member") expect(eq).toHaveBeenCalledWith("id","device");
    stop();
  } finally { vi.unstubAllGlobals(); }
});
