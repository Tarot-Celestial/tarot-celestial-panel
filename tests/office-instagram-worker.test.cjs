const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const job = { id:"post",version_id:"version",account_id:"123",persisted_account_id:"123",username:"tarotcelestialof",connection_owner:"actor",
  connected_at:"2026-11-01T10:00:00Z",media_sha256:"abc",caption:"Caption",alt_text:"Alt",status:"preparing",
  container_id:null,external_post_id:null,created_at:"2026-11-02T10:00:00Z",lease_token:"lease" };
function fixture(options={}) {
  const calls = [], ledger = [], exports = {};
  const receipt = {id:"456",permalink:"https://www.instagram.com/p/example/",metrics:{likes:0,comments:null,reach:null}};
  class OfficeInstagramError extends Error {}
  class InstagramDraftError extends Error {}
  const graph = { OfficeInstagramError, async officeInstagramConnection() {return {...job,can_publish:true,owner_id:"actor"};},
    async findRecentExactPost(){return options.duplicate ? receipt : null;},
    async createOfficeContainer(){calls.push("create");return "container";},
    async getOfficeContainerStatus(){return options.observed ? "PUBLISHED":"FINISHED";},
    async findOfficeReceipt(){calls.push("lookup");return receipt;},
    async sendOfficeContainer(){calls.push("dispatch");if(options.uncertain)throw new Error();return receipt.id;},
    async readOfficeReceipt(){calls.push("read");return receipt;} };
  const code=ts.transpileModule(fs.readFileSync("src/lib/server/office-instagram-worker.ts","utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{exports,process:{env:{VERCEL_ENV:options.env||"production"}},setTimeout,require:name=>{
    if(name.endsWith("graph"))return graph;
    if(name.endsWith("link"))return {officeMediaUrl:()=>"https://example.test/media"};
    if(name.endsWith("media"))return {InstagramDraftError,loadInstagramVersion:async()=>({version:{status:"aprobado"},media:{sha:"abc",type:"image/jpeg"},caption:"Caption",alt_text:"Alt"})};
    throw new Error(name);
  }});
  const db={rpc:async (name,param)=>{
    if(name==="office_ig_claim")return {data:{...job,...options.job}};
    if(name==="office_ig_transition"){ledger.push(param.p_next);return {data:!(options.revoked && param.p_next==="dispatching")};}
    return {data:true};
  }};
  return {run:()=>exports.processOfficeInstagram(db,job.id),calls,ledger};
}
test("guarda el contenedor antes del despacho y el identificador antes de leer el recibo",async()=>{
  const f=fixture();await f.run();
  assert.deepEqual(f.calls,["create","dispatch","read"]);assert.deepEqual(f.ledger,["container_ready","dispatching","receipt","published"]);
});
test("resultado incierto y contenedor previamente publicado solo se concilian por lectura",async()=>{
  const lost=fixture({uncertain:true});await lost.run();assert.deepEqual(lost.ledger,["container_ready","dispatching","verifying"]);
  const retry=fixture({job:{status:"verifying",container_id:"container"}});await retry.run();assert.deepEqual(retry.calls,["lookup"]);
  const observed=fixture({observed:true,job:{status:"container_ready",container_id:"container"}});await observed.run();
  assert.deepEqual(observed.calls,[]);assert.deepEqual(observed.ledger,["observed_published"]);
});
test("una aprobación revocada, un duplicado exacto o un despliegue de prueba no llega a publicarse",async()=>{
  for(const scenario of [{revoked:true},{duplicate:true},{env:"preview"}]){
    const f=fixture(scenario);await f.run();assert.equal(f.calls.includes("dispatch"),false);
  }
});
