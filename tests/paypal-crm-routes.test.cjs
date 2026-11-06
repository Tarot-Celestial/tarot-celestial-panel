const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function harness(){
 const rows=new Map();let remoteCreates=0,authChecks=0,api;
 const worker={id:id(1),role:'central'},client={id:id(2)};
 const admin={rpc:async(name,{p_attempt:v,p_previous=[]})=>{if(name!=='tc_replace_paypal_crm_attempt')throw Error(name);if(rows.has(v.id))return {data:rows.get(v.id)};for(const old of p_previous){const row=rows.get(old.id);row.status='cancelled';row.remote_status='CANCELLED_BY_STAFF';}v.purchase_payload.replaced_count=p_previous.length;if(rows.has(v.id))return {data:rows.get(v.id)};if([...rows.values()].some(a=>a.cliente_id===v.cliente_id&&a.environment===v.environment&&a.status==='pending'))return {error:{message:'PAYPAL_PENDING_COLLECTION'}};rows.set(v.id,{checkout_kind:'crm_collection',...v,created_at:new Date().toISOString(),status:'pending',remote_status:'CREATING'});return {data:rows.get(v.id)};},from:table=>{
   let filters=[],mode='read',value,one=false,lim;
   const q={or:()=>q,select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},is:(k,v)=>{filters.push(r=>(r[k]??null)===v);return q;},order:()=>q,limit:n=>{lim=n;return q;},
   insert:v=>{value=v;mode='insert';return q;},update:v=>{value=v;mode='update';return q;},single:()=>{one=true;return q;},maybeSingle:()=>{one=true;return q;},
   then:resolve=>{
    let data,error=null;
    if(mode==='insert'){if(rows.has(value.id))error={code:'23505'};else rows.set(value.id,{checkout_kind:'crm_collection',...value,created_at:new Date().toISOString(),status:'pending',remote_status:'CREATING'});data=rows.get(value.id);}
    else {let selected=(table==='crm_clientes'?[client]:[...rows.values()]).filter(r=>filters.every(f=>f(r)));if(lim)selected=selected.slice(-lim);if(mode==='update')selected.forEach(r=>Object.assign(r,value));data=one?selected[0]||null:selected;}
    return Promise.resolve({data,error}).then(resolve);
   }};return q;
 }};
 class PayPalError extends Error{constructor(m,status=502){super(m);this.status=status;}}
 const config={account:'legacy',environment:'sandbox',origin:'https://panel.test'};
 const paypal={paypalAccountForAttempt:a=>a.purchase_payload?.paypal_account||'legacy',PAYPAL_TABLE:'crm_paypal_orders',PayPalError,paypalConfig:()=>config,
   paypalConfigForAttempt:a=>{if(a.environment!==config.environment)throw new PayPalError('Wrong environment',409);return config;},
   testPayPalConnection:async()=>{authChecks++;return {environment:'sandbox',message:'OAuth OK'};},
   preparePayPalCrmReplacement:async(_admin,o)=>{const pending=[...rows.values()].filter(r=>r.cliente_id===o.clientId&&r.environment===o.environment&&r.checkout_kind==='crm_collection'&&r.status==='pending');if(!o.isAdmin&&pending.some(r=>r.worker_id!==o.workerId))throw new PayPalError('Otra central',409);if(pending.some(r=>r.remote_status==='CAPTURE_REQUESTED'))throw new PayPalError('Procesándose',409);return pending.map(r=>({...r}));},
   cancelPayPalLink:async(_,a)=>{a.status='cancelled';a.remote_status='CANCELLED_BY_STAFF';return a;},
   paypalRequest:async()=>{remoteCreates++;return {id:'ORDER10',status:'CREATED'};},approvalUrl:()=> 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER10',reconcilePayPal:async(_,a)=>a};
 const packs={CLIENTE_MINUTE_PACKS:[{id:'pack_20',nombre:'20 minutos',priceUsd:22,totalMinutes:20,rouletteLevel:1,rouletteSpins:1}],getConfiguredMinutePack:k=>packs.CLIENTE_MINUTE_PACKS.find(p=>p.id===k)};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/crm/pagos/paypal/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,console,require:n=>({
 'crypto':require('node:crypto'),'next/server':{NextResponse:{json:(x,o)=>new Response(JSON.stringify(x),o)}},
 '@/lib/server/ruleta-access':{rouletteStaff:async req=>{if(req.headers.get('authorization')!=='Bearer good')throw new PayPalError('Forbidden',401);return {admin,worker:{...worker,can_admin:worker.role==='admin'||worker.can_admin===true}};}},
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
test('Manual amount stays ineligible even when it exactly matches a regular package price',async()=>{
 const h=harness();const response=await h.post({pack_id:'crm_manual_amount',manual_amount:22,pricing_mode:'regular',points:999,roulette_spins:5});assert.equal(response.status,200);
 const payload=h.rows.get(id(10)).purchase_payload;assert.equal(payload.pack_id,'crm_manual_amount');assert.equal(payload.pricing_mode,'manual_amount');
 assert.equal(payload.rewards_eligible,false);assert.equal(payload.points,0);assert.equal(payload.roulette_spins,0);assert.equal(payload.roulette_level,null);
 assert.equal(payload.normal,0);assert.equal(payload.free,0);
});
test('Creation failure preserves operation and payload for retry; old request never creates a duplicate',async()=>{
 const h=harness();const real=h.paypal.paypalRequest;h.paypal.paypalRequest=async()=>{throw Error('timeout');};assert.equal((await h.post()).status,500);
 const row=h.rows.get(id(10));const saved=JSON.stringify(row.create_payload);h.paypal.paypalRequest=real;assert.equal((await h.post({notes:'different'})).status,200);assert.equal(JSON.stringify(row.create_payload),saved);
 row.order_id=null;row.created_at=new Date(Date.now()-6*3600000).toISOString();assert.equal((await h.post()).status,409);assert.equal(h.remoteCreates(),1);
});
test('Other workers cannot read the payment, even with its UUID',async()=>{
 const h=harness();await h.post();h.worker.id=id(3);const response=await h.api.GET(new Request('https://panel.test/api/crm/pagos/paypal?attempt_id='+id(10),{headers:{authorization:'Bearer good'}}));assert.equal(response.status,404);
});
test('Cancellation requires verified staff and is restricted to the creator or an admin',async()=>{
 const h=harness();await h.post();const body={action:'cancel',attempt_id:id(10)};
 assert.equal((await h.post(body,'forged')).status,401);
 h.worker.id=id(3);assert.equal((await h.post(body)).status,404);assert.equal(h.rows.get(id(10)).status,'pending');
 h.worker.role='admin';const response=await h.post(body);assert.equal(response.status,200);assert.equal((await response.json()).attempt.remote_status,'CANCELLED_BY_STAFF');
});

test('Central collection controls never select or cancel a self-service client purchase',async()=>{
 const h=harness();await h.post();h.worker.role='admin';
 const row=h.rows.get(id(10));row.checkout_kind='client_purchase';row.worker_id=null;
 const found=await h.api.GET(new Request('https://panel.test/api/crm/pagos/paypal?attempt_id='+id(10),{headers:{authorization:'Bearer good'}}));
 assert.equal(found.status,404);
 assert.equal((await h.post({action:'cancel',attempt_id:id(10)})).status,404);
 assert.equal(row.status,'pending');
 const latest=await h.api.GET(new Request('https://panel.test/api/crm/pagos/paypal?cliente_id='+id(2),{headers:{authorization:'Bearer good'}}));
 assert.equal((await latest.json()).latest,null);
});

test('New collection replaces a pending predecessor while an idempotent retry retains the new order',async()=>{const h=harness();await h.post();const r=await h.post({request_id:id(11),pack_id:'crm_manual_amount',manual_amount:20});assert.equal(r.status,200);assert.equal((await r.json()).replaced_count,1);assert.equal(h.rows.get(id(10)).status,'cancelled');assert.equal(h.rows.get(id(11)).status,'pending');await h.post({request_id:id(11),pack_id:'crm_manual_amount',manual_amount:20});assert.equal(h.remoteCreates(),2);});
test('A capture in progress blocks replacement before another provider order is created',async()=>{const h=harness();await h.post();h.rows.get(id(10)).remote_status='CAPTURE_REQUESTED';assert.equal((await h.post({request_id:id(11)})).status,409);assert.equal(h.remoteCreates(),1);});

test('Pending manager lists both accounts but never another central, client purchase or other customer',async()=>{const h=harness();await h.post();const row=h.rows.get(id(10));h.rows.set(id(11),{...row,id:id(11),purchase_payload:{paypal_account:'client_business_v1'}});h.rows.set(id(12),{...row,id:id(12),worker_id:id(3)});h.rows.set(id(13),{...row,id:id(13),checkout_kind:'client_purchase'});h.rows.set(id(14),{...row,id:id(14),cliente_id:id(4)});const req=()=>new Request('https://panel.test/api/crm/pagos/paypal?cliente_id='+id(2)+'&account=leonaris&pending_all=1',{headers:{authorization:'Bearer good'}});assert.deepEqual((await(await h.api.GET(req())).json()).pending.map(a=>a.id),[id(10),id(11)]);h.worker.role='admin';assert.equal((await(await h.api.GET(req())).json()).pending.length,3);});
test('Manager inspection is passive, staff protected and cannot access a client purchase',async()=>{const h=harness();await h.post();let mode;h.paypal.reconcilePayPal=async(_a,a,capture)=>{mode=capture;return a;};assert.equal((await h.post({action:'inspect',attempt_id:id(10)})).status,200);assert.equal(mode,false);assert.equal((await h.post({action:'inspect',attempt_id:id(10)},'forged')).status,401);h.rows.get(id(10)).checkout_kind='client_purchase';assert.equal((await h.post({action:'inspect',attempt_id:id(10)})).status,404);assert.equal(h.remoteCreates(),1);});

test('A late creation response cannot restore a URL after another request cancelled its attempt',async()=>{const h=harness();h.paypal.paypalRequest=async()=>{const row=h.rows.get(id(10));row.status='cancelled';row.remote_status='CANCELLED_BY_STAFF';return {id:'LATEORDER',status:'CREATED'};};await h.post();const row=h.rows.get(id(10));assert.equal(row.status,'cancelled');assert.equal(row.remote_status,'CANCELLED_BY_STAFF');assert.equal(row.order_id,undefined);assert.equal(row.approval_url,undefined);});
