import { expect, it } from "vitest";
import vectors from "../docs/specs/sanitize-vectors.json";
import { readFileSync } from "node:fs";
import { displayText, maskText, sanitizeRoute } from "./src/normalize";

const sql = readFileSync("../supabase/tests/sanitize_vectors.sql", "utf8");

it.each(vectors.mask)("mask %#", ({ input, expected }) => {
  expect(maskText(input)).toBe(expected);
  expect(displayText(input)).toBe(expected.replace(/\n+/g, " "));
});

it.each(vectors.route)("route %#", ({ input, expected }) => {
  expect(sanitizeRoute(input)).toBe(expected);
});

// The shared table has no named IDs. pgTAP uses the one-based row number
// within each suite, and constructs key-shaped strings from SQL fragments.
it.each(["mask", "route", "version"] as const)("pgTAP mirrors every %s row", (kind) => {
  const fn = kind === "version" ? "pg_temp.stored_version" : `private.${kind}`;
  const block = sql.split(`${fn}(input)`)[1].split(") as cases")[0];
  const rows = [...block.matchAll(/^  \((\d+), (E'.*?'), (E'.*')\),?$/gm)];
  function readText(expr: string) {
    return expr.split(" || ").map(s => JSON.parse('"' + s.slice(2, -1) + '"')).join("");
  }
  expect(rows.map(([, id, input, expected]) => ({
    id: Number(id), input: readText(input), expected: readText(expected),
  }))).toEqual(vectors[kind].map((row, i) => ({ id: i + 1, ...row })));
});

it("pgTAP uses the shared name and form matrix", () => {
  expect(JSON.parse(sql.split("$matrix$")[1])).toEqual(vectors.matrix);
});

it("limits raw input and reserves space for the truncation marker", () => {
  expect(maskText("🔒".repeat(295) + "가".repeat(1706))).toBe("🔒".repeat(295) + "…[잘림]");
  expect(maskText("Cookie=" + "a".repeat(1994))).toBe("Cookie=[가림]…[잘림]");
});

for (const name of vectors.matrix.names) {
  it.each(vectors.matrix.forms)(`mask ${name} form %#`, ({ input, expected, fullLineExpected }) => {
    const raw = input.replaceAll("{N}", name);
    const fullLine = /^(?:cookie|set-cookie|name|full_name|fullname|username|email|phone|mobile|tel|address|addr|birth|birthday)$/i.test(name);
    const masked = ((fullLine && fullLineExpected) || expected).replaceAll("{N}", name);
    expect(maskText(raw)).toBe(masked);
    expect(displayText(raw)).toBe(masked.replace(/\n+/g, " "));
  });
}
