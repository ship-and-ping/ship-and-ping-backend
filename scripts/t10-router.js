export default {
  async fetch(request, env) {
    const host = new URL(request.url).hostname;
    if (host === "local-db.test") {
      const response = await env.DB.fetch(request);
      if (!response.ok) {
        const error = await response
          .clone()
          .json()
          .catch(() => ({}));
        console.warn(
          new URL(request.url).pathname.replace(/\/auth\/v1\/admin\/users\/[^/]+$/, "/auth/v1/admin/users/:id"),
          response.status,
          error.code,
          error.code === "21000" ? error.message : "",
        );
      }
      return response;
    }
    if (["slack.com", "hooks.slack.com", "api.resend.com"].includes(host))
      return env.RECEIVER.fetch(request);
    return new Response("unexpected destination", { status: 502 });
  },
};
