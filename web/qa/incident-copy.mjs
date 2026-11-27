import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockPage } from "./fixtures.mjs";

const output = new URL("../../docs/design/qa/T51/", import.meta.url);
const origin = "http://127.0.0.1:4191";
const service = "https://example.supabase.co";
const server = await createServer({
  server: { host: "127.0.0.1", port: 4191, strictPort: true, hmr: false },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(service),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid"),
  },
});
let browser;
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome" });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      locale: "ko-KR", colorScheme: "light", reducedMotion: "reduce",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-11-27T04:30:00Z"));
    await mockPage(page, "failure", true, origin);
    await page.route(service + "/rest/v1/rpc/incident_verification", route => route.fulfill({ json: {
      version: "2026-11-27T04:21:09.780Z-1d79c156-5e7e-43e2-9cc6-08b34e145f4e",
      consecutive_successes: 2, latest_success: true, latest_duration_ms: 80,
    } }));
    for (const [name, path] of [["home", ""], ["issue", "/issues/example"]]) {
      await page.goto(origin + "/apps/demo" + path);
      const panel = page.getByRole("region", { name: name === "home" ? "앱 상태 요약" : "문제 상태" });
      const copy = panel.getByRole("button", { name: "AI 조사 요청문 복사" });
      await copy.waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error("수평 넘침");
      if (name === "issue" && width === 390 && !await page.locator(".issue-dock button").isVisible())
        throw Error("모바일 하단 복사 버튼 누락");
      await page.screenshot({ path: fileURLToPath(new URL(name + "-" + width + ".png", output)) });
      await copy.click();
      await panel.getByRole("button", { name: "복사했어요" }).waitFor();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      if (!copied.includes("11/27 13:21 배포 · 1d79c156")) throw Error("복사한 버전 확인 실패");
    }
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
