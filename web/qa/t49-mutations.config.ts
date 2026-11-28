// Opt-in Vitest configuration. Mutations exist only in the test module graph.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({mode}) => ({
  test: { environment: "jsdom", include: ["src/data.test.ts", "src/PushChannel.test.tsx"] },
  plugins: [react(), {
    name: "t49-in-memory-mutations",
    enforce: "pre",
    apply: "serve",
    transform(source, id) {
      if (mode === "skip-server-logout") {
        if (id.endsWith("/src/data.ts")) return source.replace("if (!deviceOnly) {", "if (false) {");
        return;
      }
      if (mode === "skip-push-lock") {
        if (id.endsWith("/src/push-lock.ts")) return source.replace("navigator.locks.request(name, action)", "action()");
        return;
      }
      if (["early-member","skip-revocation","ignore-owner","skip-enable-retry"].includes(mode)) {
        if (!id.endsWith("/src/data.ts")) return;
        if (mode === "early-member") return source.replace("const marker = read(cleanupKey,pending);", "write(lastMemberKey,user); const marker = read(cleanupKey,pending);");
        if (mode === "skip-revocation") return source.replace("if (state === \"owned\") await checkTarget(target,true);","void target;");
        if (mode === "ignore-owner") return source.replace('if (state === "owned" ||', 'if (state === "other" || state === "owned" ||');
        return source.replace("await finishCleanup(() => observedMember ?? read(lastMemberKey,null));","void action;");
      }
      if (id.endsWith("/src/push.ts")) {
        return source.replace("notices?.forEach(notice => notice.close());", "void notices;");
      }
      if (id.endsWith("/src/PushChannel.tsx")) {
        return source.replace("devices.find(d => d.endpoint === endpoint)", "devices[0]");
      }
      if (id.endsWith("/src/data.ts")) {
        return source.replace("!await sub.unsubscribe()", "false");
      }
    },
  }],
}));
