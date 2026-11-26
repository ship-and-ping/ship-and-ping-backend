let missingLookups = 0;
const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12,"0");
const hook = ["https:/","hooks.slack.com","services","fixture"].join("/");
const sensitive = ["sp","srv","example"].join("_");
const report = { slack:0, mail:0, broken:0, completed:0, connected:0, safe:true };
const withdrawals = new Map([[id(7), id(9)]]);
let pcGrant;
report.claims = [];
report.releases = [];
report.retry = [];
let round=0;
let stateIssued=false;
function rows() {
  round++;
  const result = [1,2].map(n=>({id:id(n),claim_token:id(3),app:id(4),incident:id(n),event:"open",
    kind:"slow",feature:"신청 "+sensitive,metric:{total:10,p50:n===1?3400.5:null,baseline:n===1?1100:null,raw:"private-body"},raw_route:"/private-route",
    channel:round===2?"email":"slack",hook,destination:"T/C",secret_id:id(7),email:"member@example.invalid",digest:round>1}));
  // This address sorts before the healthy digest, so a batch-wide return loses both.
  if(round===2) result.push({...result[0],id:id(9),app:id(9),email:"a@example.invalid"});
  if(round===2) result.push({...result[0],id:id(8),app:id(8),email:"b@example.invalid"});
  return result;
}
async function fixtureHash(suffix) {
  const raw = new TextEncoder().encode(["sp","pub",suffix].join("_"));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
}
export default {
  async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname==="/fixture-report") return Response.json(report);
    if(url.hostname==="hooks.slack.com" || url.hostname==="api.resend.com") {
      const payload=await request.json();
      report.safe &&= ![sensitive,"private-body","private-route",hook].some(value=>payload.text.includes(value))
        && payload.text.includes("평소 1.1초. 최근 30분 보통 3.4초") && !payload.text.includes("0.0초")
        && (round===3 ? !payload.text.includes("쉽앤핑에서 보기") : [1,2].every(n=>payload.text.includes("https://web.test/apps/"+id(4)+"/issues/"+id(n))));
      if(url.hostname==="hooks.slack.com"){ report.slack++; return new Response("action_prohibited",{status:403}); }
      report.safe &&= payload.to[0]==="member@example.invalid" && payload.subject.includes("모아") && payload.text.includes("12건 더");
      report.mail++;return Response.json({});
    }
    if(url.hostname==="slack.com"){
      const code=(await request.formData()).get("code");
      return Response.json(code==="denied"?{ok:false,error:"action_prohibited"}:{ok:true,team:{id:"T"},incoming_webhook:{url:hook,channel:"#test",channel_id:"C"}});
    }
    if (request.headers.get("apikey") !== "fixture") return new Response(null, {status: 500});
    const path = new URL(request.url).pathname;
    const member = request.headers.get("Authorization")?.slice(7);
    if (path === "/auth/v1/user" && member === "phone") return Response.json({id:id(42),email:"phone@example.invalid",email_confirmed_at:"2026-11-26"});
    if (path === "/auth/v1/admin/generate_link") {
      const input=await request.json();
      if(input.type!=="magiclink" || input.email!=="phone@example.invalid") return new Response(null,{status:400});
      return Response.json({id:id(42),hashed_token:"fixture-pc-grant"});
    }
    if (path === "/auth/v1/user") return member === "6" ? new Response(null,{status:401}) : Response.json({id:id(member)});
    if (path === "/rest/v1/apps") return new Response(null,{status:member === "5" ? 503 : 204});
    if (path.startsWith("/auth/v1/admin/users/")) {
      const statuses = {[id(1)]:500,[id(2)]:502,[id(3)]:504,[id(4)]:404};
      return new Response(null,{status:statuses[path.split("/").pop()]});
    }
    const body = await request.json();
    switch(path.split("/").pop()){
      case "login_auth_budget": return Response.json(true);
      case "login_step":
        if(body.p_action==="claim" && body.p_email==="phone@example.invalid" && body.p_code==="427") return Response.json({status:"issuing"});
        if(body.p_action==="seal" && body.p_token==="fixture-pc-grant"){ pcGrant=body.p_token; return Response.json({status:"approved"}); }
        if(body.p_action==="poll" && body.p_secret==="pc-only" && pcGrant){ const grant=pcGrant; pcGrant=null; return Response.json({status:"approved",token_hash:grant}); }
        return Response.json({status:"missing"});
      case "evaluate_all": return new Response(null,{status:503});
      case "claim_notifications": return Response.json(rows());
      case "slack_failed": report.broken++;return Response.json(null);
      case "complete_notification": if (!body.ok) report.retry.push([body.id.slice(-1),body.error,body.token===id(3)]);
        if(body.id===id(1)) return new Response(null,{status:503});
        report.completed+=Number(body.ok && body.token===id(3));return Response.json(null);
      case "reserve_mail": return body.app===id(9) ? new Response(null,{status:503}) : Response.json(body.app===id(4));
      case "claim_withdrawal": {
        report.claims.push(body.member_id.slice(-1));
        if (withdrawals.has(body.member_id)) return Response.json(null);
        const token = crypto.randomUUID();
        withdrawals.set(body.member_id, token);
        return Response.json(token);
      }
      case "release_withdrawal":
        if (withdrawals.get(body.member_id) === body.claim_token) {
          withdrawals.delete(body.member_id);
          report.releases.push(body.member_id.slice(-1));
        }
        return Response.json(null);
      case "expand_mail_digest": return body.id===id(8) ? new Response(null,{status:503}) : Response.json(12);
      case "start_slack_state": stateIssued=true;return Response.json(id(8));
      case "consume_slack_state":{
        if(!stateIssued || body.ticket!==id(8))return Response.json(null);
        stateIssued=false;return Response.json(id(4));
      }
      case "connect_slack":report.connected+=Number(body.hook===hook && body.app===id(4));return Response.json(null);
    }
    if (!/^[a-f0-9]{64}$/.test(body.app_key_hash)) return new Response(null, {status: 400});
    if (path === "/rest/v1/rpc/lookup_key_app") {
      if (body.app_key_hash === await fixtureHash("missing")) {
        return ++missingLookups === 1 ? Response.json(null) : new Response(null, {status: 500});
      }
      if (body.app_key_hash === await fixtureHash("outage")) return new Response(null, {status: 500});
      return Response.json("badcafe0-0000-4000-8000-000000000001");
    }
    if (path === "/rest/v1/rpc/suggest_feature_map") {
      const [item] = body.items;
      return new Response(null, {status: item.route === "/a/:id" && item.name === "token=[가림]" ? 204 : 500});
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
