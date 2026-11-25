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
      await super.scheduled({cron:"* * * * *",scheduledTime:Date.now()});
      return fetch("https://rpc.test/fixture-report");
    }
    return super.fetch(request);
  }
}
