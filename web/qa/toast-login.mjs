import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockPage } from "./fixtures.mjs";

const phase = process.argv[2];
assert(["before", "after"].includes(phase), "Pass before or after");
const dir = resolve("../docs/design/qa/toast-login");
await mkdir(dir, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 4198, strictPort: true, hmr: false },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid"),
  },
});
const origin = "http://127.0.0.1:4198";
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome" });
  for (const width of [1440, 390]) {
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        colorScheme, serviceWorkers: "block",
      });
      const page = await context.newPage();
      await mockPage(page, "normal", true, origin);
      await page.goto(origin + "/account");
      const logout = page.getByRole("main").getByRole("button", { name: "로그아웃", exact: true });
      await logout.waitFor();
      const record = phase === "after" && width === 390 && colorScheme === "light";
      if (record) await page.screencast.start({ path: resolve(dir, "motion.webm") });
      await logout.click();
      await page.getByText("로그아웃했어요", { exact: true }).waitFor();
      await page.getByRole("heading", { name: "로그인", exact: true }).waitFor();
      await page.waitForTimeout(420);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (phase === "after") {
        assert.equal(await page.locator(".bar").evaluate(el => el.getBoundingClientRect().top), 0);
        const box = await page.locator(".toast").boundingBox();
        assert(box && box.x > 0 && box.x + box.width < width);
        assert.equal(await page.locator(".login-page .panel").evaluate(el => getComputedStyle(el).animationDelay), "0.072s");
        if (width === 390) assert.equal(box.width, width - 16);
      }
      await page.screenshot({ path: resolve(dir, phase + "-" + width + "-" + colorScheme + ".png") });
      if (record) {
        await page.locator(".toast").waitFor({ state: "detached" });
        await page.screencast.stop();
      }
      if (phase === "after") {
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(await page.locator(".login-page .hero-card").evaluate(el => getComputedStyle(el).animationName), "none");
        assert.equal(await page.locator(".login-page .sheep-eye").evaluate(el => getComputedStyle(el).animationName), "none");
      }
      await context.close();
    }
  }
  if (phase === "after") {
    const gallery = await browser.newPage();
    await gallery.goto(pathToFileURL(resolve(dir, "index.html")).href);
    const sizes = await gallery.locator("img").evaluateAll(images => images.map(img => img.naturalWidth));
    assert.deepEqual(sizes, [1440, 1440, 1440, 1440, 390, 390, 390, 390]);
    const video = gallery.locator("video");
    await video.evaluate(async el => { el.muted = true; await el.play(); });
    await gallery.waitForFunction(() => document.querySelector("video").currentTime > 0.2);
    console.log("Gallery: 8 original images loaded and WebM playback verified.");
    await gallery.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
