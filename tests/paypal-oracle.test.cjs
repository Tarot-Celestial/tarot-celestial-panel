// All provider calls and balances below are fixtures. No live payment requests.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => '00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>name in mocks ? mocks[name] : require(name),URL,Request,Response,Headers,Buffer,AbortSignal,Date,console,...globals});return exports;
}
const roulette = load('src/lib/ruleta.ts');
const packs = load('src/lib/server/cliente-minute-packs.ts',{'@/lib/ruleta':roulette});
const oracle = load('src/lib/server/oracle-premium.ts'), questions = load('src/lib/server/oracle-questions.ts');
const snapshots = load('src/lib/server/client-paypal-checkout.ts',{'@/lib/ruleta':roulette});
const expected = [['oracle_2',1,2,0],['destino_3',2,3,0],['oracle_questions_3',2,0,3]];
class NextResponse extends Response { static json(data, options) { return new NextResponse(JSON.stringify(data),options); } }
function harness() {
  const rows = new Map(), remote = new Map(), calls = [], rpcCalls = [], credited = new Set();
  const user = { id:id(1) }, cliente = { id:id(2) };
  const state = { enabled:true, settingsError:false, failCreate:false, failCredit:false, capturePending:false };
  const env = { PAYPAL_PUBLIC_BASE_URL:'https://panel.test',PAYPAL_ENVIRONMENT:'sandbox',PAYPAL_CLIENT_ID:'legacy-id',PAYPAL_CLIENT_SECRET:'legacy-secret',PAYPAL_WEBHOOK_ID:'legacy-webhook',
    PAYPAL_CUSTOMER_ENVIRONMENT:'sandbox',PAYPAL_CUSTOMER_CLIENT_ID:'customer-id',PAYPAL_CUSTOMER_CLIENT_SECRET:'customer-secret',PAYPAL_CUSTOMER_WEBHOOK_ID:'customer-webhook',
    PAYPAL_CUSTOMER_MERCHANT_ID:'MERCHANTFIXTURE',PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT:'client_business_v1' };
  const admin = { from(table) {
    let filters=[],mode='read',value;
    const q={select:()=>q,eq:(key,v)=>{filters.push(row=>row[key]===v);return q;},neq:(key,v)=>{filters.push(row=>row[key]!==v);return q;},is:(key,v)=>{filters.push(row=>(row[key]??null)===v);return q;},
      single:()=>q,maybeSingle:()=>q,insert:v=>{mode='insert';value=v;return q;},update:v=>{mode='update';value=v;return q;},then(resolve,reject) {
        let data,error=null;
        if(table==='cliente_payment_settings') { data={paypal_client_enabled:state.enabled,web_payments_enabled:false};if(state.settingsError)error={message:'fixture unavailable'}; }
        else if(mode==='insert') { if(rows.has(value.id))error={code:'23505'};else rows.set(value.id,{...clone(value),status:'pending',remote_status:'CREATING',created_at:new Date().toISOString(),order_id:null});data=error?null:rows.get(value.id); }
        else { data=[...rows.values()].find(row=>filters.every(filter=>filter(row)))||null;if(data&&mode==='update')Object.assign(data,clone(value)); }
        return Promise.resolve({data:clone(data),error}).then(resolve,reject);
      }};return q;
  }, async rpc(name,params) {
    rpcCalls.push({name,params:clone(params)});
    if(state.failCredit)return {error:{message:'fixture finalizer failed'}};
    const row=rows.get(params.p_id);credited.add(params.p_capture_id);
    Object.assign(row,{status:'completed',remote_status:'CAPTURE_COMPLETED',capture_id:params.p_capture_id,payment_id:id(500)});
    return {error:null,data:{ok:true,payment_id:row.payment_id}};
  } };
  const fetch = async (url, request) => {
    const tokenCall=url.endsWith('/v1/oauth2/token');
    const account=tokenCall ? Buffer.from(request.headers.Authorization.slice(6),'base64').toString().startsWith('customer-id:')?'client_business_v1':'legacy'
      : request.headers.Authorization==='Bearer customer-token'?'client_business_v1':'legacy';
    const body=request.body?.startsWith('{')?JSON.parse(request.body):null;
    calls.push({url,account,body,method:request.method,requestId:request.headers['PayPal-Request-Id']});
    const response=(data,status=200)=>({ok:status<400,status,json:async()=>clone(data)});
    if(tokenCall)return response({access_token:account==='legacy'?'legacy-token':'customer-token'});
    if(url.endsWith('/v1/notifications/verify-webhook-signature'))return response({verification_status:body.webhook_id===(account==='legacy'?'legacy-webhook':'customer-webhook')?'SUCCESS':'FAILURE'});
    if(url.endsWith('/v1/identity/generate-token'))return response({client_token:'fixture-client-token'});
    if(url.endsWith('/v2/checkout/orders')) {
      if(state.failCreate)throw Error('fixture interrupted create');
      const row=rows.get(body.purchase_units[0].custom_id),key=account+':'+row.id;
      if(!remote.has(key))remote.set(key,{id:'ORDER'+row.id.slice(-4),intent:'CAPTURE',status:'CREATED',purchase_units:clone(body.purchase_units),payment_source:{card:{}}});
      const order=remote.get(key);if(account==='client_business_v1')order.purchase_units[0].payee={merchant_id:'MERCHANTFIXTURE'};return response(order);
    }
    const match=url.match(/\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
    if(match) {
      const order=[...remote.entries()].find(([key,value])=>key.startsWith(account+':')&&value.id===match[1])?.[1];
      if(!order)return response({details:[{issue:'RESOURCE_NOT_FOUND'}]},404);
      if(match[2]){order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:'CAP'+order.id,status:state.capturePending?'PENDING':'COMPLETED',amount:clone(order.purchase_units[0].amount)}]};}
      return response(order);
    }
    throw Error('Unexpected fixture request '+url);
  };
  const globals={fetch,process:{env}};
  const paypal=load('src/lib/server/paypal-crm.ts',{'@supabase/supabase-js':{createClient:()=>admin}},globals);
  class RouletteAccessError extends Error { constructor(status,message){super(message);this.status=status;} }
  const mocks={'next/server':{NextResponse},'@/lib/server/paypal-crm':paypal,'@/lib/server/cliente-minute-packs':packs,
    '@/lib/server/client-paypal-checkout':snapshots,'@/lib/server/oracle-premium':oracle,'@/lib/server/oracle-questions':questions,
    '@/lib/server/client-promotions':{loadActivePromotion:async()=>null},'@/lib/server/ruleta-access':{RouletteAccessError,rouletteClient:async req=>{
      if(req.headers.get('authorization')!=='Bearer fixture')throw new RouletteAccessError(401,'No autorizado');return {admin,user,cliente};
    }}};
  const api=load('src/app/api/cliente/pagos/paypal/route.ts',mocks,globals), cardApi=load('src/app/api/paypal-crm/card/route.ts',mocks,globals);
  const webhook=load('src/lib/server/paypal-webhook.ts',mocks,globals);
  const post=(body={},auth='fixture')=>api.POST(new Request('https://panel.test/api/cliente/pagos/paypal',{method:'POST',headers:{origin:'https://panel.test',authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify({packId:'oracle_2',attemptId:id(10),...body})}));
  const card=(row,action='session')=>cardApi.POST(new Request('https://panel.test/api/paypal-crm/card',{method:'POST',headers:{origin:'https://panel.test','content-type':'application/json'},body:JSON.stringify({ref:row.public_token,action})}));
  const event=(row,account='client_business_v1')=>webhook.handlePayPalWebhook(new Request('https://panel.test/api/webhooks/paypal-cliente',{method:'POST',headers:Object.fromEntries(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].map(key=>['paypal-'+key,'fixture'])),body:JSON.stringify({event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{supplementary_data:{related_ids:{order_id:row.order_id}}}})}),account);
  const getRemote=row=>[...remote.values()].find(order=>order.id===row.order_id);
  return {post,card,event,rows,calls,rpcCalls,credited,remote,getRemote,env,state,user,cliente,paypal,admin};
}

test('three exact Oracle packs use canonical EUR amounts and zero minute/Coins/roulette rewards',async()=>{
  for(const [packId,amount,credits,extraQuestions] of expected) {
    const h=harness(),response=await h.post({packId,amount:.01,currency:'USD',oracle_credits:999,oracle_questions:999,total_minutes:999,rewards_eligible:true,purchase_kind:'minutes'});
    assert.equal(response.status,200);const row=h.rows.get(id(10)),snapshot=row.purchase_payload;
    assert.equal(row.amount,amount);assert.equal(row.currency,'EUR');assert.equal(row.create_payload.purchase_units[0].amount.value,amount.toFixed(2));
    assert.equal(snapshot.purchase_kind,'oracle');assert.equal(snapshot.oracle_credits,credits);assert.equal(snapshot.oracle_questions,extraQuestions);
    for(const key of ['normal','free','total_minutes','points','roulette_spins'])assert.equal(snapshot[key],0);
    assert.equal(snapshot.roulette_level,null);assert.equal(snapshot.rewards_eligible,false);assert.equal(snapshot.purchase_classification,'nada');
    assert.equal(snapshot.paypal_account,'client_business_v1');assert.equal(snapshot.paypal_merchant_id,'MERCHANTFIXTURE');
    assert.equal(h.rpcCalls.length,0);assert.ok(h.calls.every(call=>call.account==='client_business_v1'));
  }
});
test('Oracle API rejects unauthorized, malformed, mismatched and disabled new purchases without provider calls',async()=>{
  const h=harness();assert.equal((await h.post({},'forged')).status,401);
  for(const packId of ['unknown',' oracle_2 ','oracle_999'])assert.equal((await h.post({packId})).status,400);
  h.state.enabled=false;assert.equal((await h.post()).status,503);h.state.enabled=true;h.state.settingsError=true;assert.equal((await h.post()).status,503);
  assert.equal(h.rows.size,0);assert.equal(h.calls.length,0);
});
test('Oracle retries keep identity and account when the activation selector or availability changes',async()=>{
  const h=harness();await Promise.all([h.post(),h.post()]);assert.equal(h.rows.size,1);assert.equal(h.remote.size,1);
  const row=h.rows.get(id(10)),saved=JSON.stringify(row.purchase_payload);
  h.env.PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT='legacy';h.state.enabled=false;
  assert.equal((await h.post()).status,200);assert.equal(JSON.stringify(row.purchase_payload),saved);
  assert.equal((await h.post({packId:'destino_3'})).status,409);
  h.user.id=id(90);h.cliente.id=id(91);assert.equal((await h.post()).status,409);
  assert.equal(h.remote.size,1);assert.ok(h.calls.every(call=>call.account==='client_business_v1'));
});
test('card session and receipt expose Oracle counts and never claim minutes or expose private fields',async()=>{
  for(const [packId,,credits,extraQuestions] of expected) {
    const h=harness();await h.post({packId});const row=h.rows.get(id(10));
    const session=await(await h.card(row)).json();assert.equal(session.purchase_kind,'oracle');assert.equal(session.purchase_summary.purchaseKind,'oracle');
    assert.equal(session.purchase_summary.oracleCredits,credits);assert.equal(session.purchase_summary.oracleQuestions,extraQuestions);
    assert.equal(session.purchase_summary.totalMinutes,0);assert.equal(session.client_id,'customer-id');assert.equal(session.can_pay,true);
    assert.equal(session.purchase_payload,undefined);assert.equal(session.secret,undefined);assert.equal(h.rpcCalls.length,0);
    h.getRemote(row).status='APPROVED';const receipt=await(await h.card(row,'capture')).json();
    assert.equal(receipt.status,'completed');assert.equal(receipt.credited,true);assert.equal(receipt.purchase_summary.oracleQuestions,extraQuestions);
    assert.deepEqual(h.rpcCalls.map(call=>call.name),['tc_complete_paypal_oracle']);
  }
});
test('completed signed Oracle webhooks use only the Oracle finalizer, duplicate events do not grant twice',async()=>{
  const h=harness();await h.post();const row=h.rows.get(id(10)),order=h.getRemote(row);
  order.status='COMPLETED';order.purchase_units[0].payments={captures:[{id:'CAPTURE-FIXTURE',status:'COMPLETED',amount:clone(order.purchase_units[0].amount)}]};
  assert.equal((await h.event(row)).status,200);assert.equal((await h.event(row)).status,200);
  assert.deepEqual(h.rpcCalls.map(call=>call.name),['tc_complete_paypal_oracle']);assert.equal(h.credited.size,1);
  assert.equal(h.calls.filter(call=>call.url.endsWith('/capture')).length,0);
});
test('pending capture and capture/merchant mismatches cannot credit Oracle balances',async()=>{
  const pending=harness();await pending.post();const pendingRow=pending.rows.get(id(10));pending.getRemote(pendingRow).status='APPROVED';pending.state.capturePending=true;
  await pending.card(pendingRow,'capture');assert.equal(pending.rpcCalls.length,0);
  for(const mutate of [order=>order.purchase_units[0].payee.merchant_id='OTHER',order=>order.purchase_units[0].payments.captures[0].amount.value='0.01',order=>order.purchase_units[0].payments.captures[0].amount.currency_code='USD']) {
    const h=harness();await h.post();const row=h.rows.get(id(10)),order=h.getRemote(row);order.status='COMPLETED';
    order.purchase_units[0].payments={captures:[{id:'CAPTURE-FIXTURE',status:'COMPLETED',amount:clone(order.purchase_units[0].amount)}]};mutate(order);
    await assert.rejects(h.paypal.reconcilePayPal(h.admin,row,false));assert.equal(h.rpcCalls.length,0);
  }
});
test('failed Oracle fulfillment stays recoverable and never falls back to minute rewards',async()=>{
  const h=harness();await h.post();const row=h.rows.get(id(10));h.getRemote(row).status='APPROVED';h.state.failCredit=true;
  assert.equal((await h.card(row,'capture')).status,503);assert.equal(row.status,'pending');assert.equal(row.remote_status,'CAPTURE_COMPLETED');
  h.state.failCredit=false;const result=await(await h.card(row,'status')).json();assert.equal(result.credited,true);
  assert.ok(h.rpcCalls.every(call=>call.name==='tc_complete_paypal_oracle'));assert.equal(h.credited.size,1);
  assert.equal(h.calls.filter(call=>call.url.endsWith('/capture')).length,1);
});
test('Oracle cancellation is passive and leaves no benefits or capture request',async()=>{
  const h=harness();await h.post();const row=h.rows.get(id(10));const result=await(await h.card(row,'cancel')).json();
  assert.equal(result.status,'cancelled');assert.equal(result.purchase_kind,'oracle');assert.equal(h.rpcCalls.length,0);
  assert.equal(h.calls.filter(call=>call.url.endsWith('/capture')).length,0);
});
