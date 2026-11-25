import { registerHooks } from "node:module";
import { writeFile } from "node:fs/promises";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./normalize" && context.parentURL.endsWith("/domain.ts"))
      return next("./normalize.ts", context);
    return next(specifier, context);
  },
});
const { buildConnectPrompt } = await import("../web/src/domain.ts");
const fixture = "sp_pub_" + "0".repeat(64);
for (const name of ["with-server", "browser-only"]) {
  const prompt = buildConnectPrompt(fixture, "https://127.0.0.1:58781");
  await writeFile(
    new URL("../examples/" + name + "/connect.txt", import.meta.url),
    prompt.replace(fixture, "<PUBLIC_KEY>") + "\n",
  );
}
