import { display } from "../../display.mjs";
const join = document.querySelector("#join");
const count = document.querySelector("#count");

async function registrations(method) {
  const response = await fetch("/registrations", { method });
  if (!response.ok) throw Error("request failed");
  return (await response.json()).total;
}

async function act(method) {
  try {
    display(await registrations(method));
  } catch {
    display(null);
  }
}
join.onclick = () => act("POST");
count.onclick = () => act("GET");
