// Run from web/ with node ../docs/design/qa/landing-2026-11-27/capture.mjs before|after
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { mockPage } from "../../../../web/qa/fixtures.mjs";

const require = createRequire(new URL("../../../../web/package.json", import.meta.url));
const { chromium } = require("playwright");
const { createServer } = await import(pathToFileURL(require.resolve("vite", {conditions:["import"]})));
const dir = fileURLToPath(new URL(".", import.meta.url));
const phase = process.argv[2];
assert.ok(["before", "after"].includes(phase));
const server = await createServer({
  server: {host:"127.0.0.1", port:4183, strictPort:true, hmr:false},
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_qa_local_only"),
    "import.meta.env.VITE_INGEST_URL": JSON.stringify("https://ingest.ship-and-ping.invalid"),
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:"msedge"});
  for (const width of [1440, 390]) {
    for (const colorScheme of ["light", "dark"]) {
      const page = await browser.newPage({viewport:{width, height:width === 390 ? 844 : 900},
        colorScheme, hasTouch:width === 390, locale:"ko-KR"});
      try {
        await mockPage(page, "normal", false, "http://127.0.0.1:4183");
        await page.goto("http://127.0.0.1:4183/");
        await page.locator(".intro h1").waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({path:join(dir, phase + "-" + width + "-" + colorScheme + ".png"), animations:"disabled"});
        if (phase === "before") continue;
        await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
        const issues = await page.evaluate(async () => (await window.axe.run(document, {
          runOnly:{type:"tag", values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]},
        })).violations.map(issue => [issue.id, issue.nodes.map(node => node.target)]));
        assert.deepEqual(issues, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        const float = page.locator(".lp-mobile-start");
        await page.locator(".lp-alerts").scrollIntoViewIfNeeded();
        assert.equal(await page.locator(".lp-header").evaluate(el => el.getBoundingClientRect().top), 0);
        assert.equal(await float.isVisible(), width === 390);
        if (width === 390) assert.ok((await float.boundingBox()).y > 700);
        const tab = page.getByRole("tab", {name:"슬랙"});
        await tab.focus();
        await page.keyboard.press("ArrowRight");
        await page.getByRole("tabpanel", {name:"이메일"}).waitFor();
        await page.getByText("키는 어디에 넣나요?", {exact:true}).focus();
        await page.keyboard.press("Enter");
        assert.ok(await page.locator("details").first().evaluate(el => el.open));
        const pause = page.getByRole("button", {name:"알림 예시 띠 일시정지"});
        await pause.click();
        assert.equal(await page.locator(".lp-track").evaluate(el => getComputedStyle(el).animationPlayState), "paused");
        await page.emulateMedia({reducedMotion:"reduce"});
        for (const selector of [".lp-title", ".lp-track", ".lp-enter"]) {
          assert.equal(await page.locator(selector).first().evaluate(el => getComputedStyle(el).animationName), "none");
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        if (colorScheme === "light") {
          await page.locator(".lp-alerts").evaluate(el => el.scrollIntoView({block:"start"}));
          await page.screenshot({path:join(dir, "alerts-" + width + ".png")});
        }
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
