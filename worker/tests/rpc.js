export default {
  async fetch(request) {
    if (request.headers.get("apikey") !== "fixture") return new Response(null, {status: 500});
    const path = new URL(request.url).pathname;
    const body = await request.json();
    if (!/^[a-f0-9]{64}$/.test(body.app_key_hash)) return new Response(null, {status: 400});
    if (path === "/rest/v1/rpc/lookup_key_app") return Response.json("badcafe0-0000-4000-8000-000000000001");
    if (path === "/rest/v1/rpc/suggest_feature_map") {
      const [item] = body.items;
      return new Response(null, {status: item.route === "/a/:id" && item.name === "[가림]" ? 204 : 500});
    }
    if (path !== "/rest/v1/rpc/ingest_batch") return new Response(null, {status: 500});
    const {payload} = body;
    switch (payload.app_version) {
      case "revoked": return Response.json({ code: "PT401" }, { status: 401 });
      case "invalid": return Response.json({ code: "22023" }, { status: 400 });
      case "apikey": return Response.json({message:"Invalid API key"}, {status:401});
      case "bad-json": return new Response("bad",{status:400});
      case "permission": return Response.json({code:"42501"},{status:403});
      case "gateway": return Response.json({code:"PT401"},{status:502});
      case "bad-counts": return Response.json({});
      case "unavailable": return new Response(null, { status: 500 });
      case "disconnect": throw new Error("fixture connection failure");
      default: return Response.json({ accepted: 1, dropped: 0 });
    }
  }
};
