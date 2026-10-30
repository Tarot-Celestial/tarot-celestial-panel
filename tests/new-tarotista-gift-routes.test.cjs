const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const worker={id:id(1),user_id:id(11),role:'central',is_active:true,display_name:'Test Central'};
const preview={effective_rank:'plata',minutes:10,policy_key:'new_tarotista_once_v1',offers:[]};
const initialPreview={policy_key:'initial_consultation_once_v1',eligible:true,minutes:7,reason:null};
const good={uso_tipo:'rank_free',cliente_id:id(20),tarotista_worker_id:id(2),operation_id:id(30),rank_free_expected_rank:'plata',rank_free_expected_minutes:10,rank_free_eligibility_key:id(2)};
const result={rendimiento:{id:id(40),tiempo:10,usa_7_free:false,captado:false},balances:{free_after:0,normal_after:0},rank_free:{effective_rank:'plata',minutes:10,grant_minutes:10,consume_minutes:10},duplicate_prevented:false};
function load(file,deps){
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',code)(name=>{if(name in deps)return deps[name];throw Error('Unexpected import '+name)},m,m.exports);return m.exports;
}
function setup(options={}){
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.invalid';
 process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fictional-public-key';
 process.env.SUPABASE_SERVICE_ROLE_KEY='fictional-service-key';
 const calls=[],authCalls=[];
 const db={
  auth:{getUser:async token=>{authCalls.push(token);return {data:{user:token==='verified-token'?{id:id(11)}:null},error:null};}},
  from(table){const q={select(){return q},eq(){return q},maybeSingle:async()=>{
   if(table==='workers')return {data:options.worker===undefined?worker:options.worker,error:null};
   if(table==='crm_clientes')return {data:{minutos_free_pendientes:0,minutos_normales_pendientes:0},error:null};
   throw Error('Unexpected table '+table);
  }};return q},
  async rpc(name,args){calls.push({name,args});
   if(name==='tc_new_tarotista_gift_preview')return {data:preview,error:options.previewError||null};
   if(name==='tc_initial_consultation_gift_preview')return {data:initialPreview,error:options.previewError||null};
   if(name==='tc_register_initial_consultation_gift')return {data:{...result,initial_free:{policy_key:'initial_consultation_once_v1',minutes:7}},error:null};
   if(name==='tc_register_new_tarotista_gift')return {data:options.result===undefined?result:options.result,error:options.error||null};
   throw Error('Unexpected RPC '+name);
  },
 };
 const next={NextResponse:{json:(body,init={})=>new Response(JSON.stringify(body),{status:init.status||200,headers:init.headers})}};
 const gift=load('src/lib/server/new-tarotista-gift.ts',{'next/server':next,'@/lib/server/panel-attendance':{
  requireActivePanelSession:async()=>options.offline?{ok:false,status:423,error:'PANEL_CONNECTION_REQUIRED'}:{ok:true},
 }});
 const initialGift=load('src/lib/server/initial-consultation-gift.ts',{'next/server':next,'@/lib/server/panel-attendance':{
  requireActivePanelSession:async()=>options.offline?{ok:false,status:423,error:'PANEL_CONNECTION_REQUIRED'}:{ok:true},
 }});
 const route=load('src/app/api/crm/rendimiento/registrar/route.ts',{
  'next/server':next,'@supabase/supabase-js':{createClient:()=>db},
  '@/lib/server/client-promotions':{},'@/lib/ruleta':{},'@/lib/server/paypal-crm':{},
  '@/lib/server/cliente-minute-packs':{CLIENTE_MINUTE_PACKS:[]},'@/lib/server/new-tarotista-gift':gift,
  '@/lib/server/initial-consultation-gift':initialGift,
 });
 const post=(body=good,token='verified-token')=>route.POST(new Request('https://example.invalid/api/crm/rendimiento/registrar',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}));
 return {route,post,calls,authCalls};
}
test('actual route verifies bearer and rejects missing/inactive/nonstaff actors before gift RPC',async()=>{
 for(const [options,token,status] of [[{},'forged-payload-only',401],[{worker:{...worker,is_active:false}},'verified-token',401],[{worker:{...worker,role:'tarotista'}},'verified-token',403]]){
  const h=setup(options),r=await h.post(good,token);assert.equal(r.status,status);assert.deepEqual(h.authCalls,[token]);assert.equal(h.calls.length,0);
 }
});
test('actual GET balance adds read-only preview and makes no grant call',async()=>{
 const h=setup(),r=await h.route.GET(new Request('https://example.invalid/api/crm/rendimiento/registrar?mode=balance&cliente_id='+id(20),{headers:{authorization:'Bearer verified-token'}}));
 assert.equal(r.status,200);const j=await r.json();assert.deepEqual(j.rank_free,preview);assert.equal(j.balance.minutos_free_pendientes,0);
 assert.deepEqual(j.initial_free,initialPreview);
 assert.deepEqual(h.calls.map(x=>x.name),['tc_new_tarotista_gift_preview','tc_initial_consultation_gift_preview']);
});
test('connected gift POST ignores forged balances and identity; early return skips capture and purchases',async()=>{
 const h=setup(),r=await h.post({...good,free_delta:999,points_to_add:999,telefonista_worker_id:id(99),minutos_1:999,note_text:'forged'});
 assert.equal(r.status,200);assert.equal((await r.json()).rank_free.minutes,10);
 assert.deepEqual(h.calls.map(x=>x.name),['tc_register_new_tarotista_gift']);
 assert.equal(h.calls[0].args.p_user,worker.user_id);
 assert.deepEqual(h.calls[0].args.p_payload,{operation_id:id(30),cliente_id:id(20),tarotista_worker_id:id(2),rank_free_expected_rank:'plata',rank_free_expected_minutes:10,rank_free_eligibility_key:id(2)});
});

test('Bronze and unranked gifts reach the atomic eligibility check with zero balance',async()=>{
 for(const rank of ['sin_rango','bronce']){
  const h=setup({result:{...result,rank_free:{...result.rank_free,effective_rank:rank,minutes:7,grant_minutes:7,consume_minutes:7}}});
  const r=await h.post({...good,rank_free_expected_rank:rank,rank_free_expected_minutes:7});
  assert.equal(r.status,200);assert.equal((await r.json()).rank_free.minutes,7);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_payload.rank_free_expected_rank,rank);
 }
 for(const rank of [null,'unknown','admin']){
  const h=setup();assert.equal((await h.post({...good,rank_free_expected_rank:rank})).status,400);assert.equal(h.calls.length,0);
 }
});

test('the actual initial-free route delegates once with verified identity and no later capture or payment mutation',async()=>{
 const body={uso_tipo:'initial_free',cliente_id:id(20),tarotista_worker_id:id(2),operation_id:id(30),free_delta:999,user_id:id(99),minutos_1:999};
 const h=setup(),r=await h.post(body);assert.equal(r.status,200);assert.equal((await r.json()).initial_free.minutes,7);
 assert.deepEqual(h.calls.map(x=>x.name),['tc_register_initial_consultation_gift']);
 assert.equal(h.calls[0].args.p_user,worker.user_id);
 assert.deepEqual(h.calls[0].args.p_payload,{operation_id:id(30),cliente_id:id(20),tarotista_worker_id:id(2)});
 const offline=setup({offline:true});assert.equal((await offline.post(body)).status,423);assert.equal(offline.calls.length,0);
 const unauthorized=setup();assert.equal((await unauthorized.post(body,'forged')).status,401);assert.equal(unauthorized.calls.length,0);
});
test('offline connection and purchase/capture/manual mixtures are rejected before atomic RPC',async()=>{
 const offline=setup({offline:true});assert.equal((await offline.post()).status,423);assert.equal(offline.calls.length,0);
 for(const bad of [{cliente_compra_minutos:true},{captado:true},{recuperado:true},{usa_7_free:true},{importe:5},{tarotista_manual_call:'CALL'},{collaborator_source:'CALL_MARIO'},{clasificacion:'captado'},{rank_free_expected_minutes:-10},{rank_free_eligibility_key:id(99)}]){
  const h=setup();assert.equal((await h.post({...good,...bad})).status,400);assert.equal(h.calls.length,0);
 }
});
test('definitive changed/used gift returns current preview and balance; unknown errors stay private',async()=>{
 const h=setup({error:{message:'ALREADY_USED'}}),r=await h.post();assert.equal(r.status,409);
 const j=await r.json();assert.equal(j.error,'ALREADY_USED');assert.deepEqual(j.rank_free,preview);assert.equal(j.balance.minutos_free_pendientes,0);
 const failed=setup({error:{message:'database host internal details'}}),f=await failed.post();
 assert.equal(f.status,503);assert.doesNotMatch(await f.text(),/host internal/);
});
test('successful replay preserves operation and response; missing migration only hides new offers',async()=>{
 const h=setup({result:{...result,duplicate_prevented:true}}),r=await h.post();
 assert.equal(r.status,200);assert.equal((await r.json()).duplicate_prevented,true);assert.equal(h.calls[0].args.p_payload.operation_id,good.operation_id);
 const missing=setup({previewError:{code:'PGRST202'}}),response=await missing.route.GET(new Request('https://example.invalid/api/crm/rendimiento/registrar?mode=balance&cliente_id='+id(20),{headers:{authorization:'Bearer verified-token'}}));
 const j=await response.json();assert.equal(j.ok,true);assert.equal(j.rank_free.reason,'POLICY_NOT_CONFIGURED');assert.deepEqual(j.rank_free.offers,[]);
});
