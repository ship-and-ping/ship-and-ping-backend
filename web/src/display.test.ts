import { expect, it } from "vitest";
import { displayText } from "./normalize";

it.each([
  "sp_srv_",
  "sp_pub_",
  "sb_secret_",
  "sb_publishable_",
])("normalizes and masks embedded %s", (prefix) => {
  const fullwidth = prefix
    .toUpperCase()
    .replace(/[A-Z_]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  expect(
    displayText(
      "앞x" + fullwidth[0] + "\u200b" + fullwidth.slice(1) + "te\u202est123뒤",
    ),
  ).toBe("앞x[가림]뒤");
});
it.each(["sk_", "pk_", "rk_"])("requires a word boundary and 16 alphanumerics for %s", (prefix) => {
  const token = prefix + "a1".repeat(8);
  expect(displayText("/" + token.toUpperCase())).toBe("/[가림]");
  for (const normal of ["desk_", "/task_list", token.slice(0, -1), "x" + token, "_" + token]) {
    expect(displayText(normal)).toBe(normal);
  }
});
it("masks personal data, preserves the member’s own login email exactly", () => {
  expect(
    displayText("사용자 user@example.test · 010-1234-5678 · Bearer demo"),
  ).toBe("사용자 [가림] · [가림] · [가림]");
  expect(displayText("sk_fixture@example.test", "login-email")).toBe(
    "sk_fixture@example.test",
  );
});
it("C14 ⑪·⑳ 줄 구분자를 정리하고 전각 앱 이름의 보이는 글자를 일관되게 만든다", () => {
  expect(displayText("Ａ마트")).toBe("A마트");
  expect(displayText("앞\u2028\u2029\u0085\v\f뒤")).toBe("앞 뒤");
});
it("renders full-width markup as text for JSX escaping", () => {
  expect(displayText("＜em＞앱＜/em＞")).toBe("<em>앱</em>");
});
