const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor={id:id(1),user_id:id(11),role:'central',is_active:true};
const body={uso_tipo:'initial_free',cliente_id:id(20),tarotista_worker_id:id(2),operation_id:id(30)};
const preview={policy_key:'initial_consultation_once_v1',eligible:true,minutes:7,reason:null};
const receipt={ok:true,rendimiento:{id:id(40),tiempo:7,usa_7_free:true,captado:false},initial_free:{policy_key:preview.policy_key,minutes:7,grant_minutes:7,consume_minutes:7},balances:{free_after:0,normal_after:12}};
function fixture(options={}){
 const calls=[],checks=[];
 const db={async rpc(name,args){calls.push({name,args});if(name==='tc_initial_consultation_gift_preview')return {data:options.preview===undefined?preview:options.preview,error:options.previewError||null};if(name==='tc_register_initial_consultation_gift')return {data:options.result===undefined?receipt:options.result,error:options.error||null};throw Error('Unexpected RPC '+name);},
  from(table){assert.equal(table,'crm_clientes');const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{minutos_free_pendientes:0,minutos_normales_pendientes:12},error:null})};return q;}};
 const deps={'next/server':{NextResponse:{json:(data,init={})=>new Response(JSON.stringify(data),init)}},'@/lib/server/panel-attendance':{requireActivePanelSession:async(db,worker)=>{checks.push(worker);return options.offline?{ok:false,status:423,error:'PANEL_CONNECTION_REQUIRED'}:{ok:true};}}};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/server/initial-consultation-gift.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',code)(name=>deps[name],m,m.exports);
 return {calls,checks,preview:()=>m.exports.initialConsultationGiftPreview(db,body.cliente_id),post:(input=body,worker=actor)=>m.exports.handleInitialConsultationGiftCall(db,worker,input)};
}

test('read-only initial preview grants nothing, and unavailable schema fails closed',async()=>{
 const h=fixture();assert.deepEqual(await h.preview(),preview);assert.deepEqual(h.calls.map(c=>c.name),['tc_initial_consultation_gift_preview']);
 for(const code of ['PGRST202','42883','XX000']){const x=fixture({previewError:{code,message:'private details'}}),p=await x.preview();assert.equal(p.eligible,false);assert.equal(p.minutes,7);assert.equal(p.reason,code==='XX000'?'UNAVAILABLE':'POLICY_NOT_CONFIGURED');assert.doesNotMatch(JSON.stringify(p),/private details/);}
});

test('inactive/nonstaff actors and offline panels cannot reach the grant RPC',async()=>{
 for(const worker of [{...actor,is_active:false},{...actor,is_active:null},{...actor,role:'tarotista'}]){const h=fixture(),r=await h.post(body,worker);assert.equal(r.status,403);assert.equal(h.calls.length,0);assert.equal(h.checks.length,0);}
 const h=fixture({offline:true}),r=await h.post();assert.equal(r.status,423);assert.equal(h.calls.length,0);
});

test('server forwards only canonical IDs and verified actor; forged balances or minutes cannot change the seven-minute grant',async()=>{
 const h=fixture(),r=await h.post({...body,free_delta:999,normal_delta:999,minutos_1:999,points_to_add:999,telefonista_worker_id:id(99),rank:'diamante'});
 assert.equal(r.status,200);assert.equal((await r.json()).initial_free.minutes,7);
 assert.deepEqual(h.calls,[{name:'tc_register_initial_consultation_gift',args:{p_user:actor.user_id,p_payload:{operation_id:body.operation_id,cliente_id:body.cliente_id,tarotista_worker_id:body.tarotista_worker_id}}}]);
});

test('missing identifiers and purchase/capture/recovery/manual mixtures are rejected without writes',async()=>{
 for(const bad of [{operation_id:''},{tarotista_worker_id:'CALL'},{cliente_id:'invalid'},{cliente_compra_minutos:true},{captado:true},{recuperado:true},{usa_7_free:true},{importe:7},{tarotista_manual_call:'CALL'},{collaborator_source:'CALL_MARIO'},{existing_payment_id:id(80)},{paypal_collection_source:'external'},{clasificacion:'captado'}]){
  const h=fixture(),r=await h.post({...body,...bad});assert.equal(r.status,400);assert.equal(h.calls.length,0);
 }
});

test('definitive historical-use errors refresh preview and balance with 409; internals remain private',async()=>{
 for(const code of ['ALREADY_USED','PREVIOUS_CONSULTATION','TAROTISTA_INACTIVE','PAYMENT_OPERATION_CONFLICT']){
  const h=fixture({error:{message:code},preview:{...preview,eligible:false,reason:code}}),r=await h.post(),j=await r.json();
  assert.equal(r.status,409);assert.equal(j.error,code);assert.equal(j.initial_free.eligible,false);assert.equal(j.balance.minutos_normales_pendientes,12);
 }
 const h=fixture({error:{message:'private database host credential details'}}),r=await h.post();assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/credential details/);
});

test('replays preserve the operation and authoritative receipt; an incomplete success does not claim a grant',async()=>{
 const h=fixture({result:{...receipt,duplicate_prevented:true}}),r=await h.post();assert.equal(r.status,200);assert.equal((await r.json()).duplicate_prevented,true);assert.equal(h.calls[0].args.p_payload.operation_id,body.operation_id);
 for(const result of [null,{rendimiento:receipt.rendimiento},{...receipt,initial_free:{...receipt.initial_free,minutes:15}}])assert.equal((await fixture({result}).post()).status,503);
});
