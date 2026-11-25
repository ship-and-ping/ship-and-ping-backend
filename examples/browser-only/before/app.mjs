import { display } from "../../display.mjs";
const join = document.querySelector("#join");
const count = document.querySelector("#count");

function registrations(method) {
  let total = Number(localStorage.getItem("book-club") ?? 0);
  if (method === "POST") localStorage.setItem("book-club", String(++total));
  return total;
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
