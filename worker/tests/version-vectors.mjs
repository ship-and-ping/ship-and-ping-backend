const sha = "abcdef01".repeat(5);
const stamp = "2026-11-27T10:54:02.874Z";
const id = "8c99bb34-5e7e-43e2-9cc6-08b34e145f4e";
const awsSuffix = "A1B2".repeat(4);
const token = "aB09".repeat(8);

export const shown = [
  { input: "02659da", expected: "02659da" },
  { input: "abcdef012345", expected: "abcdef012345" },
  { input: sha, expected: "abcdef0" },
  { input: "2.3.1", expected: "2.3.1" },
  { input: "v2.3.1-rc.1", expected: "v2.3.1-rc.1" },
  { input: "1.0.0+build.5", expected: "1.0.0+build.5" },
  { input: "2026-11-27", expected: "11/27 09:00" },
  { input: stamp, expected: "11/27 19:54" },
  { input: "2026-11-27T23:54:02-05:00", expected: "11/28 13:54" },
  { input: stamp + "-" + id, expected: "11/27 19:54 · 8c99bb34" },
  ...["1", "123456789", "build123", "build-123", "b123", "b-123", "-123"].map(input => ({ input, expected: input })),
];

export const hidden = [
  ...["sk_", "pk_", "rk_", "sb_secret_", "sb_publishable_", "ghp_", "sp_pub_", "sp_srv_"].map(prefix => prefix + token),
  ...["AKIA", "ASIA", "v1AKIA"].map(prefix => prefix + awsSuffix),
  ["eyJ" + token, token, token].map(part => part.slice(0, 15)).join("."),
  "aZ19".repeat(10), "aZ19".repeat(7) + "aZ0=", "a".repeat(32), sha + "a", "a".repeat(64),
  "1.0.0+" + "a".repeat(21), "1.0.0-" + "x".repeat(17) + "+2", "1".repeat(61) + ".1.2",
  "v1", "2026.11.26.1530", "v20261126-1530", "2026.02.1530.0001", "ABCDEF01", "build-1234567890",
  id, stamp + "-" + id.replace("-43e2", "-13e2"), stamp + "-" + id.replace("-9cc6", "-7cc6"),
  "2026-02-30", "2026-11-27T25:00:00Z", " 1.2.3", "1.2.3 ", "1.2.3\n", "abc\u0000def", "abc\u200bdef", "",
];
