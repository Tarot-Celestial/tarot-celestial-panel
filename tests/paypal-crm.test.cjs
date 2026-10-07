const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(file,overrides={},extras={}){
 const exports={};const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:n=>overrides[n]||require(n),URL,Buffer,AbortSignal,console,Date,process:{env:{PAYPAL_ENVIRONMENT:'sandbox',PAYPAL_CLIENT_ID:'test',PAYPAL_CLIENT_SECRET:'test-secret',PAYPAL_WEBHOOK_ID:'WH',PAYPAL_PUBLIC_BASE_URL:'https://panel.test'}},...extras});return exports;
}
const attempt={id:'00000000-0000-4000-8000-000000000010',order_id:'ORDER10',environment:'sandbox',amount:22,currency:'EUR',status:'pending'};
function order(status='CREATED',captureStatus){return {id:'ORDER10',intent:'CAPTURE',status,purchase_units:[{custom_id:attempt.id,invoice_id:'TC-'+attempt.id,amount:{currency_code:'EUR',value:'22.00'},...(captureStatus?{payments:{captures:[{id:'CAP10',status:captureStatus,amount:{currency_code:'EUR',value:'22.00'}}]}}:{})}]};}
function harness(remoteOrder,options={}){
 let calls=[],credits=0,state={...attempt};
 const fetch=async(url,init)=>{
  calls.push([url,init]);if(url.endsWith('/token'))return {ok:true,json:async()=>({access_token:'test'})};
  if(url.endsWith('/capture')){remoteOrder=order('COMPLETED',options.pending?'PENDING':'COMPLETED');if(options.timeout)throw Error('timeout');}
  return {ok:true,json:async()=>remoteOrder};
 };
 const admin={rpc:async()=>{credits++;state={...state,status:'completed'};return {error:null};},from:()=>{
  let patch,filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v,true]);return q;},neq:(k,v)=>{filters.push([k,v,false]);return q;},update:p=>{patch=p;return q;},single:async()=>({data:state}),then:resolve=>{if(patch&&filters.every(([k,v,e])=>e?state[k]===v:state[k]!==v))state={...state,...patch};return Promise.resolve({error:null}).then(resolve);}};return q;
 }};
 const api=load('src/lib/server/paypal-crm.ts',{'@supabase/supabase-js':{}},{fetch});return {api,admin,calls,credits:()=>credits,state:()=>state};
}
test('Unapproved order stays pending, no capture or benefits',async()=>{
 const h=harness(order());await h.api.reconcilePayPal(h.admin,attempt);assert.equal(h.credits(),0);assert.ok(!h.calls.some(([url])=>url.endsWith('/capture')));
});
test('Approval causes capture, but benefits require capture COMPLETED',async()=>{
 for(const pending of [true,false]){const h=harness(order('APPROVED'),{pending});await h.api.reconcilePayPal(h.admin,attempt);assert.equal(h.credits(),pending?0:1);
 const req=h.calls.find(([url])=>url.endsWith('/capture'))[1];assert.equal(req.headers['PayPal-Request-Id'],'capture-'+attempt.id);}
});
test('Timeout after provider captured recovers without another payment',async()=>{
 const h=harness(order('APPROVED'),{timeout:true});await h.api.reconcilePayPal(h.admin,attempt);assert.equal(h.credits(),1);assert.equal(h.calls.filter(([url])=>url.endsWith('/capture')).length,1);
});
test('Cancel-return does not capture approved order or fake a completed payment',async()=>{
 const h=harness(order('APPROVED'));await h.api.reconcilePayPal(h.admin,attempt,false);assert.equal(h.credits(),0);
});
test('Invalid invoice, client attempt, currency, amount or capture are rejected',async()=>{
 for(const mutate of [o=>o.id='OTHER',o=>o.purchase_units[0].custom_id='OTHER',o=>o.purchase_units[0].amount.value='1.00',o=>o.purchase_units[0].amount.currency_code='USD',o=>o.purchase_units[0].payments.captures[0].amount.value='2.00']){
  const remote=order('COMPLETED','COMPLETED');mutate(remote);const h=harness(remote);await assert.rejects(h.api.reconcilePayPal(h.admin,attempt));assert.equal(h.credits(),0);
 }
});
test('No cross-environment processing',async()=>{
 const h=harness(order());await assert.rejects(h.api.reconcilePayPal(h.admin,{...attempt,environment:'live'}));assert.equal(h.calls.length,0);
});
test('Fake webhook or absent signatures cannot confirm payment',async()=>{
 const h=harness({verification_status:'FAILURE'});
 assert.equal(await h.api.verifyPayPalWebhook(new Request('https://panel.test'),{}),false);assert.equal(h.calls.length,0);
 const headers=Object.fromEntries(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].map(k=>['paypal-'+k,'test']));
 assert.equal(await h.api.verifyPayPalWebhook(new Request('https://panel.test',{headers}),{}),false);
});
test('Reject non-PayPal approval links',()=>{
 const h=harness(order());assert.throws(()=>h.api.approvalUrl({links:[{rel:'approve',href:'https://evil.test'}]}));
 assert.equal(h.api.approvalUrl({links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token=ORDER'}]}),'https://www.sandbox.paypal.com/checkoutnow?token=ORDER');
});
module.exports={load};

