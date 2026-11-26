import { readFileSync } from "node:fs";

// Node also imports the prompt builders directly in the example scenario.
const source = new URL("../supabase/migrations/20261126210000_diagnostic_keys.sql", import.meta.url);
/** @type {string[]} */
const keys = JSON.parse(readFileSync(source, "utf8").split("$keys$")[1]);
export default keys;
