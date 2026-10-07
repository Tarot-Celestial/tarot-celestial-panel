const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
let db;const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scalar=async(q,p=[])=>(await db.query(q,p)).rows[0].v;
// The original v8 body is not in the supplied ZIP. Exercise the migration against
// its documented JSON contract, including rollback if that contract is violated.
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workers(id uuid primary key);
 create table crm_clientes(id uuid primary key,minutes numeric not null default 60);
 create table rendimiento_llamadas(id uuid primary key default gen_random_uuid(),cliente_id uuid,payload jsonb);
 create table crm_cliente_pagos(id uuid primary key default gen_random_uuid(),cliente_id uuid,importe numeric,estado text,source_rendimiento_id uuid);
 create table crm_paypal_orders(id uuid primary key default gen_random_uuid(),payment_id uuid,cliente_id uuid,status text,capture_id text);
 create function crm_register_call_atomic_v8(p jsonb) returns jsonb language plpgsql as $$
 declare r rendimiento_llamadas; paid crm_cliente_pagos; begin
 if p->>'test_fail'='true' then raise exception 'SIMULATED_FAILURE'; end if;
 if (select minutes from crm_clientes where id=(p->>'cliente_id')::uuid)+(p->>'normal_delta')::numeric < 0 then raise exception 'INSUFFICIENT_NORMAL_MINUTES';end if;
 update crm_clientes set minutes=minutes+coalesce((p->>'normal_delta')::numeric,0) where id=(p->>'cliente_id')::uuid;
 insert into rendimiento_llamadas(cliente_id,payload) values((p->>'cliente_id')::uuid,p) returning * into r;
 if (p->>'cliente_compra_minutos')::boolean or p->>'test_bad_contract'='true' then
 insert into crm_cliente_pagos(cliente_id,importe,estado,source_rendimiento_id) values((p->>'cliente_id')::uuid,(p->>'importe')::numeric,'completed',r.id) returning * into paid;
 end if;
 return jsonb_build_object('ok',true,'rendimiento',to_jsonb(r),'payment',case when paid.id is null then null else to_jsonb(paid) end);end $$;
 grant all on crm_clientes,crm_cliente_pagos,crm_paypal_orders,rendimiento_llamadas,workers to service_role;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261007173256_paypal_link_existing_call.sql'),'utf8'));
 await db.query('insert into workers values($1)',[id(1)]);
});
after(async()=>db.close());
async function setup(n){
 await db.query('insert into crm_clientes(id) values($1)',[id(n)]);
 await db.query("insert into crm_cliente_pagos(id,cliente_id,importe,estado) values($1,$2,35,'completed')",[id(n+1000),id(n)]);
 await db.query("insert into crm_paypal_orders(payment_id,cliente_id,status,capture_id) values($1,$2,'completed',$3)",[id(n+1000),id(n),'CAP'+n]);
 return {cliente_id:id(n),existing_payment_id:id(n+1000),operation_id:id(n+2000),telefonista_worker_id:id(1),cliente_compra_minutos:false,tipo_registro:'minutos',tiempo:20,free_delta:0,normal_delta:-20,importe:0};
}
const call=p=>scalar('select tc_register_call_with_payment($1::jsonb) v',[JSON.stringify(p)]);
test('One confirmed payment + linked call = one economic row, one consumption, no purchase branch',async()=>{
 const p=await setup(10);const result=await call({...p,points_to_add:500,purchase_benefits:{coins:500}});
 assert.equal(result.payment,null);assert.equal(result.payment_linked,true);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[p.cliente_id]),1);
 assert.equal(await scalar('select minutes::int v from crm_clientes where id=$1',[p.cliente_id]),40);
 const payload=await scalar('select payload v from rendimiento_llamadas where id=$1',[result.rendimiento.id]);
 assert.equal(payload.points_to_add,0);assert.equal(payload.purchase_benefits,null);assert.equal(payload.importe,0);
 assert.equal(await scalar('select source_rendimiento_id v from crm_cliente_pagos where id=$1',[p.existing_payment_id]),result.rendimiento.id);
});
test('Identical simultaneous requests/retries return same call, even after balance has been used',async()=>{
 const p=await setup(20);p.normal_delta=-60;p.tiempo=60;
 const results=await Promise.all([call(p),call(p),call(p)]);
 assert.equal(new Set(results.map(r=>r.rendimiento.id)).size,1);
 assert.equal(await scalar('select minutes::int v from crm_clientes where id=$1',[p.cliente_id]),0);
 assert.equal((await call(p)).duplicate_prevented,true);
});
test('A second operation cannot consume the same payment again',async()=>{
 const p=await setup(30);await call(p);await assert.rejects(call({...p,operation_id:id(9030)}),/PAYMENT_ALREADY_LINKED/);
 assert.equal(await scalar('select minutes::int v from crm_clientes where id=$1',[p.cliente_id]),40);
});
test('Reject mismatched client, unconfirmed payment, and unconfirmed order',async()=>{
 const p=await setup(40),other=await setup(41);
 await assert.rejects(call({...p,existing_payment_id:other.existing_payment_id}),/EXISTING_PAYMENT_INVALID/);
 await db.query("update crm_cliente_pagos set estado='pending' where id=$1",[p.existing_payment_id]);
 await assert.rejects(call(p),/EXISTING_PAYMENT_INVALID/);
 await db.query("update crm_cliente_pagos set estado='completed' where id=$1",[p.existing_payment_id]);
 await db.query("update crm_paypal_orders set status='pending' where payment_id=$1",[p.existing_payment_id]);
 await assert.rejects(call(p),/EXISTING_PAYMENT_INVALID/);
});
test('Reject replacing another worker/operation payment, without changing saved call',async()=>{
 const p=await setup(50);await call(p);
 await assert.rejects(call({...p,telefonista_worker_id:id(999)}),/PAYMENT_OPERATION_CONFLICT/);
 await assert.rejects(call({...p,existing_payment_id:id(888)}),/PAYMENT_OPERATION_CONFLICT/);
});
test('Fails atomically when v8 fails or unexpectedly creates a second payment',async()=>{
 const p=await setup(60);
 await assert.rejects(call({...p,test_fail:true}),/SIMULATED_FAILURE/);
 await assert.rejects(call({...p,test_bad_contract:true}),/EXISTING_PAYMENT_CONTRACT_MISMATCH/);
 assert.equal(await scalar('select minutes::int v from crm_clientes where id=$1',[p.cliente_id]),60);
 assert.equal(await scalar('select count(*)::int v from rendimiento_llamadas where cliente_id=$1',[p.cliente_id]),0);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[p.cliente_id]),1);
 assert.equal((await call(p)).payment_linked,true);
});
test('Insufficient balance and purchase-shaped link requests do not create call',async()=>{
 const p=await setup(70);
 await assert.rejects(call({...p,normal_delta:-61,tiempo:61}),/INSUFFICIENT_NORMAL_MINUTES/);
 await assert.rejects(call({...p,cliente_compra_minutos:true}),/EXISTING_PAYMENT_CALL_ONLY/);
 await assert.rejects(call({...p,normal_delta:5}),/EXISTING_PAYMENT_CALL_ONLY/);
 await assert.rejects(call({...p,normal_delta:0,tiempo:20}),/EXISTING_PAYMENT_CALL_ONLY/);
});
test('Manual duplicate is blocked; operator can explicitly attest a distinct real payment',async()=>{
 const p=await setup(80);const manual={...p,existing_payment_id:null,cliente_compra_minutos:true,forma_pago:'paypal_manual',importe:35,normal_delta:0};
 await assert.rejects(call(manual),/PAYPAL_PAYMENT_ALREADY_CONFIRMED/);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[p.cliente_id]),1);
 assert.ok((await call({...manual,separate_payment_confirmed:true})).payment.id);
});
test('Normal minutes and TPV call paths continue through v8',async()=>{
 const p=await setup(90);assert.ok((await call({...p,existing_payment_id:null})).rendimiento.id);
 const result=await call({...p,existing_payment_id:null,cliente_compra_minutos:true,forma_pago:'tpv',importe:35,normal_delta:0});
 assert.ok(result.payment.id);
});
test('No public access to link table or RPC; rerunning migration is safe',async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal(await scalar("select has_table_privilege($1,'crm_payment_call_links','select') v",[role]),false);
  assert.equal(await scalar("select has_function_privilege($1,'tc_register_call_with_payment(jsonb)','execute') v",[role]),false);
 }
 assert.equal(await scalar("select relrowsecurity v from pg_class where relname='crm_payment_call_links'"),true);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261007173256_paypal_link_existing_call.sql'),'utf8'));
});
