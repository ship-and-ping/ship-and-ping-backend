import { describe, expect, it, vi, afterEach } from "vitest";
import { installDevice } from "./install-device";

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15";
const safari = iphone + " Version/16.4 Mobile/15E148 Safari/604.1";

describe("install guide", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    [safari, "safari"],
    [safari.replace("16_4", "16_3"), "update"],
    [iphone + " Mobile/15E148", "open-safari"],
    [iphone + " CriOS/122 Mobile/15E148 Safari/604.1", "open-safari"],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/123 Mobile Safari/537.36", "android"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/123 Safari/537.36", "desktop"],
  ])("chooses the instructions for %s", (userAgent, expected) => {
    vi.stubGlobal("navigator", { userAgent });
    expect(installDevice()).toBe(expected);
  });
  it("takes a home screen launch directly to account setup", () => {
    vi.stubGlobal("navigator", { userAgent: safari, standalone: true });
    expect(installDevice()).toBe("installed");
  });
});
