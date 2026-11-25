export default {
  async fetch(request) {
    if (new URL(request.url).pathname !== "/rest/v1/rpc/ingest_batch" ||
        request.headers.get("apikey") !== "fixture") {
      return new Response(null, { status: 500 });
    }
    const { payload } = await request.json();
    switch (payload.app_version) {
      case "revoked": return Response.json({ code: "PT401" }, { status: 401 });
      case "invalid": return Response.json({ code: "22023" }, { status: 400 });
      case "unavailable": return new Response(null, { status: 500 });
      case "disconnect": throw new Error("fixture connection failure");
      default: return Response.json({ accepted: 1, dropped: 0 });
    }
  }
};
