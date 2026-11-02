const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
let db;const scalar=async(q,p=[])=>(await db.query(q,p)).rows[0].v;
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workers(id uuid primary key);create table crm_clientes(id uuid primary key);
 create table crm_cliente_pagos(id uuid primary key default gen_random_uuid(),cliente_id uuid,importe numeric,estado text,paypal_order_id text,paypal_capture_id text);
 create table crm_client_notes(cliente_id text,texto text,author_name text,event_type text,event_data jsonb,is_pinned boolean);
 create function cliente_confirmar_compra_ruleta_v3(p jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function cliente_confirmar_compra_ruleta_v2(p jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261006235223_paypal_crm_checkout.sql'),'utf8'));
 await db.exec("alter table crm_paypal_orders add column checkout_kind text default 'crm_collection';");
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261102183023_leonaris_paypal_collections.sql'),'utf8'));
 await db.query('insert into workers values($1),($2)',[id(1),id(3)]);await db.query('insert into crm_clientes values($1),($2)',[id(2),id(4)]);
});after(async()=>db.close());
const payload=(n,account='legacy',overrides={})=>({id:id(n),cliente_id:id(2),worker_id:id(1),environment:'sandbox',public_token:id(n+1000),amount:22,currency:'EUR',pack_id:'pack_20',pack_name:'20 minutos',purchase_payload:{paypal_account:account},create_payload:{},...overrides});
const create=p=>scalar('select tc_create_paypal_crm_attempt($1::jsonb) v',[JSON.stringify(p)]);
test('new RPC is server only and idempotent; retries preserve original account and payload',async()=>{
 for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'tc_create_paypal_crm_attempt(jsonb)','execute') v",[role]),false);
 const a=await create(payload(10));const before=await scalar('select to_jsonb(t) v from crm_paypal_orders t where id=$1',[id(10)]);
 assert.equal((await create(payload(10,'client_business_v1'))).purchase_payload.paypal_account,'legacy');
 assert.deepEqual(await scalar('select to_jsonb(t) v from crm_paypal_orders t where id=$1',[id(10)]),before);
 assert.equal(a.checkout_kind,'crm_collection');
});
test('another tab, operator or receiving account cannot create a second pending collection',async()=>{
 await assert.rejects(create(payload(11)),/PAYPAL_PENDING_COLLECTION/);
 await assert.rejects(create(payload(12,'client_business_v1',{worker_id:id(3)})),/PAYPAL_PENDING_COLLECTION/);
 assert.equal(await scalar('select count(*)::int v from crm_paypal_orders'),1);
 const results=await Promise.allSettled([create(payload(20,'legacy',{cliente_id:id(4)})),create(payload(21,'client_business_v1',{cliente_id:id(4)}))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('cancelled collection frees a new attempt; Leonaris finalizer records recipient without purchase or coins',async()=>{
 await db.query("update crm_paypal_orders set status='cancelled' where id=$1",[id(10)]);
 await create(payload(30,'client_business_v1'));await db.query("update crm_paypal_orders set order_id='ORDER30' where id=$1",[id(30)]);
 const complete=()=>scalar("select tc_complete_paypal_crm($1,'ORDER30','CAP30',22,'EUR') v",[id(30)]);
 assert.equal((await complete()).collection_only,true);assert.equal((await complete()).duplicated,true);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos'),0);
 assert.equal(await scalar('select count(*)::int v from crm_client_notes'),1);
 assert.equal(await scalar("select event_data->>'paypal_account' v from crm_client_notes"),'client_business_v1');
 assert.match(await scalar('select texto v from crm_client_notes'),/Leonaris.*no registra una compra/);
 await create(payload(31));
});
