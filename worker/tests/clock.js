import worker from "./index.js";

// Keep every request in the final second of the same UTC quota window.
const instant = Date.parse("2027-01-15T08:00:59Z");
globalThis.Date = class extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return instant; }
};
export default class FixtureWorker extends worker {
  async fetch(request) {
    if (new URL(request.url).pathname === "/fixture/no-origin") {
      return this.env.NO_ORIGIN.fetch("https://worker.test/fixture/cron");
    }
    if (new URL(request.url).pathname === "/fixture/cron") {
      if (this.env.NO_ORIGIN) {
        const pair = await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
        const publicBytes = await crypto.subtle.exportKey("raw",pair.publicKey);
        this.env.VAPID_PUBLIC_KEY = btoa(String.fromCharCode(...new Uint8Array(publicBytes)))
          .replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
        this.env.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey("jwk",pair.privateKey)).d;
      }
      await super.scheduled({cron:"* * * * *",scheduledTime:Date.now()});
      return fetch("https://rpc.test/fixture-report");
    }
    return super.fetch(request);
  }
}
