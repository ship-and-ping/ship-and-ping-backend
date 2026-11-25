import { monitor } from "../../monitor.mjs";
const telemetry = monitor(globalThis.shippingConfig, "browser");
addEventListener("pagehide", telemetry.flush);

import { display } from "../../display.mjs";
const join = document.querySelector("#join");
const count = document.querySelector("#count");

function registrations(method) {
  let total = Number(localStorage.getItem("book-club") ?? 0);
  if (method === "POST") localStorage.setItem("book-club", String(++total));
  return total;
}

async function act(method) {
  const start = performance.now();
  let status = 200;
  try {
    display(registrations(method));
  } catch {
    status = 500;
    display(null);
  } finally {
    telemetry.record(method, status, start);
  }
}
join.onclick = () => act("POST");
count.onclick = () => act("GET");
