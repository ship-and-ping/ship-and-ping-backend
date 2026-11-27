import { chromium, webkit } from "playwright";

const browser = process.platform === "win32" ? await chromium.launch({ channel: "msedge" }) : await webkit.launch();
try {
  const page = await browser.newPage();
  await page.goto(new URL("../../docs/design/qa/index.html", import.meta.url).href);
  const pairs = await page.evaluate(async () => {
    const scene = document.querySelector("#scene");
    const profile = document.querySelector("#profile");
    let pairs = 0;
    for (const option of scene.options) {
      scene.selectedIndex = option.index;
      for (const view of profile.options) {
        profile.value = view.value;
        profile.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.all([...document.images].map(image => image.decode()));
        pairs++;
      }
    }
    return pairs;
  });
  console.log(pairs + " before/after pairs opened offline");
} finally {
  await browser.close();
}
