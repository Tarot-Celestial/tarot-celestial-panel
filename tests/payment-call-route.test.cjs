const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function harness(){
 const h={rpcCalls:[],role:'central',active:true,rpcError:null};
 const tables={crm_clientes:[{id:id(2),nombre:'Prueba',minutos_free_pendientes:0,minutos_normales_pendientes:0}],
  crm_paypal_orders:[{cliente_id:id(2),status:'completed',payment_id:id(3),pack_name:'20 minutos',completed_at:'2026-10-07T12:00:00Z'},
   {cliente_id:id(4),status:'completed',payment_id:id(5)}],
  crm_cliente_pagos:[{id:id(3),cliente_id:id(2),estado:'completed',source_rendimiento_id:null,importe:22},
   {id:id(5),cliente_id:id(4),estado:'completed',source_rendimiento_id:null,importe:22}]};
 const admin={auth:{getUser:async token=>({data:{user:token==='good'?{id:id(1)}:null}})},from:table=>{
  let filters=[],one=false,value,mode='read';const q={select:()=>q,order:()=>q,limit:()=>q,
   eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},is:(k,v)=>{filters.push(r=>(r[k]??null)===v);return q;},
   not:(k,op,v)=>{filters.push(r=>(r[k]??null)!==v);return q;},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},
   insert:v=>{mode='insert';value=v;return q;},upsert:v=>{mode='insert';value=v;return q;},delete:()=>q,
   maybeSingle:()=>{one=true;return q;},single:()=>{one=true;return q;},
   then:resolve=>{const rows=table==='workers'?[{id:id(1),user_id:id(1),role:h.role,is_active:h.active}]:tables[table]||[];
    const selected=mode==='insert'?[{...value,id:id(9)}]:rows.filter(r=>filters.every(f=>f(r)));
    return Promise.resolve({data:one?selected[0]||null:selected,error:null}).then(resolve);}};return q;
 },rpc:async(name,{p_payload})=>{h.rpcCalls.push({name,payload:p_payload});
  if(name==='tc_register_call_minutes')return {data:h.rpcError?null:{rendimiento:{id:id(6)},payment:null,existing_payment_id:id(3),payment_linked:true,duplicate_prevented:true},error:h.rpcError};
  return {data:{status:'pending'},error:null};
 }};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/crm/rendimiento/registrar/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,console:{error:()=>{}},process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test'}},require:n=>({
  'next/server':{NextResponse:{json:(x,o)=>new Response(JSON.stringify(x),o)}},
  '@supabase/supabase-js':{createClient:()=>admin},
  '@/lib/server/auth-fast':{},'@/lib/server/client-promotions':{},
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
test('Old listing and payment selection are disabled before mutation',async()=>{
 const h=harness();assert.equal((await h.get()).status,410);
 assert.equal((await h.post()).status,409);assert.equal(h.rpcCalls.length,0);
});

test('Balance endpoint reads authoritative split and prevents caching',async()=>{
 const h=harness();h.tables.crm_clientes[0].minutos_free_pendientes=10;h.tables.crm_clientes[0].minutos_normales_pendientes=10;
 const r=await h.api.GET(new Request('https://panel.test/api?mode=balance&cliente_id='+id(2),{headers:{authorization:'Bearer good'}}));
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual((await r.json()).balance.minutos_free_pendientes,10);
});
test('Rejected consumption returns refreshed split without a second RPC',async()=>{
 const h=harness();h.tables.crm_clientes[0].minutos_free_pendientes=10;h.tables.crm_clientes[0].minutos_normales_pendientes=10;
 h.rpcError={code:'P0001',message:'INSUFFICIENT_FREE_MINUTES'};
 const r=await h.post({...h.body,existing_payment_id:null});const j=await r.json();assert.equal(r.status,409);
 assert.equal(j.balance.minutos_free_pendientes,10);assert.equal(j.balance.minutos_normales_pendientes,10);assert.equal(h.rpcCalls.length,1);
});
