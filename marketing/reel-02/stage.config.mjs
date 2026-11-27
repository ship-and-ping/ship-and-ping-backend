import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "production.spec.mjs", outputDir: ".cache/tests",
  timeout: 1800000, workers: 1, reporter: "list",
  use: { channel: "chrome", viewport: { width: 1080, height: 1920 },
    colorScheme: "dark", locale: "ko-KR", timezoneId: "Asia/Seoul",
    serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"] }
});
