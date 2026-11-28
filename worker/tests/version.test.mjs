import assert from "node:assert/strict";
import { test } from "node:test";
import { versionLabel } from "../src/version.js";
import { shown, hidden } from "./version-vectors.mjs";

test("mail version labels match the shared display cases", () => {
  for (const { input, expected } of shown) assert.equal(versionLabel(input), expected, input);
});

test("mail masks the entire unrecognized version", () => {
  for (const input of hidden) assert.equal(versionLabel(input), "버전 형식 확인 필요", input);
});
