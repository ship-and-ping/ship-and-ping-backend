import Worker from "./index.js";
export default class TestWorker extends Worker {
  async fetch(request) {
    if (new URL(request.url).pathname === "/test/tick") {
      await super.scheduled({ cron: "* * * * *", scheduledTime: Date.now() });
      return new Response("ok");
    }
    return super.fetch(request);
  }
}
