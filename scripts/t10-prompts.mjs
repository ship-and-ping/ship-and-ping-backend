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
for (const name of ["with-server", "browser-only"]) {
  const server = name === "with-server";
  const fixture = (server ? "sp_srv_" : "sp_pub_") + "0".repeat(64);
  const prompt = buildConnectPrompt(fixture, "https://127.0.0.1:58781");
  await writeFile(
    new URL("../examples/" + name + "/connect.txt", import.meta.url),
    prompt.replace(fixture, server ? "<SERVER_KEY>" : "<PUBLIC_KEY>") + "\n",
  );
}
