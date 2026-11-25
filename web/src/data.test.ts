import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { gateway } from "./data";

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
      ? new Response(null, { status: 204 })
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
  await api.save("a", [result.labels[0], result.labels[4]]);
  expect(requests.at(-1)?.path).toBe("confirm_feature_names");
  expect(JSON.parse(requests.at(-1)!.body)).toEqual({
    p_app_id: "a",
    p_items: [
      { method: "GET", route: "/a", name: "Late", hidden: false },
      { method: "GET", route: "/d", name: "New", hidden: false },
    ],
  });
});
