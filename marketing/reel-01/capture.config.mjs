import { defineConfig } from "playwright/test";
export default defineConfig({testDir: ".", testMatch: "record.spec.mjs", outputDir: ".cache/tests",
  reporter: "list", timeout: 600000, use: { channel: "chrome", viewport: {width:1440,height:900},
    deviceScaleFactor: 2, colorScheme: "light", locale:"ko-KR", timezoneId:"Asia/Seoul",
    serviceWorkers:"block", permissions:["clipboard-read","clipboard-write"] },
  webServer: {command: "vite --config vite.config.mjs", url: "http://127.0.0.1:4191", timeout:60000}
});
