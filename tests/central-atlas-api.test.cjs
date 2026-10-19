const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
class AssistantError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
function fixture() {
  const h = { role: 'central', calls: [], queries: [], fail: null };
  const jobs = [{id:id(2),worker_id:id(1),client_ids:[id(3)],lead_ids:[],status:'pending'}];
  const db = { from(table) {
    const q = { table, filters: [], fields: null }; h.queries.push(q);
    const chain = { select(fields){q.fields=fields;return this;},eq(key,value){q.filters.push([key,value]);return this;},in(key,value){q.filters.push([key,value]);return this;},order(){return this;},limit(){return this;},
      then(resolve,reject){return Promise.resolve({data:table==='atlas_admin_jobs'?jobs:[{id:id(3),nombre:'Cliente',apellido:'Prueba'}],error:h.fail}).then(resolve,reject);} }; return chain;
  }, rpc: async (name,args) => { h.calls.push({name,args}); return {data:{events:[]},error:h.fail}; } };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/central/atlas/route.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,Date,Map,Set,console:{error(){}},require(name){
    if(name==='@/lib/server/central-assistant')return {AssistantError,assistantAuth:async req=>{if(req.headers.get('authorization')!=='Bearer valid')throw new AssistantError('Unauthorized',401);return {db,worker:{id:id(1),user_id:id(11),role:h.role}};}};
    if(name==='@/lib/server/recovery-access')return {recoveryJson:(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Cache-Control':'private, no-store'}})};
    if(name==='@/lib/central-assistant')return {validUuid:value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value)};
    throw Error(name);
  }});
  h.route=exports; h.req=(body,token='valid')=>new Request('https://example.test/api/central/atlas',{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return h;
}
test('task inbox is central only, filters current worker and excludes private/admin payloads',async()=>{
  const f=fixture(); assert.equal((await f.route.GET(f.req(null,'forged'))).status,401);
  f.role='admin';assert.equal((await f.route.GET(f.req())).status,403);f.role='central';
  const response=await f.route.GET(f.req());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal((await response.json()).jobs[0].clients[0].name,'Cliente Prueba');
  assert.ok(f.queries[0].filters.some(([key,value])=>key==='worker_id'&&value===id(1)));
  assert.ok(!f.queries[0].fields.includes('payload'));assert.ok(!f.queries.some(q=>/memor/.test(q.table)));
  assert.equal(f.calls[0].args.p_user,id(11));assert.equal(f.calls[0].args.p_event,null);
});
test('mutations use verified identity and delegate own-job permission checks to atomic RPC',async()=>{
  const f=fixture();let response=await f.route.POST(f.req({action:'update_job',job_id:id(2),status:'completed',result:'Terminado',user_id:id(99)}));
  assert.equal(response.status,200);assert.equal(f.calls[0].args.p_user,id(11));
  assert.equal((await f.route.POST(f.req({action:'update_job',job_id:id(2),status:'blocked',result:'   '}))).status,400);
  f.fail={message:'FORBIDDEN'};response=await f.route.POST(f.req({action:'update_job',job_id:id(9),status:'in_progress'}));assert.equal(response.status,403);
});
test('contact outcomes require stable request ID, valid channel, follow-up date and cannot assert purchases',async()=>{
  const f=fixture(),body={action:'record_outcome',job_id:id(2),client_id:id(3),request_id:id(4),outcome:'interested',channel:'phone'};
  assert.equal((await f.route.POST(f.req(body))).status,200);assert.equal(f.calls[0].args.p_user,id(11));assert.equal(f.calls[0].args.p_request,id(4));
  assert.equal((await f.route.POST(f.req({...body,outcome:'purchase'}))).status,400);
  assert.equal((await f.route.POST(f.req({...body,outcome:'followup'}))).status,400);
  assert.equal((await f.route.POST(f.req({...body,request_id:null}))).status,400);
  assert.equal((await f.route.POST(f.req({...body,outcome:'followup',next_contact_at:'2026-10-20T15:00:00Z'}))).status,200);
});
test('celebrations never accept browser XP and unavailable data is surfaced as failure',async()=>{
  const f=fixture();await f.route.POST(f.req({action:'claim_celebration',event_id:id(6),xp:999,worker_id:id(99)}));
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{name:'tc_central_purchase_celebrations',args:{p_user:id(11),p_event:id(6)}});
  f.fail={code:'42P01'};const response=await f.route.GET(f.req());assert.equal(response.status,503);assert.equal((await response.json()).jobs,undefined);
});
