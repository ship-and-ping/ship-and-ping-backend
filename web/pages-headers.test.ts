import { expect, it } from "vitest";
import { renderPagesHeaders } from "./pages-headers";

const env = {
  VITE_SUPABASE_URL: "https://fixture.supabase.co",
  VITE_INGEST_URL: "https://ship-and-ping-ingest.fixture.workers.dev",
};

it.each([
  ["VITE_SUPABASE_URL", "https://fixture.supabase.co.example.org"],
  ["VITE_INGEST_URL", "https://ship-and-ping-ingest.fixture.workers.dev/path"],
])("rejects an invalid %s", (name, value) => {
  expect(() => renderPagesHeaders("", { ...env, [name]: value })).toThrow(name);
});

it("rejects a placeholder left in the rendered headers", () => {
  expect(() => renderPagesHeaders("connect-src https://extra.invalid", env)).toThrow(".invalid");
});
