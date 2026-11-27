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
        return source.replace("const stale = missingBinding || keyChanged;", "const stale = keyChanged;");
      }
      if (id.endsWith("/src/data.ts")) {
        return source.replace(/\}\)\.catch\(\(\) => \{\}\);(\s+const \{ error \} = await client.auth.signOut)/, "});$1")
          .replace("if (retry) timer = setTimeout(() => restore(user, attempt, false), 5000);", "if (retry) return;");
      }
    },
  }],
});
