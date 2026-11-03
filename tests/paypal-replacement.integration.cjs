// Local embedded PostgreSQL; no real orders or balances.
const {test,before,after,beforeEach}=require('node:test');
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
 create function cliente_confirmar_compra_ruleta_v2(p jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;`);
 for(const file of ['20261006235223_paypal_crm_checkout.sql','20261102183023_leonaris_paypal_collections.sql','20261103151228_paypal_crm_replace_pending_link.sql','20261103153926_paypal_legacy_incomplete_link_recovery.sql']) {
  if(file.startsWith('20261102'))await db.exec("alter table crm_paypal_orders add column checkout_kind text default 'crm_collection'");
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 }
 await db.query('insert into workers values($1),($2)',[id(1),id(3)]);await db.query('insert into crm_clientes values($1),($2)',[id(2),id(4)]);
});
after(async()=>db.close());beforeEach(async()=>db.exec('truncate crm_paypal_orders,crm_client_notes'));
const payload=(n,overrides={})=>({id:id(n),cliente_id:id(2),worker_id:id(1),environment:'sandbox',public_token:id(n+1000),amount:20,currency:'EUR',pack_id:'crm_manual_amount',pack_name:'Manual',purchase_payload:{paypal_account:'client_business_v1'},create_payload:{payment_source:{card:{}}},...overrides});
const create=p=>scalar('select tc_create_paypal_crm_attempt($1::jsonb) v',[JSON.stringify(p)]);
async function pending(n=10){await create(payload(n,{purchase_payload:{paypal_account:'legacy'}}));await db.query("update crm_paypal_orders set order_id=$2,remote_status='CREATED' where id=$1",[id(n),'ORDER'+n]);return snapshot(n);}
const snapshot=n=>scalar('select jsonb_build_object(\'id\',id,\'status\',status,\'remote_status\',remote_status,\'order_id\',order_id,\'note\',\'Sustituido automáticamente\') v from crm_paypal_orders where id=$1',[id(n)]);
const replace=(p,previous,admin=false)=>scalar('select tc_replace_paypal_crm_attempt($1::jsonb,$2::jsonb,$3) v',[JSON.stringify(p),JSON.stringify(previous),admin]);
test('replacement crosses accounts, preserves the old order, and retry does not cancel the new one',async()=>{
 const previous=await pending();const a=await replace(payload(11),[previous]);
 assert.equal(a.purchase_payload.replaced_count,1);assert.equal(a.purchase_payload.paypal_account,'client_business_v1');
 assert.deepEqual(a.purchase_payload.replaces_attempt_ids,[id(10)]);
 const old=await scalar('select to_jsonb(t) v from crm_paypal_orders t where id=$1',[id(10)]);
 assert.equal(old.status,'cancelled');assert.equal(old.remote_status,'CANCELLED_BY_STAFF');assert.equal(old.order_id,'ORDER10');assert.equal(old.purchase_payload.superseded_by,id(11));
 await replace(payload(11),[previous]);assert.equal(await scalar("select count(*)::int v from crm_paypal_orders where status='pending'"),1);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos'),0);
});
test('a capture that starts or finishes after the check blocks replacement without cancelling anything',async()=>{
 for(const remote of ['CAPTURE_REQUESTED','CAPTURE_PENDING','CAPTURE_COMPLETED']){
  await db.exec('truncate crm_paypal_orders');const previous=await pending();await db.query('update crm_paypal_orders set remote_status=$1 where id=$2',[remote,id(10)]);
  await assert.rejects(replace(payload(11),[previous]),/PAYPAL_REPLACEMENT_PROCESSING/);assert.equal(await scalar('select count(*)::int v from crm_paypal_orders'),1);assert.equal(await scalar('select status v from crm_paypal_orders'),'pending');
 }
});
test('stale checks and simultaneous new requests cannot replace a link they did not inspect',async()=>{
 const previous=await pending();await replace(payload(11),[previous]);
 await assert.rejects(replace(payload(12),[previous]),/PAYPAL_REPLACEMENT_CHANGED/);
 await assert.rejects(replace(payload(13),[]),/PAYPAL_REPLACEMENT_CHANGED/);
 assert.equal(await scalar("select count(*)::int v from crm_paypal_orders where status='pending'"),1);
});
test('failed new insertion rolls back cancellation and its audit fields',async()=>{
 const previous=await pending();await assert.rejects(replace(payload(11,{amount:-1}),[previous]),/amount_check/);
 assert.equal(await scalar('select status v from crm_paypal_orders'),'pending');assert.equal(await scalar("select purchase_payload ? 'superseded_by' v from crm_paypal_orders"),false);
});
test('existing creator/admin permission and client-purchase isolation remain enforced',async()=>{
 const previous=await pending();await assert.rejects(replace(payload(11,{worker_id:id(3)}),[previous]),/PAYPAL_REPLACEMENT_FORBIDDEN/);
 await replace(payload(11,{worker_id:id(3)}),[previous],true);
 await db.query("update crm_paypal_orders set checkout_kind='client_purchase' where id=$1",[id(10)]);
 await assert.rejects(replace(payload(12),[await snapshot(10)]),/PAYPAL_REPLACEMENT_CHANGED/);
 for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_function_privilege($1,'tc_replace_paypal_crm_attempt(jsonb,jsonb,boolean)','execute') v",[role]),false);
});
test('unfinished card creation can be replaced; unknown states stay protected',async()=>{
 await create(payload(10));await replace(payload(11),[await snapshot(10)]);
 await db.query("update crm_paypal_orders set remote_status='UNKNOWN' where id=$1",[id(11)]);
 await assert.rejects(replace(payload(12),[await snapshot(11)]),/PAYPAL_REPLACEMENT_PROCESSING/);
});

test('Legacy abandoned creation is replaceable only after expiry and without an issued link or payment',async()=>{
 const p=payload(10,{create_payload:{intent:'CAPTURE',purchase_units:[{custom_id:id(10),invoice_id:'TC-'+id(10)}],payment_source:{paypal:{}}}});
 await create(p);await assert.rejects(replace(payload(11),[await snapshot(10)]),/PROCESSING/);
 await db.query("update crm_paypal_orders set created_at=now()-interval '6 hours' where id=$1",[id(10)]);
 await db.query("update crm_paypal_orders set approval_url='https://fixture.invalid/pay' where id=$1",[id(10)]);
 await assert.rejects(replace(payload(11),[await snapshot(10)]),/PROCESSING/);
 await db.query('update crm_paypal_orders set approval_url=null,capture_id=$2 where id=$1',[id(10),'CAP']);
 await assert.rejects(replace(payload(11),[await snapshot(10)]),/PROCESSING/);
 await db.query('update crm_paypal_orders set capture_id=null where id=$1',[id(10)]);
 await replace(payload(11),[await snapshot(10)]);assert.equal(await scalar('select status v from crm_paypal_orders where id=$1',[id(10)]),'cancelled');
});
