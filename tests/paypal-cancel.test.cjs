const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function harness(){
 const row={cliente_id:'C',worker_id:'W',checkout_kind:'crm_collection',id:'A',order_id:'ORDER',status:'pending',remote_status:'APPROVED',environment:'sandbox',amount:12,currency:'EUR',create_payload:{payment_source:{card:{}}},last_error:null};
 const order={id:'ORDER',status:'APPROVED',intent:'CAPTURE',payment_source:{card:{}},purchase_units:[{custom_id:'A',invoice_id:'TC-A',amount:{currency_code:'EUR',value:'12.00'}}]};
 let captures=0,credits=0,holdCapture=null,captureError=null,orderError=null,beforeCancel=null;
 const admin={rpc:async()=>{credits++;row.status='completed';row.remote_status='CAPTURE_COMPLETED';return {error:null};},from:()=>{
  const filters=[];let patch,one=false;const q={select:()=>q,is:(k,v)=>{filters.push(r=>(r[k]??null)===v);return q;},eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},neq:(k,v)=>{filters.push(r=>r[k]!==v);return q;},update:p=>{patch=p;return q;},single:()=>{one=true;return q;},maybeSingle:()=>{one=true;return q;},
  then:resolve=>{if(patch?.remote_status==='CANCELLED_BY_STAFF'&&beforeCancel)beforeCancel();const match=filters.every(f=>f(row));if(match&&patch)Object.assign(row,patch);return Promise.resolve({data:one?(match?{...row}:null):(match?[{...row}]:[]),error:null}).then(resolve)}};return q;}};
 const fetch=async(url)=>{
  if(url.endsWith('/token'))return {ok:true,json:async()=>({access_token:'token'})};
  if(url.endsWith('/capture')){captures++;if(holdCapture)await holdCapture;if(captureError)return {ok:false,status:422,json:async()=>captureError};order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:'CAP',status:'COMPLETED',amount:{currency_code:'EUR',value:'12.00'}}]};}
  if(orderError){if(orderError instanceof Error)throw orderError;return {ok:false,status:orderError.status,json:async()=>orderError.body};}
  return {ok:true,json:async()=>structuredClone(order)};
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/server/paypal-crm.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:()=>({}),fetch,URL,Date,Buffer,AbortSignal,process:{env:{PAYPAL_ENVIRONMENT:'sandbox',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_WEBHOOK_ID:'WH',PAYPAL_PUBLIC_BASE_URL:'https://panel.test'}}});
 return {api:exports,admin,row,order,captures:()=>captures,credits:()=>credits,hold:p=>holdCapture=p,fail:v=>captureError=v,missing:v=>orderError=v,race:f=>beforeCancel=f};
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

test('Missing PayPal order disables only the local link and reports the uncertainty',async()=>{
 for(const issue of ['INVALID_RESOURCE_ID','RESOURCE_NOT_FOUND']){
  const h=harness();h.missing({status:404,body:{name:'RESOURCE_NOT_FOUND',details:[{issue}]}});
  await h.api.cancelPayPalLink(h.admin,{...h.row});
  assert.equal(h.row.status,'cancelled');assert.equal(h.row.remote_status,'CANCELLED_BY_STAFF');
  assert.match(h.row.last_error,/no confirma/);assert.equal(h.captures(),0);assert.equal(h.credits(),0);
  await h.api.cancelPayPalLink(h.admin,{...h.row});
  const result=await h.api.reconcilePayPal(h.admin,{...h.row});
  assert.equal(result.status,'cancelled');
  h.missing(null);h.order.status='COMPLETED';h.order.purchase_units[0].payments={captures:[{id:'CAP',status:'COMPLETED',amount:{currency_code:'EUR',value:'12.00'}}]};
  await h.api.reconcilePayPal(h.admin,{...h.row});assert.equal(h.row.status,'completed');assert.equal(h.credits(),1);
 }
});
test('Missing resource never overrides capture markers or recorded payment identifiers, including stale input',async()=>{
 for(const patch of [{status:'completed'},{remote_status:'CAPTURE_REQUESTED'},{remote_status:'CAPTURE_PENDING'},{remote_status:'CAPTURE_COMPLETED'},{capture_id:'CAP'},{payment_id:'PAY'},{remote_status:'CREATING'}]){
  const h=harness(),stale={...h.row};Object.assign(h.row,patch);
  h.missing({status:404,body:{details:[{issue:'INVALID_RESOURCE_ID'}]}});
  await assert.rejects(h.api.cancelPayPalLink(h.admin,stale));
  assert.notEqual(h.row.status,'cancelled');assert.equal(h.captures(),0);
 }
});
test('Other provider errors and network failures never become successful cancellations',async()=>{
 for(const failure of [
  ...[401,403,422,500,503].map(status=>({status,body:{details:[{issue:'INVALID_RESOURCE_ID'}]}})),
  {status:404,body:{name:'UNKNOWN'}},{status:404,body:{details:[{issue:'INVALID_RESOURCE_ID!'}]}},
  new Error('Network timeout')
 ]){
  const h=harness();h.missing(failure);
  await assert.rejects(h.api.cancelPayPalLink(h.admin,{...h.row}));
  assert.equal(h.row.status,'pending');assert.equal(h.captures(),0);
 }
});
test('A capture claim racing the missing-order cancellation wins the database comparison',async()=>{
 const h=harness();h.missing({status:404,body:{details:[{issue:'INVALID_RESOURCE_ID'}]}});
 h.race(()=>h.row.remote_status='CAPTURE_REQUESTED');
 await assert.rejects(h.api.cancelPayPalLink(h.admin,{...h.row}),/estado cambió/);
 assert.equal(h.row.status,'pending');assert.equal(h.row.remote_status,'CAPTURE_REQUESTED');
});

test('Rate-limited card checkout can be disabled and cancellation is idempotent',async()=>{
 for(const failure of [{status:429,body:{name:'RATE_LIMIT_REACHED'}},{status:400,body:{name:'RATE_LIMIT_REACHED'}}]){
  const h=harness();h.missing(failure);
  await h.api.cancelPayPalLink(h.admin,{...h.row});
  assert.equal(h.row.status,'cancelled');assert.match(h.row.last_error,/limitado/);
  await h.api.cancelPayPalLink(h.admin,{...h.row});
  h.missing(null);await h.api.reconcilePayPal(h.admin,{...h.row});
  assert.equal(h.captures(),0);assert.equal(h.credits(),0);
 }
});

test('Rate limiting never cancels captured, unknown, or external wallet orders',async()=>{
 for(const patch of [{status:'completed'},{capture_id:'CAP'},{payment_id:'PAY'},
  ...['CAPTURE_REQUESTED','CAPTURE_PENDING','CAPTURE_COMPLETED','CREATING'].map(remote_status=>({remote_status})),
  {create_payload:{payment_source:{paypal:{}}}}]){
  const h=harness(),stale={...h.row};Object.assign(h.row,patch);
  h.missing({status:429,body:{name:'RATE_LIMIT_REACHED'}});
  await assert.rejects(h.api.cancelPayPalLink(h.admin,stale));assert.notEqual(h.row.status,'cancelled');
 }
});

test('Concurrent capture wins over rate-limited cancellation',async()=>{
 const h=harness();h.missing({status:429,body:{name:'RATE_LIMIT_REACHED'}});
 h.race(()=>h.row.remote_status='CAPTURE_REQUESTED');
 await assert.rejects(h.api.cancelPayPalLink(h.admin,{...h.row}),/estado cambió/);
 assert.equal(h.row.status,'pending');assert.equal(h.row.remote_status,'CAPTURE_REQUESTED');
});

const replacement=h=>h.api.preparePayPalCrmReplacement(h.admin,{clientId:'C',environment:'sandbox',workerId:'W',isAdmin:false});
test('Replacement preparation checks PayPal passively and leaves cancellation for the SQL transaction',async()=>{const h=harness();const plan=await replacement(h);assert.equal(plan.length,1);assert.equal(plan[0].order_id,'ORDER');assert.equal(h.row.status,'pending');assert.equal(h.captures(),0);assert.equal(h.credits(),0);});
test('Replacement ignores self-service purchases and rejects a different central',async()=>{const h=harness();h.row.checkout_kind='client_purchase';assert.equal((await replacement(h)).length,0);h.row.checkout_kind='crm_collection';h.row.worker_id='OTHER';await assert.rejects(replacement(h),/Otra central/);assert.equal(h.captures(),0);});
test('Replacement handles missing and rate-limited old card links without claiming they were refunded',async()=>{for(const status of [404,429]){const h=harness();h.missing({status,body:{details:[{issue:status===404?'RESOURCE_NOT_FOUND':'RATE_LIMIT_REACHED'}]}});const plan=await replacement(h);assert.equal(plan.length,1);assert.match(plan[0].note,/No es un reembolso/);assert.equal(h.row.status,'pending');assert.equal(h.captures(),0);delete h.row.create_payload.payment_source.card;await assert.rejects(replacement(h));}});
test('Replacement never skips uncertain captures or arbitrary provider failures',async()=>{for(const remote_status of ['CAPTURE_REQUESTED','CAPTURE_PENDING','CAPTURE_COMPLETED']){const h=harness();h.row.remote_status=remote_status;await assert.rejects(replacement(h),/procesándose/);assert.equal(h.captures(),0);}for(const error of [new Error('Network timeout'),{status:503,body:{name:'SERVICE_UNAVAILABLE'}}]){const h=harness();h.missing(error);await assert.rejects(replacement(h));assert.equal(h.row.status,'pending');}});
test('A remotely completed payment is reconciled rather than replaced',async()=>{const h=harness();h.order.status='COMPLETED';h.order.purchase_units[0].payments={captures:[{id:'CAP',status:'COMPLETED',amount:{currency_code:'EUR',value:'12.00'}}]};await assert.rejects(replacement(h),/procesándose/);assert.equal(h.row.status,'completed');assert.equal(h.captures(),0);});
test('Interrupted card creation can be safely disabled locally; unknown creation types cannot',async()=>{const h=harness();h.row.order_id=null;h.row.remote_status='CREATING';assert.equal((await replacement(h)).length,1);assert.equal(h.captures(),0);h.row.create_payload={};await assert.rejects(replacement(h));});

function legacyOrphan(h){Object.assign(h.row,{order_id:null,approval_url:null,remote_status:'CREATING',created_at:new Date(Date.now()-6*60*60*1000).toISOString(),create_payload:{intent:'CAPTURE',purchase_units:[{custom_id:'A',invoice_id:'TC-A'}],payment_source:{paypal:{}}}});}
test('Abandoned legacy creation without a reference or issued URL can be replaced and explicitly cancelled',async()=>{const h=harness();legacyOrphan(h);const plan=await replacement(h);assert.equal(plan.length,1);assert.match(plan[0].note,/incompleto/);await h.api.cancelPayPalLink(h.admin,{...h.row});assert.equal(h.row.status,'cancelled');assert.match(h.row.last_error,/nuevo enlace/);assert.equal(h.captures(),0);assert.equal(h.credits(),0);});
test('Recent, unidentified, issued or captured legacy creation never becomes an abandoned attempt',async()=>{for(const patch of [{created_at:new Date().toISOString()},{created_at:'unknown'},{approval_url:'https://fixture.invalid/pay'},{capture_id:'CAP'},{payment_id:'PAY'},{create_payload:{}},{remote_status:'CAPTURE_REQUESTED'}]){const h=harness();legacyOrphan(h);Object.assign(h.row,patch);await assert.rejects(replacement(h));await assert.rejects(h.api.cancelPayPalLink(h.admin,{...h.row}));assert.equal(h.row.status,'pending');assert.equal(h.captures(),0);}});
test('A reference arriving concurrently wins over cancellation of an unissued attempt',async()=>{const h=harness();legacyOrphan(h);h.race(()=>{h.row.order_id='ARRIVED';h.row.approval_url='https://fixture.invalid/new';});await assert.rejects(h.api.cancelPayPalLink(h.admin,{...h.row}),/estado cambió/);assert.equal(h.row.status,'pending');assert.equal(h.captures(),0);});
test('Explicit cancellation of an old wallet reference missing in PayPal remains possible with the uncertainty recorded',async()=>{const h=harness();h.row.create_payload={payment_source:{paypal:{}}};h.missing({status:404,body:{details:[{issue:'RESOURCE_NOT_FOUND'}]}});await h.api.cancelPayPalLink(h.admin,{...h.row});assert.equal(h.row.status,'cancelled');assert.match(h.row.last_error,/no confirma/);assert.equal(h.captures(),0);});
