import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockPage } from "./fixtures.mjs";

const phase = process.argv[2];
assert(["before", "auth-before", "stack-before", "after"].includes(phase), "Unknown capture phase");
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
  for (const width of ["before", "after"].includes(phase) ? [1440, 390] : []) {
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
        if (width === 1440) assert.equal(await page.locator(".login-page .panel").evaluate(el => getComputedStyle(el).animationDelay), "0.072s");
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
  if (["auth-before", "after"].includes(phase)) {
    const issue = "/apps/10000000-0000-0000-0000-000000000001/issues/20000000-0000-0000-0000-000000000002";
    for (const [name, path] of [["login", issue], ["signup", "/signup"], ["forgot", "/forgot-password"], ["device-200", "/account"]]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const device = name === "device-200";
      await mockPage(page, "normal", device, origin);
      await page.goto(origin + path);
      if (device) {
        await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 500, json: { message: "QA offline" } }));
        await page.getByRole("main").getByRole("button", { name: "로그아웃", exact: true }).click();
        await page.getByRole("button", { name: "그래도 이 기기에서 로그아웃" }).click();
        const toast = page.locator(".toast");
        await toast.waitFor();
        await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
        await page.waitForTimeout(350);
        const box = await toast.boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
        if (phase === "after") {
          assert((await toast.locator("p").boundingBox()).width > 280);
          assert(await toast.getByRole("button", { name: "안내 닫기" }).isVisible());
        }
      } else {
        const field = page.getByLabel("이메일 주소");
        await field.waitFor();
        await page.waitForTimeout(350);
        const fieldBox = await field.boundingBox();
        console.log(name, "email y", fieldBox.y);
        if (phase === "after") {
          assert(fieldBox.y < 360);
          if (name === "login") {
            assert(await page.getByText("알림에서 온 문제를 열려면 로그인해 주세요.").isVisible());
            assert((await page.getByRole("link", { name: "비밀번호 찾기" }).boundingBox()).y < 550);
          }
        }
      }
      await page.screenshot({ path: resolve(dir, phase + "-" + name + ".png") });
      await context.close();
    }
  }
  if (["stack-before", "after"].includes(phase)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await mockPage(page, "normal", true, origin);
    await page.route("**/rpc/confirm_feature_names", route => route.fulfill({json: []}));
    await page.goto(origin + "/apps/demo/settings");
    await page.getByLabel("앱 이름", {exact: true}).fill("모임모아");
    const save = page.getByRole("button", { name: "앱 정보 저장" });
    await save.click();
    const appToast = page.locator(".toast").filter({hasText:"앱 정보를 저장했어요."});
    await appToast.waitFor();
    if (phase === "after") {
      const entry = await appToast.evaluateHandle(el => el.parentElement.getAnimations()[0]);
      assertFade(await entry.evaluate(animation => animation.effect.getKeyframes()), "entry");
      await save.click();
      await save.waitFor({state:"visible"});
      await page.waitForFunction(() => !document.querySelector("fieldset").disabled);
      assert(await appToast.evaluate((el, animation) => animation === el.parentElement.getAnimations()[0], entry));
    }
    await page.getByLabel(/기능 이름$/).fill("참가 신청");
    await page.getByRole("button", {name:"이름 저장"}).click();
    await page.getByText("기능 이름표를 저장했어요.", {exact:true}).waitFor();
    await page.waitForTimeout(220);
    await page.screenshot({path: resolve(dir, phase + "-settings.png")});
    if (phase === "after") {
      assert.equal(await page.locator(".toast").count(), 2);
      const frames = await appToast.evaluate(async el => {
        el.querySelector("button").click();
        await new Promise(requestAnimationFrame);
        return el.getAnimations()[0].effect.getKeyframes();
      });
      assertFade(frames, "exit");
      await appToast.waitFor({state:"detached"});
    }
    await context.close();
  }
  if (phase === "after") {
    const gallery = await browser.newPage();
    await gallery.goto(pathToFileURL(resolve(dir, "index.html")).href);
    const sizes = await gallery.locator("img").evaluateAll(images => images.map(img => img.naturalWidth));
    assert(sizes.length >= 8 && sizes.every(width => [1440, 390].includes(width)));
    const video = gallery.locator("video");
    await video.evaluate(async el => { el.muted = true; await el.play(); });
    await gallery.waitForFunction(() => document.querySelector("video").currentTime > 0.2);
    console.log("Gallery:", sizes.length, "images loaded and WebM playback verified.");
    await gallery.close();
  }
} finally {
  await browser?.close();
  await server.close();
}

function assertFade(frames, phase) {
  const transparentEnd = phase === "entry" ? 0 : 1;
  assert(frames.some(frame => frame.computedOffset === transparentEnd && frame.opacity === "0"), phase + " fades");
  assert(frames.every(frame => !frame.transform || frame.transform === "none"), phase + " has no translation");
}
