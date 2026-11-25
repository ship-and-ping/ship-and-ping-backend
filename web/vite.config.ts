import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { supabase: ["@supabase/supabase-js"] } } } },
  test: { environment: "jsdom" },
});
