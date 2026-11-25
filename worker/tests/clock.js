import worker from "./index.js";

// Keep every request in the final second of the same UTC quota window.
const instant = Date.parse("2027-01-15T08:00:59Z");
globalThis.Date = class extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return instant; }
};
export default worker;
