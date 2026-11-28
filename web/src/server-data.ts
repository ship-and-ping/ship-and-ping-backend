import type { SupabaseClient } from "@supabase/supabase-js";

export const serverMetrics = [
  ["process_cpu_pct","프로세스 CPU","%"], ["system_cpu_pct","서버 CPU","%"],
  ["steal_pct","CPU 대기 (steal)","%"], ["mem_used_pct","메모리 사용률","%"],
  ["gc_pause_ms","GC 정지 시간","ms"],
] as const;
export type Peaks = Partial<Record<string, number>>;
export type ServerSlot = {slot: number; peaks: Peaks};
export type ServerContext = {since: string; until: string; peaks: Peaks | null};
export type AppProfile = Partial<Record<"language"|"framework"|"hosting"|"plan"|"cpu_cores"|"memory_gb"|"database"|"deploy"|"rollback"|"metrics", string | number>>
  & {services?: {feature:string; kind:string; name:string}[]};
export const formatMetric = (value:number,unit:string) => value.toLocaleString("ko-KR",{maximumFractionDigits:1}) + unit;

export function profileAccess(client: SupabaseClient) {
  return {
    async read(id:string):Promise<AppProfile|null> {
      const {data,error} = await client.from("app_profiles").select("profile").eq("app_id",id).maybeSingle();
      if (error) throw error;
      return data?.profile ?? null;
    },
    async remove(id:string) {
      const {error} = await client.from("app_profiles").delete().eq("app_id",id);
      if (error) throw error;
    },
  };
}
