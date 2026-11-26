import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

function pagesHeaders(): Plugin {
  return {
    name: "pages-security-headers",
    apply: "build",
    writeBundle({ dir }) {
      const env = loadEnv("pages", process.cwd());
      function origin(name: string, pattern: RegExp) {
        const value = env[name] ?? "";
        if (!pattern.test(value)) throw new Error(`Check the HTTPS origin in ${name}`);
        return new URL(value).origin;
      }
      const supabase = origin("VITE_SUPABASE_URL", /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/);
      const worker = origin("VITE_INGEST_URL", /^https:\/\/ship-and-ping-ingest\.[a-z0-9-]+\.workers\.dev\/?$/);
      if (!env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")) {
        throw new Error("Check VITE_SUPABASE_PUBLISHABLE_KEY");
      }
      const path = resolve(dir!, "_headers");
      const headers = readFileSync("public/_headers", "utf8")
        .replace("https://supabase.invalid", supabase)
        .replace("https://worker.invalid", worker);
      writeFileSync(path, headers);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "pages" ? [pagesHeaders()] : [])],
  build: { rollupOptions: { output: { manualChunks: { supabase: ["@supabase/supabase-js"] } } } },
  test: { environment: "jsdom" },
}));
