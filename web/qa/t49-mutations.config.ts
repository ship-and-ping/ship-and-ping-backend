// Opt-in Vitest configuration. Mutations exist only in the test module graph.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", include: ["src/data.test.ts", "src/PushChannel.test.tsx"] },
  plugins: [react(), {
    name: "t49-in-memory-mutations",
    enforce: "pre",
    apply: "serve",
    transform(source, id) {
      if (id.endsWith("/src/push.ts")) {
        return source.replace("notices?.forEach(notice => notice.close());", "void notices;");
      }
      if (id.endsWith("/src/PushChannel.tsx")) {
        return source.replace("devices.find(d => d.endpoint === endpoint)", "devices[0]");
      }
      if (id.endsWith("/src/data.ts")) {
        return source.replace("unregister(sub), sub.unsubscribe()", "unregister(sub)")
          .replace("void clearDevice().catch", "void Promise.resolve().catch");
      }
    },
  }],
});
