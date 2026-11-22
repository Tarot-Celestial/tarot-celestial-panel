const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const uuid = "8727e011-e90a-4ac0-9aa7-645b967dbf47";
const sha = "a".repeat(64);
const connection = { account_id:"123",persisted_account_id:"123",username:"tarotcelestialof",owner_id:"actor",
  connected_at:"2026-11-22T20:00:00Z",can_publish:true };
const body = { action:"approve",version_id:uuid,request_id:uuid,media_sha256:sha,username:connection.username,
  account_id:"123",connection_owner:"actor",connected_at:connection.connected_at,caption:"Un texto",alt_text:"Un cartel",offer:null,scheduled_at:null,time_zone:"Europe/Madrid" };
function fixture(allowed) {
  const calls=[],exports={};
  const db={from(name){
    const data = name==="office_tasks"?{department_id:"marketing",status:"en_revision"}:name==="office_versions"?{id:uuid}:[];
    const q={ select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},single(){return q;},
      then(resolve){resolve({data,error:null});} };return q;
  }, async rpc(name,params){calls.push({name,params});return {data:name==="office_ig_approve"?uuid:null,error:null};}};
  const source=fs.readFileSync("src/app/api/admin/office/instagram/route.ts","utf8");
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const json=(v,s=200)=>Response.json(v,{status:s});
  vm.runInNewContext(js,{exports,URL,Date,Intl,process:{env:{VERCEL_ENV:"production"}},require(name){
    if(name.includes("@vercel/functions"))return {waitUntil(){}};
    if(name.endsWith("office-access"))return {officeAccess:async()=>allowed?{ok:true,admin:db,authUserId:"actor"}:{ok:false,response:json({},403)},officeError:(e,s)=>json({error:e},s),officeJson:json,officeUuid:v=>v===uuid};
    if(name.endsWith("instagram-graph"))return {officeInstagramConnection:async()=>connection,OfficeInstagramError:class extends Error{}};
    if(name.endsWith("instagram-media"))return {InstagramDraftError:class extends Error{},loadInstagramVersion:async()=>({version:{id:uuid,status:"aprobado"},media:{sha,type:"image/jpeg"},caption:"Un texto",alt_text:"Un cartel"})};
    if(name.endsWith("instagram-worker"))return {processOfficeInstagram:async()=>{calls.push({name:"worker"});}};
    throw new Error(name);
  }});
  return {calls,post:(input)=>exports.POST(new Request("https://example.test",{method:"POST",body:JSON.stringify(input)}))};
}
test("la aprobación se vincula al medio, texto, destino, oferta y generación vistos en la Oficina",async()=>{
  for(const patch of [{caption:"Otro"}, {alt_text:"Otro"}, {media_sha256:"b".repeat(64)}, {account_id:"other"}, {connection_owner:"other"}, {connected_at:"other"},{offer:"Nueva oferta"}]){
    const f=fixture(true);assert.equal((await f.post({...body,...patch})).status,409);
    assert.ok(!f.calls.some(c=>c.name==="office_ig_approve"||c.name==="worker"));
  }
  const ok=fixture(true);assert.equal((await ok.post(body)).status,202);
  assert.equal(ok.calls.find(c=>c.name==="office_ig_approve").params.p_actor,"actor");
  const denied=fixture(false);assert.equal((await denied.post(body)).status,403);assert.equal(denied.calls.length,0);
});
