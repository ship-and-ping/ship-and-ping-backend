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

// Sample the painted gradient behind the text, including its brightest edge.
async function heroLabelContrast(page) {
  const label = page.locator(".lp-hero .lp-kicker");
  const { clip, color } = await label.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el.lastChild);
    const { left, top, right, bottom } = range.getBoundingClientRect();
    return {
      clip: { x: Math.floor(left), y: Math.floor(top),
        width: Math.ceil(right) - Math.floor(left), height: Math.ceil(bottom) - Math.floor(top) },
      color: getComputedStyle(el).color,
    };
  });
  const pixels = await page.screenshot({clip, style:".lp-hero .lp-kicker { color: transparent !important; }"});
  return page.evaluate(async ({color, data}) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const bg = ctx.getImageData(0, 0, img.width, img.height).data;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    function luminance(r, g, b) {
      const linear = [r, g, b].map(v => v <= 10 ? v / 3294.6 : ((v / 255 + .055) / 1.055) ** 2.4);
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    }
    const ink = luminance(...ctx.getImageData(0, 0, 1, 1).data);
    let minimum = Infinity;
    for (let i = 0; i < bg.length; i += 4) {
      const paper = luminance(bg[i], bg[i + 1], bg[i + 2]);
      minimum = Math.min(minimum, (Math.max(ink, paper) + .05) / (Math.min(ink, paper) + .05));
    }
    return minimum;
  }, {color, data:pixels.toString("base64")});
}

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
        const contrast = await heroLabelContrast(page);
        console.log(width, colorScheme, "웹앱 모니터링 최소 대비", contrast.toFixed(2));
        assert.ok(contrast >= 4.5);
        const faqLabel = await page.locator(".answers .lp-kicker").boundingBox();
        const faqTitle = await page.locator(".answers h2").boundingBox();
        assert.ok(faqLabel.y + faqLabel.height < faqTitle.y);
        await page.addScriptTag({path:require.resolve("axe-core/axe.min.js")});
        const issues = await page.evaluate(async () => (await window.axe.run(document, {
          runOnly:{type:"tag", values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]},
        })).violations.map(issue => [issue.id, issue.nodes.map(node => node.target)]));
        assert.deepEqual(issues, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        const float = page.locator(".lp-mobile-start");
        const nav = page.getByRole("navigation", {name:"시작 메뉴"});
        const logo = await nav.getByRole("link", {name:"쉽앤핑"}).boundingBox();
        const login = await nav.getByRole("link", {name:"로그인"}).boundingBox();
        const signup = await nav.getByRole("link", {name:"회원가입"}).boundingBox();
        assert.ok(logo.x + logo.width <= login.x && login.x + login.width <= signup.x);
        assert.ok(signup.x + signup.width <= width && login.y === signup.y);
        assert.ok([login, signup].every(box => box.width >= 44 && box.height >= 44));
        assert.equal(await float.isVisible(), false);
        await page.locator(".lp-alerts").scrollIntoViewIfNeeded();
        assert.equal(await page.locator(".lp-header").evaluate(el => el.getBoundingClientRect().top), 0);
        assert.equal(await float.isVisible(), false);
        if (width === 390) {
          const staticHeader = await page.addStyleTag({content:".lp-header { position: static; }"});
          await float.waitFor({state:"visible"});
          assert.ok((await float.boundingBox()).y > 700);
          await staticHeader.evaluate(el => el.remove());
          await float.waitFor({state:"hidden"});
        }
        const tab = page.getByRole("tab", {name:"슬랙"});
        await tab.focus();
        await page.keyboard.press("ArrowRight");
        const mail = page.getByRole("tabpanel", {name:"이메일"});
        const detail = mail.getByText("쉽앤핑에서 보기");
        await detail.focus();
        await page.keyboard.press("Enter");
        await mail.getByRole("heading", {name:"모임모아 · 결제 문제 상세"}).waitFor();
        await page.keyboard.press("Enter");
        await page.getByText("키는 어디에 넣나요?", {exact:true}).focus();
        await page.keyboard.press("Enter");
        assert.ok(await page.locator(".lp-faq details").first().evaluate(el => el.open));
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
