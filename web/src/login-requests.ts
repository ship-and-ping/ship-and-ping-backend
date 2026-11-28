import type { SupabaseClient } from "@supabase/supabase-js";

export interface LoginRequest { request_id: string; poll_secret: string; match_code: string; expires_at: string }
export interface Decision { status: string; local_consumed?: boolean; created_at?: string; client_info?: {browser:string; place:string} }

export function loginRequests(client: SupabaseClient, origin: string, send = fetch) {
  const base = origin + "/v1/login-requests";
  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const result = await send(base + path, {...init, cache:"no-store", credentials:"omit", referrerPolicy:"no-referrer"});
    if (!result.ok) throw Object.assign(new Error("로그인 요청을 확인하지 못했어요."), {status:result.status});
    return result.json();
  }
  return {
    create(email: string, password?: string) {
      return call<LoginRequest>("", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(10000)});
    },
    async poll(id: string, secret: string) {
      const result = await call<{status:string; token_hash?:string}>("/"+encodeURIComponent(id), {headers:{"X-Poll-Secret":secret}});
      if (result.status === "approved" && result.token_hash) {
        const {error} = await client.auth.verifyOtp({type:"magiclink",token_hash:result.token_hash});
        if (error) throw error;
      }
      return result.status;
    },
    async decide(id: string, action: "inspect"|"approve"|"deny"|"local", proof: string, code?: string, secret?: string) {
      const {data} = await client.auth.getSession();
      if (!data.session) throw new Error("메일 링크를 다시 열어 주세요.");
      const headers: Record<string,string> = {Authorization:"Bearer "+data.session.access_token,"X-Mail-Proof":proof};
      const path = "/"+encodeURIComponent(id);
      if (action === "inspect") return call<Decision>(path,{headers});
      headers["Content-Type"]="application/json";
      if (secret) headers["X-Poll-Secret"]=secret;
      return call<Decision>(path+"/approve",{method:"POST",headers,body:JSON.stringify({action,match_code:code})});
    },
  };
}

const storageKey = "ship-ping-login-request";
const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const issueRoute = new RegExp("^/apps/" + uuid + "/issues/" + uuid + "$", "i");
export function notificationIssuePath(value: unknown): string | null {
  return typeof value === "string" && issueRoute.test(value) ? value : null;
}
export function remembered(): (LoginRequest & {issuePath?: string}) | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (saved && Date.parse(saved.expires_at)>Date.now()) return saved;
    localStorage.removeItem(storageKey);
  } catch { /* Browser storage can be disabled. */ }
}
export function remember(request: LoginRequest, issuePath?: string | null) {
  localStorage.setItem(storageKey, JSON.stringify({ ...request, issuePath: notificationIssuePath(issuePath) ?? undefined }));
}
export function takeRememberedRequest(id: string) {
  const saved = remembered();
  if (saved?.request_id !== id) return;
  localStorage.removeItem(storageKey);
  return saved;
}
