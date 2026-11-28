import type { SupabaseClient } from "@supabase/supabase-js";

export interface AiKey {
  id: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

export function aiKeys(client: SupabaseClient, origin: string) {
  return {
    endpoint: origin + "/mcp",
    async list(app: string): Promise<AiKey[]> {
      const { data, error } = await client.rpc("list_ai_keys", { p_app: app });
      if (error || !Array.isArray(data)) throw Error("list failed");
      return data;
    },
    async issue(app: string): Promise<{ id: string; key: string }> {
      const { data, error } = await client.rpc("issue_ai_key", { p_app: app });
      if (error || !data?.id || typeof data.key !== "string") throw Error("issue failed");
      return data;
    },
    async revoke(app: string, id: string) {
      const { error } = await client.rpc("revoke_ai_key", { p_app: app, p_key: id });
      if (error) throw Error("revoke failed");
    },
  };
}
