import type { Gateway } from "./data";
import { deviceType, subscribe } from "./push";

export async function registerBrowserPush(api:Gateway, app:string, bytes:Uint8Array<ArrayBuffer>, knownEndpoint?:string) {
  return api.withPushRegistration(async ({removeEndpoint,registerPush}) => {
    const sub = await subscribe(bytes,removeEndpoint,knownEndpoint);
    try {
      await registerPush(app,sub.toJSON(),deviceType());
    } catch (error) {
      if (sub.endpoint !== knownEndpoint) await sub.unsubscribe().catch(() => {});
      throw error;
    }
    return sub.endpoint;
  });
}
