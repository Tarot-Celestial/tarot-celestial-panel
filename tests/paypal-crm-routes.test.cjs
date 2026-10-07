const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function harness(){
 const rows=new Map();let remoteCreates=0,authChecks=0,api;
 const worker={id:id(1),role:'central'},client={id:id(2)};
 const admin={from:table=>{
   let filters=[],mode='read',value,one=false,lim;
   const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},is:(k,v)=>{filters.push(r=>(r[k]??null)===v);return q;},order:()=>q,limit:n=>{lim=n;return q;},
   insert:v=>{value=v;mode='insert';return q;},update:v=>{value=v;mode='update';return q;},single:()=>{one=true;return q;},maybeSingle:()=>{one=true;return q;},
   then:resolve=>{
    let data,error=null;
    if(mode==='insert'){if(rows.has(value.id))error={code:'23505'};else rows.set(value.id,{...value,created_at:new Date().toISOString(),status:'pending',remote_status:'CREATING'});data=rows.get(value.id);}
    else {let selected=(table==='crm_clientes'?[client]:[...rows.values()]).filter(r=>filters.every(f=>f(r)));if(lim)selected=selected.slice(-lim);if(mode==='update')selected.forEach(r=>Object.assign(r,value));data=one?selected[0]||null:selected;}
    return Promise.resolve({data,error}).then(resolve);
   }};return q;
 }};
 class PayPalError extends Error{constructor(m,status=502){super(m);this.status=status;}}
 const paypal={PAYPAL_TABLE:'crm_paypal_orders',PayPalError,paypalConfig:()=>({environment:'sandbox',origin:'https://panel.test'}),
   testPayPalConnection:async()=>{authChecks++;return {environment:'sandbox',message:'OAuth OK'};},
   paypalRequest:async()=>{remoteCreates++;return {id:'ORDER10',status:'CREATED'};},approvalUrl:()=> 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER10',reconcilePayPal:async(_,a)=>a};
 const packs={CLIENTE_MINUTE_PACKS:[{id:'pack_20',nombre:'20 minutos',priceUsd:22,totalMinutes:20,rouletteSpins:1}],getConfiguredMinutePack:k=>packs.CLIENTE_MINUTE_PACKS.find(p=>p.id===k)};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/crm/pagos/paypal/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,console,require:n=>({
 'crypto':require('node:crypto'),'next/server':{NextResponse:{json:(x,o)=>new Response(JSON.stringify(x),o)}},
 '@/lib/server/ruleta-access':{rouletteStaff:async req=>{if(req.headers.get('authorization')!=='Bearer good')throw new PayPalError('Forbidden',401);return {admin,worker};}},
 '@/lib/server/cliente-minute-packs':packs,'@/lib/server/cliente-platform':{pointsFromAmount:n=>n*10,splitMinutes:n=>({free:Math.floor(n/2),normal:n-Math.floor(n/2)})},
 '@/lib/ruleta':{rouletteLevelForPurchaseAmount:()=>1},'@/lib/server/paypal-crm':paypal})[n]});api=exports;
 const post=(overrides={},token='good')=>api.POST(new Request('https://panel.test/api/crm/pagos/paypal',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({request_id:id(10),cliente_id:id(2),pack_id:'pack_20',...overrides})}));
 return {post,api,rows,worker,paypal,remoteCreates:()=>remoteCreates,authChecks:()=>authChecks};
}
test('Connection check is staff-only and never creates a database record or PayPal order',async()=>{
 const h=harness();assert.equal((await h.post({action:'test_connection'},'forged')).status,401);assert.equal(h.authChecks(),0);
 assert.equal((await h.post({action:'test_connection'})).status,200);assert.equal(h.authChecks(),1);assert.equal(h.rows.size,0);assert.equal(h.remoteCreates(),0);
});
test('PayPal creation requires verified staff access',async()=>{
 const h=harness();assert.equal((await h.post({},'forged')).status,401);assert.equal(h.remoteCreates(),0);
});
test('Server chooses pack price, snapshots benefits and reuses one remote order',async()=>{
 const h=harness();assert.equal((await h.post({manual_amount:0.01})).status,200);assert.equal((await h.post()).status,200);assert.equal(h.remoteCreates(),1);
 const row=h.rows.get(id(10));assert.equal(row.amount,22);assert.equal(row.purchase_payload.free,10);assert.equal(row.create_payload.purchase_units[0].custom_id,id(10));assert.equal(row.create_payload.purchase_units[0].amount.value,'22.00');
 assert.ok(row.create_payload.payment_source.card.experience_context.return_url.startsWith('https://panel.test/pago-paypal?ref='));
 assert.equal(row.create_payload.payment_source.card.attributes.verification.method,'SCA_WHEN_REQUIRED'); assert.ok(row.approval_url.startsWith('https://panel.test/pago-tarjeta?ref='));
});
test('Request ID cannot be reused for another worker or amount',async()=>{
 const h=harness();await h.post();h.worker.id=id(3);assert.equal((await h.post()).status,409);assert.equal(h.remoteCreates(),1);
});
test('Manual amount validation and zero pack minutes',async()=>{
 const h=harness();for(const amount of [0,-1,5001,'no',1.234])assert.equal((await h.post({pack_id:'crm_manual_amount',manual_amount:amount})).status,400);
 assert.equal((await h.post({pack_id:'crm_manual_amount',manual_amount:'27,50'})).status,200);assert.equal(h.rows.get(id(10)).amount,27.5);assert.equal(h.rows.get(id(10)).purchase_payload.free,0);
});
test('Creation failure preserves operation and payload for retry; old request never creates a duplicate',async()=>{
 const h=harness();const real=h.paypal.paypalRequest;h.paypal.paypalRequest=async()=>{throw Error('timeout');};assert.equal((await h.post()).status,500);
 const row=h.rows.get(id(10));const saved=JSON.stringify(row.create_payload);h.paypal.paypalRequest=real;assert.equal((await h.post({notes:'different'})).status,200);assert.equal(JSON.stringify(row.create_payload),saved);
 row.order_id=null;row.created_at=new Date(Date.now()-6*3600000).toISOString();assert.equal((await h.post()).status,409);assert.equal(h.remoteCreates(),1);
});
test('Other workers cannot read the payment, even with its UUID',async()=>{
 const h=harness();await h.post();h.worker.id=id(3);const response=await h.api.GET(new Request('https://panel.test/api/crm/pagos/paypal?attempt_id='+id(10),{headers:{authorization:'Bearer good'}}));assert.equal(response.status,404);
});
