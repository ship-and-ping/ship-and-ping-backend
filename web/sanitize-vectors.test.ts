import { expect, it } from "vitest";
import vectors from "../docs/specs/sanitize-vectors.json";
import { errorKind, errorName, stepName, sanitizeRoute } from "./src/normalize";
import { readFileSync } from "node:fs";

it.each(vectors.omittedMessages)("drops message %#", input => expect(errorName(input)).toBeNull());
for (const name of vectors.matrix.names) {
  it.each(vectors.matrix.forms)(`drops ${name} form %#`, form => expect(errorName(form.replaceAll("{N}",name))).toBeNull());
}
it.each(vectors.diagnostics)("diagnostics %#", ({input, message, kind, step}) => {
  expect([errorName(input), errorKind(input), stepName(input)]).toEqual([message, kind, step]);
});
it.each(vectors.route)("route %#", ({input, expected}) => expect(sanitizeRoute(input)).toBe(expected));
it("pgTAP uses the shared vectors", () => {
  const sql = readFileSync("../supabase/tests/sanitize_vectors.sql","utf8");
  expect(JSON.parse(sql.split("$vectors$")[1])).toEqual(vectors);
});
