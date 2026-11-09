const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const benefitSummary={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/purchase-benefit-summary.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:benefitSummary});
function harness(){
 const h={rpcCalls:[],role:'central',active:true,rpcError:null,promotionReads:0};
 const tables={crm_clientes:[{id:id(2),nombre:'Prueba',minutos_free_pendientes:0,minutos_normales_pendientes:0}],
  crm_paypal_orders:[{cliente_id:id(2),status:'completed',payment_id:id(3),pack_name:'20 minutos',completed_at:'2026-10-07T12:00:00Z'},
   {cliente_id:id(4),status:'completed',payment_id:id(5)}],
  crm_cliente_pagos:[{id:id(3),cliente_id:id(2),estado:'completed',source_rendimiento_id:null,importe:22,moneda:'EUR'},
   {id:id(5),cliente_id:id(4),estado:'completed',source_rendimiento_id:null,importe:22}]};
 const admin={auth:{getUser:async token=>({data:{user:token==='good'?{id:id(1)}:null}})},from:table=>{
  let filters=[],one=false,value,mode='read',range=null;const q={select:()=>q,order:()=>q,limit:()=>q,gte:()=>q,gt:()=>q,
   range:(from,to)=>{range=[from,to];return q;},
   eq:(k,v)=>{filters.push(r=>(k==='meta->>payment_id'?r.meta?.payment_id:r[k])===v);return q;},is:(k,v)=>{filters.push(r=>(r[k]??null)===v);return q;},
   not:(k,op,v)=>{filters.push(r=>(r[k]??null)!==v);return q;},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},
   insert:v=>{mode='insert';value=v;return q;},upsert:v=>{mode='insert';value=v;return q;},delete:()=>q,
   maybeSingle:()=>{one=true;return q;},single:()=>{one=true;return q;},
   then:resolve=>{const rows=table==='workers'?[{id:id(1),user_id:id(1),role:h.role,is_active:h.active},...(tables.workers||[])]:tables[table]||[];
    let selected=mode==='insert'?[{...value,id:id(9)}]:rows.filter(r=>filters.every(f=>f(r)));
    if(range)selected=selected.slice(range[0],range[1]+1);
    return Promise.resolve({data:one?selected[0]||null:selected,error:h.failedTable===table?{message:'Temporary read failure'}:null}).then(resolve);}};return q;
 },rpc:async(name,{p_payload,p_user})=>{h.rpcCalls.push({name,payload:p_payload,user:p_user});
  if(name==='tc_register_call_recovery')return {data:h.rpcError?null:{rendimiento:{id:id(6)},payment:{id:id(3)},recovery:{xp_event:{id:id(10),worker_id:id(1),xp_amount:75},mission:{recovered:1}},duplicate_prevented:true},error:h.rpcError};
  if(name==='tc_register_call_minutes')return {data:h.rpcError?null:h.rpcResult||{rendimiento:{id:id(6)},payment:null,existing_payment_id:id(3),payment_linked:true,duplicate_prevented:true},error:h.rpcError};
  return {data:{status:'pending'},error:null};
 }};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/crm/rendimiento/registrar/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,console:{error:()=>{}},process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test'}},require:n=>({
  'next/server':{NextResponse:{json:(x,o)=>new Response(JSON.stringify(x),o)}},
  '@supabase/supabase-js':{createClient:()=>admin},
  '@/lib/purchase-benefit-summary':benefitSummary,
  '@/lib/server/auth-fast':{},'@/lib/server/client-promotions':{loadActivePromotion:async()=>{h.promotionReads++;return h.promotion||null;},promotionPackageSnapshot:(promotion,pack)=>({...pack,promotion_id:promotion.id,promotion_name:promotion.name,package_id:pack.id,package_name:pack.name})},
  '@/lib/server/paypal-crm':{paypalConfig:()=>({environment:'sandbox'})},
  '@/lib/server/new-tarotista-gift':{newTarotistaGiftPreview:async()=>({offers:[]}),handleNewTarotistaGiftCall:()=>{throw Error('Unexpected introduction gift');}},
  '@/lib/server/initial-consultation-gift':{initialConsultationGiftPreview:async()=>({policy_key:'initial_consultation_once_v1',eligible:false,minutes:7,reason:'PRIOR_CONSULTATION'}),handleInitialConsultationGiftCall:()=>{throw Error('Unexpected initial gift');}},
  '@/lib/server/cliente-minute-packs':{CLIENTE_MINUTE_PACKS:[{id:'pack_80',nombre:'80 minutos',priceUsd:49,oracleCredits:1},{id:'pack_120',nombre:'120 minutos',priceUsd:69,oracleCredits:2},{id:'pack_180',nombre:'180 minutos',priceUsd:99,oracleCredits:3}]},
  '@/lib/ruleta':{rouletteLevelForPurchaseAmount:amount=>amount>0&&amount<27?1:amount>=27&&amount<37?2:amount>=49&&amount<=99?3:null},
 }[n]||(()=>{throw Error(n)})())});
 h.api=exports;h.tables=tables;h.body={minute_accounting_version:2,cliente_id:id(2),operation_id:id(7),existing_payment_id:id(3),cliente_compra_minutos:false,uso_tipo:'minutos',codigo_1:'CLIENTE',minutos_1:20};
 h.post=(body=h.body,token='good')=>exports.POST(new Request('https://panel.test/api',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}));
 h.get=()=>exports.GET(new Request('https://panel.test/api?mode=payments&cliente_id='+id(2),{headers:{authorization:'Bearer good'}}));return h;
}
test('Only active admin/central can read candidates or register calls',async()=>{
 const h=harness();assert.equal((await h.post(h.body,'bad')).status,401);
 h.role='tarotista';assert.equal((await h.post()).status,403);assert.equal((await h.get()).status,403);
 h.role='central';h.active=false;assert.equal((await h.get()).status,401);assert.equal(h.rpcCalls.length,0);
});

test('Team CALL validates worker identity and keeps CALL tariff metadata in the atomic payload',async()=>{
 const h=harness();h.tables.workers=[{id:id(8),display_name:'Josefa',role:'tarotista',is_active:true}];
 const response=await h.post({...h.body,existing_payment_id:null,tarotista_worker_id:id(8),tarotista_manual_call:'Josefa CALL'});
 assert.equal(response.status,200);assert.equal(h.rpcCalls.filter(call=>call.name==='tc_register_call_minutes').length,1);
 const payload=h.rpcCalls[0].payload;
 assert.equal(payload.tarotista_worker_id,id(8));assert.equal(payload.tarotista_nombre,'Josefa');
 assert.equal(payload.tarotista_manual_call,'Josefa CALL');assert.equal(payload.llamada_call,true);
 assert.equal(payload.tiempo,20);assert.equal(payload.codigo_1,'CLIENTE');assert.equal(payload.minutos_1,20);
 assert.equal(payload.operation_id,id(7));
});

test('Team CALL cannot target an inactive, missing or non-tarotista worker even with a manual fallback name',async()=>{
 for(const candidate of [null,{role:'tarotista',is_active:false},{role:'central',is_active:true},{role:'admin',is_active:true}]) {
  const h=harness();h.tables.workers=candidate?[{id:id(8),display_name:'Fixture',...candidate}]:[];
  const response=await h.post({...h.body,existing_payment_id:null,tarotista_worker_id:id(8),tarotista_manual_call:'Fixture CALL'});
  assert.equal(response.status,400);assert.equal((await response.json()).error,'TAROTISTA_INACTIVA');assert.equal(h.rpcCalls.length,0);
 }
});

test('Legacy manual CALL without a worker remains accepted without assigning by name',async()=>{
 const h=harness();h.tables.workers=[{id:id(8),display_name:'Josefa',role:'tarotista',is_active:true}];
 const response=await h.post({...h.body,existing_payment_id:null,tarotista_manual_call:'Josefa call'});
 assert.equal(response.status,200);assert.equal(h.rpcCalls.filter(call=>call.name==='tc_register_call_minutes').length,1);
 const payload=h.rpcCalls[0].payload;
 assert.equal(payload.tarotista_worker_id,null);assert.equal(payload.tarotista_nombre,'Josefa call');
 assert.equal(payload.llamada_call,true);assert.equal(payload.tiempo,20);
});
test('Old listing and payment selection are disabled before mutation',async()=>{
 const h=harness();assert.equal((await h.get()).status,410);
 assert.equal((await h.post()).status,409);assert.equal(h.rpcCalls.length,0);
});

test('Balance endpoint reads authoritative split and prevents caching',async()=>{
 const h=harness();h.tables.crm_clientes[0].minutos_free_pendientes=10;h.tables.crm_clientes[0].minutos_normales_pendientes=10;
 const r=await h.api.GET(new Request('https://panel.test/api?mode=balance&cliente_id='+id(2),{headers:{authorization:'Bearer good'}}));
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/(?:^|,\s*)no-store(?:,|$)/);
 assert.deepEqual((await r.json()).balance.minutos_free_pendientes,10);
});
test('Rejected consumption returns refreshed split without a second RPC',async()=>{
 const h=harness();h.tables.crm_clientes[0].minutos_free_pendientes=10;h.tables.crm_clientes[0].minutos_normales_pendientes=10;
 h.rpcError={code:'P0001',message:'INSUFFICIENT_FREE_MINUTES'};
 const r=await h.post({...h.body,existing_payment_id:null});const j=await r.json();assert.equal(r.status,409);
 assert.equal(j.balance.minutos_free_pendientes,10);assert.equal(j.balance.minutos_normales_pendientes,10);assert.equal(h.rpcCalls.length,1);
});


test('Recuperado requires confirmed purchase and uses verified identity in atomic recovery wrapper',async()=>{
 const h=harness();const body={...h.body,existing_payment_id:null,clasificacion:'recuperado'};
 let r=await h.post(body);assert.equal(r.status,409);assert.equal((await r.json()).error,'RECOVERY_REQUIRES_PURCHASE');assert.equal(h.rpcCalls.length,0);
 h.tables.crm_cliente_pagos[0].referencia_externa='registrar_llamada:'+id(7);
 r=await h.post({...body,cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'TPV',user_id:id(99)});
 const j=await r.json();assert.equal(r.status,200);assert.equal(h.rpcCalls[0].name,'tc_register_call_recovery');assert.equal(h.rpcCalls[0].user,id(1));
 assert.equal(j.recovery.mission.recovered,1);assert.equal(j.xp_event.xp_amount,75);assert.equal(j.duplicate_prevented,true);
});
test('Recovery validation failure is visible as conflict; no capture side effect runs',async()=>{
 const h=harness();h.rpcError={code:'P0001',message:'CONTACT_FIRST'};
 const r=await h.post({...h.body,existing_payment_id:null,clasificacion:'recuperado',cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'TPV'});
 assert.equal(r.status,409);assert.equal((await r.json()).error,'CONTACT_FIRST');assert.equal(h.rpcCalls.length,1);
});

test('committed purchase response reports earned Coins and wheel from persisted evidence, retaining success on receipt-read failure',async()=>{
 const h=harness();
 h.rpcResult={rendimiento:{id:id(6)},payment:{id:id(3),cliente_id:id(2),source_rendimiento_id:id(6),benefits_processed_at:'2026-11-05T12:00:00Z',benefits_context:{purchase_classification:'nada',coins:999}}};
 h.tables.cliente_puntos_historial=[{cliente_id:id(2),tipo:'ganado',puntos:300,meta:{payment_id:id(3)},saldo_despues:930}];
 h.tables.tc_client_benefit_events=[{cliente_id:id(2),payment_id:id(3),benefit_key:'purchase_processed',coins:0},{cliente_id:id(2),payment_id:id(3),benefit_key:'rank_package:2',coins:300}];
 h.tables.cliente_ruleta_giros=[{id:id(20),cliente_id:id(2),purchase_id:id(3),nivel:2,estado:'used'}];
 const body={...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:35,forma_pago:'TPV',clasificacion:'nada'};
 let response=await h.post(body),j=await response.json();assert.equal(response.status,200);assert.equal(j.rewards.coins,300);assert.equal(j.purchase_benefits_summary.coins,300);
 assert.match(j.message,/\+300 Coins.*Ruleta nivel 2/);assert.doesNotMatch(j.message,/999/);
 h.failedTable='cliente_puntos_historial';response=await h.post(body);j=await response.json();assert.equal(response.status,200);assert.equal(j.ok,true);
 assert.equal(j.rewards,null);assert.equal(j.purchase_benefits_summary.coins,null);assert.match(j.message,/Coins pendientes de comprobar.*Ruleta nivel 2/);
});

test('Regular, captured and recovered purchases do not inherit an unrelated active promo by amount',async()=>{
 for(const clasificacion of ['nada','captado','recuperado']) {
  const h=harness();h.promotion={id:id(40),packages:[{id:id(41),price:22,currency:'EUR',coins:999,roulette_spins:5,oracle_credits:7}]};
  const response=await h.post({...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'TPV',clasificacion});
  assert.equal(response.status,200);const payload=h.rpcCalls[0].payload;
  assert.equal(h.promotionReads,0);assert.equal(payload.points_to_add,0);assert.equal(payload.purchase_benefits.source,'regular_tariff');
  assert.equal(payload.pricing_mode,'regular');assert.equal(payload.purchase_classification,clasificacion);assert.equal(payload.rewards_eligible,true);
  assert.equal(payload.purchase_benefits.roulette_level,1);assert.equal(payload.purchase_benefits.roulette_spins,1);
 }
});
test('Promo classification suppresses Coins and spins while retaining configured Oracle',async()=>{
 const h=harness();h.promotion={id:id(40),name:'Promo',packages:[{id:id(41),name:'Promo',price:22,currency:'EUR',coins:999,roulette_spins:5,roulette_level:2,oracle_credits:2}]};
 const response=await h.post({...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'TPV',clasificacion:'promo',points_to_add:999,rewards_eligible:true});
 assert.equal(response.status,200);const payload=h.rpcCalls[0].payload;assert.equal(payload.points_to_add,0);assert.equal(payload.rewards_eligible,false);
 assert.equal(payload.purchase_benefits.coins,0);assert.equal(payload.purchase_benefits.roulette_spins,0);assert.equal(payload.purchase_benefits.roulette_level,null);assert.equal(payload.purchase_benefits.oracle_credits,2);
});
test('PayPal selection is explicit and forwarded for atomic verification, never inferred by amount',async()=>{
 const h=harness(),body={...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'PAYPAL',clasificacion:'nada'};
 for(const fields of [{paypal_collection_source:'crm_collection'},{paypal_collection_source:'external',paypal_collection_order_id:id(50)},{paypal_collection_source:'invented'},{paypal_collection_order_id:'invalid'}])
  assert.equal((await h.post({...body,...fields})).status,400);
 assert.equal(h.rpcCalls.length,0);
 assert.equal((await h.post({...body,paypal_collection_source:'crm_collection',paypal_collection_order_id:id(50),expected_paypal_environment:'live'})).status,200);
 assert.equal(h.rpcCalls[0].payload.paypal_collection_order_id,id(50));assert.equal(h.rpcCalls[0].payload.paypal_collection_source,'crm_collection');
 assert.equal(h.rpcCalls[0].payload.expected_paypal_environment,'sandbox');
});
test('Selection conflicts are reported without hiding a database refusal',async()=>{
 const h=harness();h.rpcError={code:'P0001',message:'PAYPAL_COLLECTION_SELECTION_REQUIRED'};
 const response=await h.post({...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'PAYPAL'});
 assert.equal(response.status,409);assert.equal((await response.json()).error,'PAYPAL_COLLECTION_SELECTION_REQUIRED');
});
test('External selection and a generic browser boolean cannot bypass the exact web-payment confirmation',async()=>{
 const h=harness();const response=await h.post({...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'PAYPAL',paypal_collection_source:'external',separate_payment_confirmed:true});
 assert.equal(response.status,200);assert.equal(h.rpcCalls[0].payload.separate_payment_confirmed,undefined);assert.equal(h.rpcCalls[0].payload.paypal_collection_order_id,null);
 assert.deepEqual(Array.from(h.rpcCalls[0].payload.confirmed_web_payment_ids),[]);
});

test('Web-payment acknowledgement validates UUIDs, requires external PayPal, and forwards the canonical exact set',async()=>{
 const h=harness(),body={...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'PAYPAL',paypal_collection_source:'external'};
 for(const fields of [{confirmed_web_payment_ids:true},{confirmed_web_payment_ids:['invalid']},{confirmed_web_payment_ids:[id(3)],paypal_collection_source:''},{confirmed_web_payment_ids:[id(3)],cliente_compra_minutos:false},{confirmed_web_payment_ids:[id(3)],forma_pago:'TPV'}]){
  assert.equal((await h.post({...body,...fields})).status,400);
 }
 assert.equal(h.rpcCalls.length,0);
 assert.equal((await h.post({...body,confirmed_web_payment_ids:[id(5),id(3),id(5)]})).status,200);
 assert.deepEqual(Array.from(h.rpcCalls[0].payload.confirmed_web_payment_ids),[id(3),id(5)]);
});

test('Missing or changed web-payment evidence is a conflict with no retry or secondary mutation',async()=>{
 for(const message of ['PAYPAL_WEB_PURCHASE_CONFIRMATION_REQUIRED','PAYPAL_WEB_PURCHASE_CONFIRMATION_CHANGED','PAYPAL_WEB_PURCHASE_CONFIRMATION_INVALID']){
  const h=harness();h.rpcError={code:'P0001',message};
  const response=await h.post({...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:22,forma_pago:'PAYPAL',paypal_collection_source:'external',confirmed_web_payment_ids:[id(3)]});
  assert.equal(response.status,409);assert.equal((await response.json()).error,message);assert.equal(h.rpcCalls.length,1);
 }
});

test('Credited web evidence is scoped to exact client, amount, environment and unlinked completed purchases',async()=>{
 const h=harness(),order={id:id(90),cliente_id:id(2),status:'completed',payment_id:id(3),pack_name:'20 minutos',amount:22,currency:'EUR',environment:'sandbox',checkout_kind:'client_purchase',order_id:'WEB90'};
 h.tables.crm_paypal_orders=[order,{...order,id:id(91),cliente_id:id(4)},{...order,id:id(92),amount:35},{...order,id:id(93),environment:'live'},{...order,id:id(94),checkout_kind:'crm_collection'},{...order,id:id(95),status:'pending'},{...order,id:id(96),currency:'USD'},
  {...order,id:id(97),payment_id:id(6)},{...order,id:id(98),payment_id:id(7)},{...order,id:id(99),payment_id:id(8)},{...order,id:id(100),payment_id:null},{...order,id:id(101),payment_id:id(9)},{...order,id:id(102),payment_id:id(10)}];
 h.tables.crm_cliente_pagos.push({id:id(6),cliente_id:id(2),importe:22,moneda:'EUR',estado:'completed',source_rendimiento_id:id(50)},{id:id(7),cliente_id:id(2),importe:22,moneda:'EUR',estado:'pending'},
  {id:id(8),cliente_id:id(2),importe:35,moneda:'EUR',estado:'completed'},{id:id(9),cliente_id:id(4),importe:22,moneda:'EUR',estado:'completed'},{id:id(10),cliente_id:id(2),importe:22,moneda:'USD',estado:'completed'});
 const get=amount=>h.api.GET(new Request('https://panel.test/api?mode=credited_web_purchases&cliente_id='+id(2)+'&amount='+amount,{headers:{authorization:'Bearer good'}}));
 const response=await get(22);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const purchases=(await response.json()).credited_web_purchases;assert.equal(purchases.length,1);assert.equal(purchases[0].payment_id,id(3));assert.equal(purchases[0].order_id,'WEB90');assert.equal(h.rpcCalls.length,0);
 for(const amount of ['NaN',0,-1,'22.001'])assert.equal((await get(amount)).status,400);
 h.failedTable='crm_cliente_pagos';assert.equal((await get(22)).status,500,'a failed read must not look like no matching web purchases');
});

test('Credited web evidence includes matches beyond the first page',async()=>{
 const h=harness();h.tables.crm_paypal_orders=[];h.tables.crm_cliente_pagos=[];
 for(let n=0;n<101;n++){
  h.tables.crm_paypal_orders.push({id:id(1000+n),cliente_id:id(2),status:'completed',payment_id:id(2000+n),amount:22,currency:'EUR',environment:'sandbox',checkout_kind:'client_purchase'});
  h.tables.crm_cliente_pagos.push({id:id(2000+n),cliente_id:id(2),estado:'completed',source_rendimiento_id:null,importe:22,moneda:'EUR'});
 }
 const response=await h.api.GET(new Request('https://panel.test/api?mode=credited_web_purchases&cliente_id='+id(2)+'&amount=22',{headers:{authorization:'Bearer good'}}));
 assert.equal(response.status,200);assert.equal((await response.json()).credited_web_purchases.length,101);
});
test('Exact normal package prices preserve native Oracle before the database adds rank benefits',async()=>{
 for(const [amount,oracle] of [[49,1],[69,2],[99,3]]) {
  const h=harness();const response=await h.post({...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:amount,forma_pago:'TPV',clasificacion:'nada'});
  assert.equal(response.status,200);assert.equal(h.rpcCalls[0].payload.purchase_benefits.oracle_credits,oracle);assert.equal(h.promotionReads,0);
 }
});
test('Collection candidates exclude other clients, unconfirmed, consumed and self-service payments',async()=>{
 const h=harness(),eligible={id:id(60),cliente_id:id(2),status:'completed',capture_id:'CAP60',payment_id:null,pack_id:'crm_manual_amount',pack_name:'Importe personalizado',amount:'22.00',currency:'EUR',environment:'sandbox',checkout_kind:'crm_collection',order_id:'ORDER60'};
 h.tables.crm_paypal_orders=[eligible,{...eligible,id:id(61),cliente_id:id(4)},{...eligible,id:id(62),status:'pending'},{...eligible,id:id(63),capture_id:null},{...eligible,id:id(64),payment_id:id(80)},{...eligible,id:id(65),checkout_kind:'client_purchase'},{...eligible,id:id(66),environment:'live'},{...eligible,id:id(67),currency:'USD'}];
 const response=await h.api.GET(new Request('https://panel.test/api?mode=collections&cliente_id='+id(2),{headers:{authorization:'Bearer good'}}));
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const collections=(await response.json()).collections;assert.equal(collections.length,1);assert.equal(collections[0].id,id(60));assert.equal(collections[0].pricing_mode,'manual_amount');assert.equal(collections[0].amount,22);
});

test('Diamond classification forwards the choice to atomic server validation for Admin and Central',async()=>{
 for(const role of ['admin','central']){
  const h=harness();h.role=role;
  const result=await h.post({...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:35,forma_pago:'TPV',clasificacion:'ruleta_diamante',coins:999,roulette_level:1});
  assert.equal(result.status,200);
  const payload=h.rpcCalls[0].payload;assert.equal(payload.purchase_classification,'ruleta_diamante');assert.equal(payload.pricing_mode,'regular');
  assert.equal(payload.points_to_add,0);assert.equal(payload.super_promo_ruleta,false);assert.equal(payload.promo,false);
  const capture=h.rpcCalls.find(c=>c.name==='register_client_capture_contact');if(capture)assert.equal(capture.payload,undefined);
 }
});
test('Diamond eligibility conflicts are visible and no capture runs after a rejected atomic purchase',async()=>{
 for(const message of ['DIAMOND_ROULETTE_REQUIRES_DIAMOND','DIAMOND_ROULETTE_REQUIRES_REGULAR_PURCHASE']){
  const h=harness();h.rpcError={code:'P0001',message};
  const response=await h.post({...h.body,existing_payment_id:null,cliente_compra_minutos:true,minute_accounting_version:3,importe:35,forma_pago:'TPV',clasificacion:'ruleta_diamante'});
  assert.equal(response.status,409);assert.equal((await response.json()).error,message);assert.equal(h.rpcCalls.length,1);
 }
 const h=harness();const response=await h.post({...h.body,existing_payment_id:null,clasificacion:'ruleta_diamante'});
 assert.equal(response.status,400);assert.equal(h.rpcCalls.length,0);
});
