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
  plugins: [
    react(),
    ...(mode === "pages" ? [pagesHeaders()] : []),
  ],
  build: { rollupOptions: { output: { manualChunks: { supabase: ["@supabase/supabase-js"] } } } },
  test: { environment: "jsdom", css: { include: [/\/styles\/chart\.css$/] } },
}));
