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
  if(name==='tc_register_call_with_payment')return {data:h.rpcError?null:{rendimiento:{id:id(6)},payment:null,existing_payment_id:id(3),payment_linked:true,duplicate_prevented:true},error:h.rpcError};
  return {data:{status:'pending'},error:null};
 }};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/crm/rendimiento/registrar/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,console:{error:()=>{}},process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test'}},require:n=>({
  'next/server':{NextResponse:{json:(x,o)=>new Response(JSON.stringify(x),o)}},
  '@supabase/supabase-js':{createClient:()=>admin},
  '@/lib/server/auth-fast':{},'@/lib/server/client-promotions':{},
 }[n]||(()=>{throw Error(n)})())});
 h.api=exports;h.tables=tables;h.body={cliente_id:id(2),operation_id:id(7),existing_payment_id:id(3),cliente_compra_minutos:false,uso_tipo:'minutos',codigo_1:'CLIENTE',minutos_1:20};
 h.post=(body=h.body,token='good')=>exports.POST(new Request('https://panel.test/api',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}));
 h.get=()=>exports.GET(new Request('https://panel.test/api?mode=payments&cliente_id='+id(2),{headers:{authorization:'Bearer good'}}));return h;
}
test('Only active admin/central can read candidates or register calls',async()=>{
 const h=harness();assert.equal((await h.post(h.body,'bad')).status,401);
 h.role='tarotista';assert.equal((await h.post()).status,403);assert.equal((await h.get()).status,403);
 h.role='central';h.active=false;assert.equal((await h.get()).status,401);assert.equal(h.rpcCalls.length,0);
});
test('Candidates belong to requested client and exclude payments already linked to calls',async()=>{
 const h=harness();let r=await h.get();assert.equal(r.status,200);let j=await r.json();assert.equal(j.payments.length,1);assert.equal(j.payments[0].id,id(3));
 h.tables.crm_cliente_pagos[0].source_rendimiento_id=id(8);j=await(await h.get()).json();assert.equal(j.payments.length,0);
});
test('A linked call uses atomic adapter, no purchase benefits; retries reach adapter even with zero remaining balance',async()=>{
 const h=harness();const response=await h.post();assert.equal(response.status,200);const json=await response.json();assert.equal(json.payment,null);assert.equal(json.payment_linked,true);assert.equal(json.duplicate_prevented,true);
 const call=h.rpcCalls[0];assert.equal(call.name,'tc_register_call_with_payment');assert.equal(call.payload.existing_payment_id,id(3));assert.equal(call.payload.normal_delta,-20);assert.equal(call.payload.points_to_add,0);assert.equal(call.payload.purchase_benefits,null);
});
test('Malformed payment and attempts to combine existing payment with a new purchase fail before RPC',async()=>{
 const h=harness();assert.equal((await h.post({...h.body,existing_payment_id:'bad'})).status,400);
 assert.equal((await h.post({...h.body,cliente_compra_minutos:true})).status,400);assert.equal(h.rpcCalls.length,0);
});
test('Database duplicate/link/balance guards become actionable HTTP 409, not an invented successful payment',async()=>{
 for(const code of ['PAYPAL_PAYMENT_ALREADY_CONFIRMED','PAYMENT_ALREADY_LINKED','PAYMENT_OPERATION_CONFLICT','EXISTING_PAYMENT_INVALID','INSUFFICIENT_NORMAL_MINUTES']){
  const h=harness();h.rpcError={code:'P0001',message:code};const response=await h.post();assert.equal(response.status,409);assert.equal((await response.json()).error,code);
 }
});
