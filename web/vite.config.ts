import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { renderPagesHeaders } from "./pages-headers";

function pagesHeaders(): Plugin {
  return {
    name: "pages-security-headers",
    apply: "build",
    writeBundle({ dir }) {
      const env = loadEnv("pages", process.cwd());
      if (!env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")) {
        throw new Error("Check VITE_SUPABASE_PUBLISHABLE_KEY");
      }
      const path = resolve(dir!, "_headers");
      writeFileSync(path, renderPagesHeaders(readFileSync(path, "utf8"), env));
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "pages" ? [pagesHeaders()] : [])],
  define: {
    __DIAGNOSTIC_KEYS__: readFileSync(resolve(import.meta.dirname, "../supabase/migrations/20261126210000_diagnostic_keys.sql"), "utf8").split("$keys$")[1],
  },
  build: { rollupOptions: { output: { manualChunks: { supabase: ["@supabase/supabase-js"] } } } },
  test: { environment: "jsdom" },
}));
