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
