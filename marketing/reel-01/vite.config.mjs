import { defineConfig } from "vite";
import { resolve } from "node:path";

const root = resolve("../../web");
const packages = resolve("node_modules");
export default defineConfig({
  root, envDir: false, cacheDir: resolve(".cache/vite"),
  esbuild: { jsx: "automatic" },
  resolve: { alias: Object.fromEntries(
    ["react", "react-dom", "react-router-dom", "@supabase/supabase-js"].map(name => [name, resolve(packages, name)])
  ) },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_reel_demo_only"),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid")
  },
  server: { host: "127.0.0.1", port: 4191, strictPort: true, hmr: false,
    fs: {allow: [root, packages, resolve(".cache")]} }
});
