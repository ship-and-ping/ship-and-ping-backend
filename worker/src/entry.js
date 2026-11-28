import IngestWorker from "../build/index.js";
import { serveMcp } from "./mcp.js";

export default class ShipAndPingWorker extends IngestWorker {
  fetch(request) {
    if (new URL(request.url).pathname === "/mcp") return serveMcp(request, this.env);
    return super.fetch(request);
  }
}
