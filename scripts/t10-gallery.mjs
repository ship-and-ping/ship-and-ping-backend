import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(new URL("./web/package.json", import.meta.url))(
  "jsdom",
);
const dir = "docs/design/final/";
const html = await readFile(dir + "index.html", "utf8");
const dom = new JSDOM(html, {
  url: "https://gallery.invalid/",
  runScripts: "outside-only",
});
try {
  const { window } = dom;
  window.scrollTo = () => {};
  for (const file of ["kit", "desk", "screens", "index"])
    window.eval(await readFile(dir + "src/" + file + ".js", "utf8"));
  const label = "<em>모임</em> " + ["sp", "srv", "test_sample"].join("_");
  const first = window.SP.entries[0];
  first.title = first.desc = label;
  window.SP.initIndex();
  for (const selector of ["#list a", "#mount h1", "#mount .desc"]) {
    const element = window.document.querySelector(selector);
    assert.equal(element.textContent, "<em>모임</em> [가림]");
    assert.equal(element.querySelector("em"), null);
  }
  console.log(
    "C14 ⑲ gallery list, title and description mask the key and render literal text",
  );
} finally {
  dom.window.close();
}
