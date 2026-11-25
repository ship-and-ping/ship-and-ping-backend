export function display(value) {
  document.querySelector("#result").textContent = Number.isSafeInteger(value)
    ? `신청 ${value}건`
    : "신청 수를 확인할 수 없어요.";
}
