const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText,{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name];},URL,Date});
  return exports;
}
const activity = load('src/lib/activity-codes.ts');
const helper = load('src/lib/staff-chat-operations.ts', {'@/lib/activity-codes':activity});
const plain = value => JSON.parse(JSON.stringify(value));
test('safe consultation view exposes only first name and codes, never a phone, surname, amount, or raw client ID', () => {
  for (const [name, expected] of [['María Private Surname','María'],[' + 1 787 5108391','Clienta'],['17875108391','Clienta'],['+17875108391','Clienta'],['client@example.test','Clienta'],['#112','Clienta'],['👤 +17875108391','Clienta'],['Ana-María Example','Ana-María']]) assert.equal(helper.consultationFirstName(name),expected);
  const view = helper.consultationView({id:id(1),cliente_nombre:'Michell Private',cliente_id:'17875108391',telefono:'17875108391',importe:35,tiempo:30,code_blocks:[{code:'FREE',minutes:10},{code:'CLIENTE',minutes:20}],fecha_hora:'2026-11-08T12:00:00Z',edit_revision:3});
  assert.deepEqual(Object.keys(view).sort(),['appeal','blocks','first_name','id','occurred_at','revision','total']);
  assert.deepEqual(plain(view.blocks),[{code:'FREE',minutes:10},{code:'CLIENTE',minutes:20}]);
  assert.doesNotMatch(JSON.stringify(view),/Private|17875108391|importe|telefono/);
  const legacy = helper.consultationView({id:id(2),cliente_nombre:'Ana Private',tiempo:30,resumen_codigo:'10 free · 20 cliente'});
  assert.deepEqual(plain(legacy.blocks),[{code:'FREE',minutes:10},{code:'CLIENTE',minutes:20}]);
});

function harness(options = {}) {
  const me = { id:id(1), role:'central', display_name:'Central', can_admin:false, ...options.me };
  const threads = [{id:id(10),central_worker_id:id(1),tarotist_worker_id:id(2)}, {id:id(11),central_worker_id:id(3),tarotist_worker_id:id(4)}];
  const source = {id:id(20),cliente_nombre:'Michell PrivateSurname',cliente_id:'17875108391',telefono:'17875108391',importe:35,tiempo:30,fecha_hora:'2026-11-08T12:00:00Z',created_at:'2026-11-08T12:00:00Z',code_blocks:[{code:'FREE',minutes:10},{code:'CLIENTE',minutes:20}],telefonista_worker_id:id(1),tarotista_worker_id:id(2),edit_revision:0};
  const tables = {rendimiento_llamadas:[source],staff_chat_call_appeals:[],staff_chat_pauses:[],chat_threads:threads};
  class Query {
    constructor(name){this.name=name;this.filters=[];this.orders=[];this.max=Infinity;}
    select(){return this;}eq(k,v){this.filters.push(row=>row[k]===v);return this;}gt(k,v){this.filters.push(row=>row[k]>v);return this;}in(k,v){this.filters.push(row=>v.includes(row[k]));return this;}
    order(k,{ascending=true}={}){this.orders.push({k,ascending});return this;}limit(n){this.max=n;return this;}
    async run(single=false){let rows=tables[this.name].filter(row=>this.filters.every(f=>f(row)));rows.sort((a,b)=>{for(const {k,ascending}of this.orders){if(a[k]!==b[k])return (a[k]>b[k]?1:-1)*(ascending?1:-1);}return 0;});rows=rows.slice(0,this.max);return {data:single?rows[0]||null:rows,error:null};}
    maybeSingle(){return this.run(true);}then(resolve,reject){return this.run().then(resolve,reject);}
  }
  let connectionChecks=0;const calls=[];
  const db={from:name=>new Query(name),rpc:async(name,args)=>{calls.push({name,args});return options.rpcError?{data:null,error:{message:options.rpcError}}:{data:{id:id(50),status:'active',revision:0},error:null};}};
  const shared={getStaffChatActor:async()=>{if(options.noAuth)throw Error('NO_AUTH');return {db,me};},requireStaffChatConnection:async()=>{++connectionChecks;if(options.offline)throw Error('PANEL_CONNECTION_REQUIRED');},requireStaffChatThread:async(db,actor,threadId)=>{const t=threads.find(t=>t.id===threadId);if(!t)throw Error('THREAD_NOT_FOUND');if(!actor.can_admin&&![t.central_worker_id,t.tarotist_worker_id].includes(actor.id))throw Error('FORBIDDEN');return t;}};
  const server=load('src/lib/server/staff-chat-operations.ts',{'@/lib/server/staff-chat':shared,'@/lib/staff-chat-operations':helper});
  const routeDeps={'@/lib/server/staff-chat':shared,'@/lib/server/staff-chat-operations':server,'next/server':{NextResponse:{json:(data,init={})=>new Response(JSON.stringify(data),init)}}};
  const route=load('src/app/api/chat/operations/route.ts',routeDeps),summary=load('src/app/api/chat/operations/summary/route.ts',routeDeps);
  const body={action:'bathroom',thread_id:id(10),expected_worker_id:me.id,operation_id:id(100)};
  const req=(value=body,threadId=id(10))=>new Request('https://panel.test/api/chat/operations?thread_id='+threadId,{method:value?'POST':'GET',...(value?{body:JSON.stringify(value)}:{})});
  return {me,db,tables,source,route,summary,server,body,req,calls,get connectionChecks(){return connectionChecks;}};
}
test('authenticated overview and inherited message enrichment are privacy projections',async()=>{
  const h=harness();const response=await h.route.GET(h.req(null));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  const json=await response.json();assert.equal(json.latest_consultation.first_name,'Michell');assert.doesNotMatch(JSON.stringify(json),/PrivateSurname|17875108391|importe|telefonista_worker_id/);
  const enriched=await h.server.enrichStaffOperationMessages(h.db,h.tables.chat_threads[0],[{id:id(70),kind:'consultation'}]);assert.equal(enriched[0].consultation.first_name,'Michell');
  assert.equal((await h.route.GET(h.req(null,id(11)))).status,403);
  assert.equal((await harness({noAuth:true}).route.GET(h.req(null))).status,401);
});
test('pending older appeals remain reviewable after a newer call and even source deletion',async()=>{
  const h=harness();h.tables.staff_chat_call_appeals.push({id:id(21),thread_id:id(10),call_id:id(22),worker_id:id(2),reason:'Minutos incorrectos',status:'pending',revision:0,call_revision:0,created_at:'2026-11-08T11:00:00Z'});
  h.tables.rendimiento_llamadas.push({...h.source,id:id(22),cliente_nombre:'Nora PrivateSurname',fecha_hora:'2026-11-08T11:00:00Z'});
  let result=await (await h.route.GET(h.req(null))).json();assert.equal(result.pending_appeals.length,1);assert.equal(result.pending_appeals[0].first_name,'Nora');assert.doesNotMatch(JSON.stringify(result),/PrivateSurname|17875108391/);
  h.tables.rendimiento_llamadas.pop();result=await (await h.route.GET(h.req(null))).json();assert.equal(result.pending_appeals[0].deleted,true);assert.equal(result.pending_appeals[0].appeal.id,id(21));assert.equal(result.latest_consultation.id,id(20));
});
test('summary shows operational absences globally but pending actions only in authorized threads',async()=>{
  const h=harness();h.tables.staff_chat_pauses.push({id:id(30),thread_id:id(11),worker_id:id(4),worker_name:'Otra tarotista',kind:'bathroom',status:'active',created_at:'2026-11-08T11:00:00Z'}, {id:id(31),thread_id:id(11),worker_id:id(4),worker_name:'Otra tarotista',kind:'lunch',status:'pending',created_at:'2026-11-08T12:00:00Z'});
  const result=await (await h.summary.GET(h.req(null))).json();assert.equal(result.pauses.length,1);assert.equal(result.pending.length,0);
});
test('POST pins expected identity, UUID and revision before issuing mutation RPC',async()=>{
  const h=harness();for(const patch of [{expected_worker_id:id(999)},{operation_id:'wrong'},{action:'pay'},{target_id:'wrong'},{revision:1.5},{revision:-1},{reason:'x'.repeat(501)}])assert.ok((await h.route.POST(h.req({...h.body,...patch}))).status>=400);
  assert.equal(h.calls.length,0);assert.equal((await h.route.POST(h.req())).status,200);assert.equal(h.calls[0].name,'staff_chat_operation');assert.equal(h.calls[0].args.p_actor,h.me.id);
});
test('connection required for new notices, but owner return and withdrawal can finish after timeout',async()=>{
  const h=harness({offline:true});assert.equal((await h.route.POST(h.req())).status,423);assert.equal(h.calls.length,0);
  for(const action of ['return','cancel_pause'])assert.equal((await h.route.POST(h.req({...h.body,action,target_id:id(30),revision:0}))).status,200);
  assert.equal(h.connectionChecks,1);assert.equal(h.calls.length,2);
});
test('RPC errors are mapped without exposing raw database failures',async()=>{
  for(const [code,status] of [['CALL_CHANGED',409],['OPERATION_CONFLICT',409],['FORBIDDEN',403],['INVALID_REASON',400],['SECRET DATABASE DETAIL',503]]){
    const h=harness({rpcError:code}),response=await h.route.POST(h.req());assert.equal(response.status,status);assert.equal((await response.json()).error,code==='SECRET DATABASE DETAIL'?'OPERATIONS_UNAVAILABLE':code);
  }
});
