const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const ref='00000000-0000-4000-8000-000000000099';
function harness(){
 const row={id:'attempt',public_token:ref,order_id:'ORDER1',environment:'live',status:'pending',remote_status:'CREATED',
 amount:22,currency:'EUR',pack_name:'20 minutos',created_at:new Date().toISOString(),create_payload:{payment_source:{card:{}}}};
 const calls=[];let remoteStatus='CREATED';
 const order=()=>({id:row.order_id,status:remoteStatus});
 const admin={from:()=>{const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},
 maybeSingle:async()=>({data:filters.every(([k,v])=>row[k]===v)?row:null})};return q;}};
 class PayPalError extends Error{constructor(m,status){super(m);this.status=status;}}
 const helpers={PAYPAL_TABLE:'crm_paypal_orders',PayPalError,paypalConfig:()=>({environment:'live',origin:'https://panel.test',client:'PUBLIC_CLIENT_ID',secret:'NEVER_RETURN'}),
 paypalAdmin:()=>admin,reconcilePayPal:async(_,a,capture)=>{calls.push(['reconcile',capture]);return a;},
 validateOrder:(a,o)=>{assert.equal(a.order_id,o.id);},
 paypalRequest:async url=>{calls.push(['request',url]);return url.includes('generate-token')?{client_token:'CLIENT_TOKEN'}:order();}};
 class NR extends Response{static json(data,options){return new NR(JSON.stringify(data),options);}}
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/paypal-crm/card/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Date,require:n=>n==='next/server'?{NextResponse:NR}:helpers});
 return {row,calls,helpers,setRemote:s=>remoteStatus=s,post:(action='session',extra={},origin='https://panel.test')=>exports.POST(new Request('https://panel.test/api/paypal-crm/card',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({ref,action,...extra})}))};
}
test('Card link requires an exact public token, matching environment and origin',async()=>{
 const h=harness();assert.equal((await h.post('session',{},'https://evil.test')).status,403);
 assert.equal((await h.post('session',{ref:'bad'})).status,400);
 assert.equal((await h.post('session',{ref:'00000000-0000-4000-8000-000000000098'})).status,404);
 h.row.environment='sandbox';assert.equal((await h.post()).status,404);assert.equal(h.calls.length,0);
});
test('Session returns only checkout metadata and client token; does not capture',async()=>{
 const h=harness(),r=await h.post(),data=await r.json();assert.equal(r.status,200);assert.equal(data.amount,22);
 assert.equal(data.client_id,'PUBLIC_CLIENT_ID');assert.equal(data.client_token,'CLIENT_TOKEN');assert.equal(data.can_pay,true);
 assert.equal(data.public_token,undefined);assert.equal(data.secret,undefined);assert.equal(data.create_payload,undefined);
 assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(h.calls[0],['reconcile',false]);
});
test('Browser cannot substitute amount, benefits or order ID',async()=>{
 const h=harness(),data=await(await h.post('order',{order_id:'ATTACK',amount:.01,cliente_id:'OTHER'})).json();
 assert.equal(data.order_id,'ORDER1');assert.ok(h.calls.some(c=>c[1]==='/v2/checkout/orders/ORDER1'));assert.equal(h.row.amount,22);
});
test('Paid, cancelled, approved and pending captures never reopen card fields',async()=>{
 for(const [status,remote] of [['completed','COMPLETED'],['cancelled','VOIDED'],['pending','APPROVED'],['pending','CAPTURE_PENDING'],['pending','CAPTURE_COMPLETED']]){
 const h=harness();h.row.status=status;h.row.remote_status=remote;const d=await(await h.post()).json();assert.equal(d.can_pay,false);assert.equal(d.client_token,undefined);assert.equal(h.calls.length,1);}
});
test('Remote race and expired order do not offer a payable order ID',async()=>{
 const h=harness();h.setRemote('APPROVED');assert.equal((await(await h.post('order')).json()).order_id,undefined);
 h.setRemote('CREATED');h.row.created_at=new Date(Date.now()-4*3600000).toISOString();assert.equal((await h.post('order')).status,410);
});
test('Wallet links cannot be used for card sessions',async()=>{const h=harness();h.row.create_payload={payment_source:{paypal:{}}};assert.equal((await h.post()).status,404);});
test('Only explicit capture asks reconciliation to capture; errors do not expose credentials',async()=>{
 const h=harness();await h.post('capture');assert.deepEqual(h.calls[0],['reconcile',true]);
 h.helpers.reconcilePayPal=async()=>{throw Error('NEVER_RETURN');};const r=await h.post();assert.equal(r.status,503);assert.ok(!(await r.text()).includes('NEVER_RETURN'));
});
test('Server applies 3DS results to card orders; legacy wallet orders remain compatible',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/server/paypal-crm.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({})});
 const check=result=>exports.validateCardAuthentication({create_payload:{payment_source:{card:{}}}},{payment_source:{card:{authentication_result:result}}});
 check(undefined);check({liability_shift:'POSSIBLE',three_d_secure:{enrollment_status:'Y',authentication_status:'Y'}});
 check({liability_shift:'POSSIBLE',three_d_secure:{enrollment_status:'Y',authentication_status:'A'}});
 for(const enrollment_status of ['N','U','B'])check({liability_shift:'NO',three_d_secure:{enrollment_status}});
 for(const authentication_status of ['N','R','U','C','D'])assert.throws(()=>check({liability_shift:'NO',three_d_secure:{enrollment_status:'Y',authentication_status}}));
 assert.throws(()=>check({liability_shift:'UNKNOWN'}));assert.throws(()=>exports.validateCardAuthentication({create_payload:{payment_source:{card:{}}}},{}));
 exports.validateCardAuthentication({},{});
});
