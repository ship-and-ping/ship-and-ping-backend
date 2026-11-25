import { expect, it } from "vitest";

it("웹 소스가 HTML 문자열을 DOM에 직접 넣지 않는다", () => {
  const sources = import.meta.glob<string>(
    [
      "./**/*.{ts,tsx,js,jsx,cjs,mjs,html}",
      "!**/node_modules/**",
      "!**/dist/**",
    ],
    { query: "?raw", import: "default", eager: true },
  );
  const forbidden = ["dangerouslySet" + "InnerHTML", "inner" + "HTML"];
  expect(Object.keys(sources)).toContain("./src/Layout.tsx");
  for (const [path, source] of Object.entries(sources)) {
    for (const sink of forbidden) expect(source, path).not.toContain(sink);
  }
});
