// Isolated PostgreSQL tests. The legacy RPC bodies below are contract fixtures,
// NOT copies of production RPCs (those definitions were absent from the ZIP).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
let db;
const diamond='10000000-0000-4000-8000-000000000001';
const bronze='10000000-0000-4000-8000-000000000002';
const none='10000000-0000-4000-8000-000000000003';
const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0].value;
const state=id=>scalar('select tc_rank_phase_one_state($1) as value',[id]);
const balance=id=>scalar('select puntos as value from crm_clientes where id=$1',[id]);
async function save(rank,coins,ritual) {
 const revision=await scalar('select revision as value from tc_client_rank_benefits where rank_key=$1',[rank]);
 return scalar('select tc_save_rank_phase_one($1) as value',[JSON.stringify({rank_key:rank,purchase_coins:coins,ritual_access:ritual,revision})]);
}
const purchase=(id,ref,kind='minutes',extra={})=>scalar('select tc_confirm_rank_purchase($1,$2) as value',
 [kind,JSON.stringify({cliente_id:id,payment_ref:ref,amount:10,...extra})]);
before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create table crm_clientes(id uuid primary key,nombre text,apellido text,puntos integer default 0);
 create table crm_cliente_pagos(id uuid primary key default gen_random_uuid(),cliente_id uuid,importe numeric,estado text,
   created_at timestamptz default now(),updated_at timestamptz,referencia_externa text unique,paypal_order_id text,paypal_capture_id text,paypal_payer_id text);
 create table rendimiento_llamadas(id uuid primary key default gen_random_uuid(),cliente_id uuid,cliente_nombre text,importe numeric,fecha_hora timestamptz,created_at timestamptz);
 create table client_rank_overrides(id uuid default gen_random_uuid(),client_id uuid,assigned_rank text,active boolean,starts_at timestamptz,ends_at timestamptz,created_at timestamptz default now());
 create table cliente_payment_attempts(id uuid primary key,cliente_id uuid,status text,promotion_snapshot jsonb);
 create table cliente_puntos_historial(cliente_id uuid,tipo text,puntos integer,descripcion text);
 create table client_rituals(id uuid);
 create function cliente_confirmar_compra_ruleta_v3(p jsonb) returns jsonb language plpgsql as $$
 declare payment crm_cliente_pagos;
 begin
   select * into payment from crm_cliente_pagos where referencia_externa=p->>'payment_ref';
   if found then return jsonb_build_object('duplicated',true,'payment',to_jsonb(payment)); end if;
   insert into crm_cliente_pagos(cliente_id,importe,estado,referencia_externa)
     values((p->>'cliente_id')::uuid,(p->>'amount')::numeric,'completed',p->>'payment_ref') returning * into payment;
   update crm_clientes set puntos=puntos+(p->>'points')::integer where id=(p->>'cliente_id')::uuid;
   if p->>'fail'='yes' then raise exception 'SIMULATED_PURCHASE_FAILURE'; end if;
   return jsonb_build_object('ok',true,'payment',to_jsonb(payment));
 end $$;
 create function cliente_confirmar_compra_ruleta_v2(p jsonb) returns jsonb language sql as $$ select cliente_confirmar_compra_ruleta_v3(p) $$;
 create function cliente_confirmar_compra_promocion_v1(p_attempt_id uuid) returns jsonb language plpgsql as $$
 declare a cliente_payment_attempts; result jsonb;
 begin
   select * into a from cliente_payment_attempts where id=p_attempt_id;
   result=cliente_confirmar_compra_ruleta_v3(jsonb_build_object('cliente_id',a.cliente_id,'payment_ref',a.id,'amount',10,'points',a.promotion_snapshot->'coins'));
   update cliente_payment_attempts set status='completed' where id=a.id;
   return result;
 end $$;
 create function crm_register_call_atomic_v8(p jsonb) returns jsonb language sql as $$
   select cliente_confirmar_compra_ruleta_v3(p||jsonb_build_object('payment_ref','registrar_llamada:'||(p->>'operation_id'),'amount',p->'importe','points',p->'points_to_add'))
 $$;
 insert into crm_clientes(id,nombre) values('${diamond}','Test Diamond'),('${bronze}','Test Bronze'),('${none}','Test No Rank');
 insert into crm_cliente_pagos(cliente_id,importe,estado) values('${diamond}',1000,'completed'),('${bronze}',10,'completed');
 `);
 for(const name of ['20261002_01_rank_benefits.sql','20261002_02_rank_purchase_integration.sql']) {
   await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
 }
});
after(async()=>{if(db)await db.close()});
test('A/B/G: saved 500 then 750, retries retain original result and never credit twice',async()=>{
 await save('diamante',500,true);
 const a=await purchase(diamond,'A'); assert.equal(a.rank_coins,500); assert.equal(await balance(diamond),500);
 await save('diamante',750,true);
 const repeated=await purchase(diamond,'A'); assert.equal(repeated.duplicated,true); assert.equal(repeated.rank_coins,500);
 await purchase(diamond,'B'); assert.equal(await balance(diamond),1250);
 const results=await Promise.all(Array.from({length:5},()=>purchase(diamond,'G')));
 assert.equal(results.filter(r=>!r.duplicated).length,1); assert.equal(await balance(diamond),2000);
});
test('C/D/E: ritual access is configurable for every rank, including revocation',async()=>{
 assert.equal((await state(diamond)).ritual_access,true);
 assert.equal((await state(bronze)).ritual_access,false);
 await save('bronce',20,true); assert.equal((await state(bronze)).ritual_access,true);
 await save('diamante',750,false); assert.equal((await state(diamond)).ritual_access,false);
});
test('F: stale revision and invalid values roll back without overwriting saved state',async()=>{
 const previous=await state(diamond);
 await assert.rejects(save('diamante',-1,true),/INVALID_BENEFIT_CONFIG/);
 await assert.rejects(scalar('select tc_save_rank_phase_one($1) as value',[JSON.stringify({rank_key:'diamante',purchase_coins:999,ritual_access:true,revision:0})]),/CONFIG_CONFLICT/);
 assert.deepEqual(await state(diamond),previous);
});
test('transaction failure rolls back balance, payment and receipt, allowing a retry',async()=>{
 const before=await balance(diamond);
 await assert.rejects(purchase(diamond,'rollback','minutes',{fail:'yes'}),/SIMULATED_PURCHASE_FAILURE/);
 assert.equal(await balance(diamond),before);
 assert.equal(await scalar("select count(*)::int as value from tc_rank_purchase_receipts where operation_key='rollback'"),0);
 await purchase(diamond,'rollback'); assert.equal(await balance(diamond),before+750);
});
test('no rank, rolling window, manual override and expiry resolve without UI defaults',async()=>{
 assert.equal((await state(none)).rank_key,null);
 await purchase(none,'first'); assert.equal(await balance(none),0);
 assert.equal((await state(none)).rank_key,'bronce');
 await db.exec(`insert into client_rank_overrides(client_id,assigned_rank,active,starts_at,ends_at) values('${bronze}','diamante',true,now()-interval '1 day',now()+interval '1 day')`);
 assert.equal((await state(bronze)).rank_key,'diamante');
 await db.exec(`update client_rank_overrides set ends_at=now()-interval '1 second' where client_id='${bronze}'`);
 assert.equal((await state(bronze)).rank_key,'bronce');
});
test('manual, promotional and CRM purchases use same configured Coins',async()=>{
 await purchase(diamond,'manual','manual');
 const attempt='20000000-0000-4000-8000-000000000001';
 await db.exec(`insert into cliente_payment_attempts values('${attempt}','${diamond}','pending','{"coins":99999,"paid_minutes":20}')`);
 const promo=await purchase(diamond,'promotion','promotion',{attempt_id:attempt});assert.equal(promo.rank_coins,750);
 assert.equal(await scalar('select promotion_snapshot->>\'paid_minutes\' as value from cliente_payment_attempts where id=$1',[attempt]),'20');
 const call=await purchase(diamond,'call','call',{operation_id:'call-test',cliente_compra_minutos:true,importe:10});assert.equal(call.rank_coins,750);
});
test('PayPal completion is atomic and repeated callbacks preserve the balance',async()=>{
 const payment='30000000-0000-4000-8000-000000000001';
 await db.exec(`insert into crm_cliente_pagos(id,cliente_id,importe,estado,paypal_order_id) values('${payment}','${diamond}',10,'pending','order')`);
 const before=await balance(diamond);
 await purchase(diamond,'paypal','paypal',{payment_id:payment,capture_id:'capture'});
 await purchase(diamond,'paypal','paypal',{payment_id:payment,capture_id:'capture'});
 assert.equal(await balance(diamond),before+750);
});
test('cross-customer reference collision is rejected and clients have no direct administrative privileges',async()=>{
 await assert.rejects(purchase(bronze,'A'),/PURCHASE_CLIENT_MISMATCH/);
 for(const role of ['anon','authenticated']) {
   assert.equal(await scalar(`select has_function_privilege('${role}','tc_save_rank_phase_one(jsonb)','EXECUTE') as value`),false);
   assert.equal(await scalar(`select has_function_privilege('${role}','tc_confirm_rank_purchase(text,jsonb)','EXECUTE') as value`),false);
   assert.equal(await scalar(`select has_table_privilege('${role}','tc_client_rank_benefits','SELECT') as value`),false);
 }
});
test('reapplying migrations preserves configured values, permissions and credited receipts',async()=>{
 const original=await state(diamond),points=await balance(diamond);
 for(const name of ['20261002_01_rank_benefits.sql','20261002_02_rank_purchase_integration.sql']) {
   await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
 }
 assert.deepEqual(await state(diamond),original);
 await purchase(diamond,'A');assert.equal(await balance(diamond),points);
});
