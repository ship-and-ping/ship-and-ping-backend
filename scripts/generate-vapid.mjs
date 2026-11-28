import { webcrypto } from "node:crypto";

// Run interactively. Never send production keys to CI logs or redirected output.
if (!process.stdout.isTTY) throw Error("개인 터미널에서 직접 실행해 주세요.");
const pair = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
);
const { d } = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
const raw = await webcrypto.subtle.exportKey("raw", pair.publicKey);
process.stdout.write(`VAPID_PRIVATE_KEY=${d}\nVAPID_PUBLIC_KEY=${Buffer.from(raw).toString("base64url")}\n`);
