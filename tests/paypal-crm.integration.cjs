const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
let db;const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scalar=async(q,p=[])=>(await db.query(q,p)).rows[0].v;
// The input repository does not include the original v2/v3 definitions.
// Stub ONLY that external contract; execute the delivered PayPal migration itself.
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workers(id uuid primary key);
 create table crm_clientes(id uuid primary key);
 create table crm_cliente_pagos(id uuid primary key default gen_random_uuid(),cliente_id uuid,importe numeric,estado text,paypal_order_id text,paypal_capture_id text);
 create table purchase_calls(payload jsonb);
 create function cliente_confirmar_compra_ruleta_v3(p jsonb) returns jsonb language plpgsql as $$declare r crm_cliente_pagos;begin
 if p->>'notas'='FAIL' then raise exception 'DELIVERY_FAILURE';end if;
 insert into purchase_calls values(p);
 insert into crm_cliente_pagos(cliente_id,importe,estado) values((p->>'cliente_id')::uuid,(p->>'amount')::numeric,'completed') returning * into r;
 return jsonb_build_object('ok',true,'payment',to_jsonb(r));end $$;
 create function cliente_confirmar_compra_ruleta_v2(p jsonb) returns jsonb language sql as $$select cliente_confirmar_compra_ruleta_v3(p)$$;
 grant all on crm_cliente_pagos,purchase_calls to service_role;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261006235223_paypal_crm_checkout.sql'),'utf8'));
 await db.query('insert into workers values($1)',[id(1)]);await db.query('insert into crm_clientes values($1)',[id(2)]);
});
after(async()=>db.close());
async function order(n,payload={},pack='pack_20') {await db.query(`insert into crm_paypal_orders(id,cliente_id,worker_id,environment,order_id,amount,pack_id,pack_name,purchase_payload,create_payload) values($1,$2,$3,'sandbox',$4,22,$5,'20 minutos',$6,'{}')`,[id(n),id(2),id(1),'ORDER'+n,pack,JSON.stringify(payload)]);}
const complete=(n,capture='CAP'+n,amount=22,currency='EUR')=>scalar('select tc_complete_paypal_crm($1,$2,$3,$4,$5) v',[id(n),'ORDER'+n,capture,amount,currency]);
test('No public access to payment tokens or fulfilment RPC',async()=>{
 for(const role of ['anon','authenticated']){
  assert.equal(await scalar("select has_table_privilege($1,'crm_paypal_orders','select') v",[role]),false);
  assert.equal(await scalar("select has_function_privilege($1,'tc_complete_paypal_crm(uuid,text,text,numeric,text)','execute') v",[role]),false);
 }assert.equal(await scalar("select relrowsecurity v from pg_class where relname='crm_paypal_orders'"),true);
});
test('Completed capture registers one purchase; concurrent callbacks and retries do not duplicate benefits',async()=>{
 await order(10,{free:10,normal:10,oracle_credits:0});
 await Promise.all([complete(10),complete(10),complete(10)]);
 assert.equal(await scalar('select count(*)::int v from purchase_calls'),1);
 const a=await scalar('select to_jsonb(t) v from crm_paypal_orders t where id=$1',[id(10)]);
 assert.equal(a.status,'completed');assert.equal(a.capture_id,'CAP10');assert.ok(a.payment_id);
 const p=await scalar('select payload v from purchase_calls limit 1');assert.equal(p.payment_ref,'paypal-crm:ORDER10');assert.equal(p.free,10);assert.equal(p.created_by_user_id,id(1));
 await assert.rejects(complete(10,'OTHER'),/MISMATCH/);
});
test('Wrong amount/currency cannot register purchases',async()=>{
 await order(11);await assert.rejects(complete(11,'CAP11',21),/MISMATCH/);await assert.rejects(complete(11,'CAP11',22,'USD'),/MISMATCH/);
 assert.equal(await scalar('select status v from crm_paypal_orders where id=$1',[id(11)]),'pending');
});
test('Delivery error rolls back everything and same order can recover',async()=>{
 await order(12,{notas:'FAIL'});await assert.rejects(complete(12),/DELIVERY_FAILURE/);
 assert.equal(await scalar('select status v from crm_paypal_orders where id=$1',[id(12)]),'pending');
 await db.query("update crm_paypal_orders set purchase_payload='{}' where id=$1",[id(12)]);
 assert.equal((await complete(12)).ok,true);
});
test('Manual amount keeps zero pack minutes and uses the existing manual RPC',async()=>{
 await order(13,{free:0,normal:0,points:220},'crm_manual_amount');await complete(13);
 const p=await scalar("select payload v from purchase_calls where payload->>'payment_ref'='paypal-crm:ORDER13'");
 assert.equal(p.metodo,'paypal_crm_manual');assert.equal(p.free,0);assert.equal(p.normal,0);
});
test('A capture ID cannot credit two different orders (transaction rollback)',async()=>{
 await order(14);const before=await scalar('select count(*)::int v from purchase_calls');
 await assert.rejects(complete(14,'CAP10'),/unique/);
 assert.equal(await scalar('select count(*)::int v from purchase_calls'),before);
 assert.equal(await scalar('select status v from crm_paypal_orders where id=$1',[id(14)]),'pending');
});
