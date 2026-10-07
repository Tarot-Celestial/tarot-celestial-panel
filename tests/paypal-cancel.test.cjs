const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function harness(){
 const row={id:'A',order_id:'ORDER',status:'pending',remote_status:'APPROVED',environment:'sandbox',amount:12,currency:'EUR',create_payload:{payment_source:{card:{}}},last_error:null};
 const order={id:'ORDER',status:'APPROVED',intent:'CAPTURE',payment_source:{card:{}},purchase_units:[{custom_id:'A',invoice_id:'TC-A',amount:{currency_code:'EUR',value:'12.00'}}]};
 let captures=0,credits=0,holdCapture=null,captureError=null;
 const admin={rpc:async()=>{credits++;row.status='completed';row.remote_status='CAPTURE_COMPLETED';return {error:null};},from:()=>{
  const filters=[];let patch;const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},neq:(k,v)=>{filters.push(r=>r[k]!==v);return q;},update:p=>{patch=p;return q;},single:()=>q,maybeSingle:()=>q,
  then:resolve=>{const match=filters.every(f=>f(row));if(match&&patch)Object.assign(row,patch);return Promise.resolve({data:match?{...row}:null,error:null}).then(resolve)}};return q;}};
 const fetch=async(url)=>{
  if(url.endsWith('/token'))return {ok:true,json:async()=>({access_token:'token'})};
  if(url.endsWith('/capture')){captures++;if(holdCapture)await holdCapture;if(captureError)return {ok:false,status:422,json:async()=>captureError};order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:'CAP',status:'COMPLETED',amount:{currency_code:'EUR',value:'12.00'}}]};}
  return {ok:true,json:async()=>structuredClone(order)};
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/server/paypal-crm.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:()=>({}),fetch,URL,Date,Buffer,AbortSignal,process:{env:{PAYPAL_ENVIRONMENT:'sandbox',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_WEBHOOK_ID:'WH',PAYPAL_PUBLIC_BASE_URL:'https://panel.test'}}});
 return {api:exports,admin,row,order,captures:()=>captures,credits:()=>credits,hold:p=>holdCapture=p,fail:v=>captureError=v};
}
test('Cancellation disables an unpaid approved order without capture; stale callbacks cannot capture it',async()=>{
 const h=harness(),stale={...h.row};await h.api.cancelPayPalLink(h.admin,{...h.row});assert.equal(h.row.remote_status,'CANCELLED_BY_STAFF');assert.equal(h.captures(),0);
 await h.api.reconcilePayPal(h.admin,stale);await h.api.reconcilePayPal(h.admin,{...h.row});assert.equal(h.captures(),0);assert.equal(h.row.status,'cancelled');
});
test('Capture wins the atomic claim: cancellation and a stale poll cannot clear it',async()=>{
 const h=harness(),stale={...h.row};let release;h.hold(new Promise(r=>release=r));const running=h.api.reconcilePayPal(h.admin,{...h.row});
 while(h.captures()===0)await new Promise(r=>setImmediate(r));assert.equal(h.row.remote_status,'CAPTURE_REQUESTED');
 await h.api.reconcilePayPal(h.admin,stale,false);assert.equal(h.row.remote_status,'CAPTURE_REQUESTED');
 await assert.rejects(h.api.cancelPayPalLink(h.admin,{...h.row}),/procesándose/);release();await running;assert.equal(h.row.status,'completed');assert.equal(h.captures(),1);
});
test('Pending capture and completed money cannot be cancelled',async()=>{
 for(const state of ['PENDING','COMPLETED']){const h=harness();h.order.status='COMPLETED';h.order.purchase_units[0].payments={captures:[{id:'CAP',status:state,amount:{currency_code:'EUR',value:'12.00'}}]};await assert.rejects(h.api.cancelPayPalLink(h.admin,{...h.row}));assert.notEqual(h.row.remote_status,'CANCELLED_BY_STAFF');}
});
test('A declined capture persists the documented insufficient-funds reason across polls',async()=>{
 const h=harness();h.order.status='COMPLETED';h.order.purchase_units[0].payments={captures:[{id:'CAP',status:'DECLINED',processor_response:{response_code:'5120'}}]};
 await h.api.reconcilePayPal(h.admin,{...h.row});assert.equal(h.row.status,'cancelled');assert.match(h.row.last_error,/Saldo insuficiente/);
 await h.api.reconcilePayPal(h.admin,{...h.row},false);assert.match(h.row.last_error,/5120/);assert.equal(h.credits(),0);
});
test('Known API refusal is persisted, no invented balance explanation and no later automatic capture',async()=>{
 const h=harness();h.fail({details:[{issue:'INSTRUMENT_DECLINED',description:'Sensitive untrusted description'}]});
 await assert.rejects(h.api.reconcilePayPal(h.admin,{...h.row}),/no ha facilitado/);assert.equal(h.row.status,'cancelled');assert.ok(!h.row.last_error.includes('Sensitive'));assert.ok(!h.row.last_error.includes('Saldo'));
 await h.api.reconcilePayPal(h.admin,{...h.row});assert.equal(h.captures(),1);
});
test('Unknown processor code is reported without guessing a reason or exposing provider descriptions',()=>{
 const h=harness();assert.match(h.api.paymentFailureReason({processor_response:{response_code:'ZZ99'},description:'PAN SECRET'}),/ZZ99/);
 assert.equal(h.api.paymentFailureReason({details:[{issue:'UNKNOWN',description:'SECRET'}]}),undefined);
 assert.equal(h.api.paymentFailureReason({processor_response:{response_code:'0000'}}),undefined);
 for(const [code,text] of [['5400','caducada'],['5110','CVV'],['5100','sin indicar']])assert.ok(h.api.paymentFailureReason({processor_response:{response_code:code}}).includes(text));
});
test('Late genuinely completed capture still records money instead of hiding it as cancelled',async()=>{
 const h=harness();await h.api.cancelPayPalLink(h.admin,{...h.row});h.order.status='COMPLETED';h.order.purchase_units[0].payments={captures:[{id:'CAP',status:'COMPLETED',amount:{currency_code:'EUR',value:'12.00'}}]};
 await h.api.reconcilePayPal(h.admin,{...h.row});assert.equal(h.row.status,'completed');assert.equal(h.credits(),1);
});
