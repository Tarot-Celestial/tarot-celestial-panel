const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const evidence=path.resolve(__dirname,'fixtures');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const scalar=async(sql,params=[])=>(await db.query(sql,params)).rows[0].v;
before(async()=>{
 db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await db.exec(fs.readFileSync(path.join(evidence,'purchase-reward-schema.sql'),'utf8'));
 await db.exec(`
 alter table crm_cliente_pagos add unique(referencia_externa);
 alter table tc_client_benefit_events add unique(payment_id,benefit_key),add unique(delivery_key);
 alter table tc_purchase_package_levels add primary key(package_source,package_key);
 alter table tc_rank_package_benefits add primary key(rank_key,package_level);
 create table crm_clientes(id uuid primary key, nombre text, minutos_free_pendientes numeric default 0,minutos_normales_pendientes numeric default 0,puntos numeric default 0,updated_at timestamptz);
 create table client_rank_overrides(id uuid primary key default gen_random_uuid(),client_id uuid,assigned_rank text,intervention_type text,starts_at timestamptz,ends_at timestamptz,reason text,notes text,active boolean,created_at timestamptz default now());
 create table cliente_puntos_historial(id uuid primary key default gen_random_uuid(),cliente_id uuid,tipo text,puntos numeric,descripcion text,operation_id uuid,saldo_despues integer,meta jsonb);
 create table cliente_oracle_credit_movements(cliente_id uuid,amount integer,movement_type text,reference text unique,pack_id text,notes text,meta jsonb);
 create table cliente_ruleta_giros(id uuid primary key default gen_random_uuid(),cliente_id uuid,payment_key text unique,source text,nivel smallint,purchase_id uuid,purchase_amount numeric,purchase_currency text,estado text,required_rank text);
 create table cliente_ruleta_signal(cliente_id uuid primary key,updated_at timestamptz);
 create table cliente_notificaciones(cliente_id uuid,tipo text,titulo text,mensaje text,meta jsonb,leida boolean,created_at timestamptz);
 create table crm_client_notes(cliente_id text,texto text,author_user_id uuid,author_name text,author_email text,event_type text,event_data jsonb,is_pinned boolean,created_at timestamptz);
 create table crm_call_operations(operation_id uuid primary key,cliente_id uuid,worker_id uuid,request jsonb,result jsonb);
 create table crm_payment_call_links(payment_id uuid unique,operation_id uuid unique,cliente_id uuid,worker_id uuid,rendimiento_id uuid,result jsonb);
 create table workers(id uuid primary key,user_id uuid,role text,is_active boolean);
 create table crm_recovery_mission_requests(request_id uuid,payload jsonb,result jsonb);
 create table crm_client_recovery(client_id uuid);
 create table cliente_payment_attempts(id uuid primary key,cliente_id uuid,status text,promotion_snapshot jsonb,amount numeric,currency text,provider text,order_id text,pack_id text,completed_at timestamptz,updated_at timestamptz);
 `);
 const config=JSON.parse(fs.readFileSync(path.join(evidence,'purchase-reward-config.json'),'utf8'));
 for(const row of config.bands)await db.query('insert into tc_client_purchase_bands(currency,min_amount,max_amount,roulette_level,spins,is_active) values($1,$2,$3,$4,$5,$6)',Object.values(row));
 for(const row of config.packageLevels)await db.query('insert into tc_purchase_package_levels(package_source,package_key,package_label,package_level) values($1,$2,$3,$4)',Object.values(row));
 for(const row of config.rankConfig)await db.query('insert into tc_client_rank_benefits(rank_key,label,min_spend,purchase_coins,coins_enabled,roulette_level,roulette_spins,roulette_enabled,is_active) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',Object.values(row));
 for(const row of config.matrix)await db.query('insert into tc_rank_package_benefits(rank_key,package_level,enabled,coins,oracle_credits,roulette_level_1_spins,roulette_level_2_spins,roulette_level_3_spins,roulette_special_spins) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',Object.values(row));
 await db.exec(fs.readFileSync(path.join(evidence,'purchase-reward-production-dependencies.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261025223000_purchase_reward_eligibility.sql'),'utf8'));
 await db.exec(`CREATE CONSTRAINT TRIGGER tc_purchase_benefits AFTER INSERT OR UPDATE ON crm_cliente_pagos DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (new.estado='completed' AND new.benefits_processed_at IS NULL) EXECUTE FUNCTION tc_purchase_benefits_trigger();`);
});
after(async()=>{await db?.close();});
async function client(n,rank='bronce'){
 await db.query('insert into crm_clientes(id) values($1)',[id(n)]);
 await db.query("insert into client_rank_overrides(client_id,assigned_rank,active,starts_at) values($1,$2,true,now()-interval '1 hour')",[id(n),rank]);
 return id(n);
}
const summary=c=>scalar(`select jsonb_build_object('coins',puntos,'free',minutos_free_pendientes,'normal',minutos_normales_pendientes,
 'spins',(select coalesce(jsonb_agg(nivel order by nivel),'[]') from cliente_ruleta_giros where cliente_id=c.id),
 'oracle',(select coalesce(sum(amount),0) from cliente_oracle_credit_movements where cliente_id=c.id)) v from crm_clientes c where id=$1`,[c]);
const buy=(n,c,extra={})=>scalar('select cliente_confirmar_compra_ruleta_v3($1::jsonb) v',[JSON.stringify({cliente_id:c,payment_ref:'TEST'+n,amount:22,currency:'EUR',normal:20,free:0,pack_id:'pack_20',pack_name:'20 minutos',points:0,oracle_credits:0,roulette_level:1,roulette_spins:1,metodo:'paypal_cliente',...extra})]);
const call=p=>scalar('select tc_register_call_minutes($1::jsonb) v',[JSON.stringify(p)]);
const payload=(n,c,extra={})=>({operation_id:id(n+10000),cliente_id:c,telefonista_worker_id:id(1),cliente_compra_minutos:true,tipo_registro:'compra',codigo_1:'CLIENTE',minutos_1:5,minutos_2:0,guarda_minutos:true,minutos_guardados_free:0,minutos_guardados_normales:15,importe:22,forma_pago:'tpv',promo:false,captado:false,recuperado:false,super_promo_ruleta:false,pricing_mode:'regular',purchase_classification:'nada',points_to_add:0,purchase_benefits:{oracle_credits:0,roulette_level:1,roulette_spins:1},note_text:'Prueba local sin datos reales',...extra});
async function collection(n,c,pack='crm_manual_amount',amount=22){await db.query("insert into crm_paypal_orders(id,cliente_id,checkout_kind,status,capture_id,order_id,pack_id,amount,currency,purchase_payload,environment) values($1,$2,'crm_collection','completed',$3,$4,$5,$6,'EUR','{}','live')",[id(n),c,'CAP'+n,'ORDER'+n,pack,amount]);return id(n);}

test('regular web purchases grant native and rank benefits once, including canonical tier/Oracle',async()=>{
 for(const [n,amount,total,normal,free,level,coins,oracle,nativeOracle] of [[101,22,20,20,0,1,50,0,0],[102,35,60,40,20,2,150,0,0],[103,69,120,80,40,3,300,4,2]]){
  const c=await client(n),extra={amount,normal,free,pack_id:'pack_'+total,roulette_level:level,oracle_credits:nativeOracle};
  await buy(n,c,extra); assert.deepEqual(await summary(c),{coins,free,normal,spins:[level,level],oracle});
  await buy(n,c,extra); assert.deepEqual(await summary(c),{coins,free,normal,spins:[level,level],oracle});
 }
});
test('web promotion suppresses advertised base and configured rank Coins/spins while preserving Oracle/minutes',async()=>{
 const c=await client(110,'diamante');
 await buy(110,c,{amount:25,pack_id:'promo:248faa2a-d863-4174-b068-9619c434fe29',points:250,normal:30,free:20,oracle_credits:2,roulette_level:1});
 assert.deepEqual(await summary(c),{coins:0,free:35,normal:30,spins:[],oracle:3});
});
test('manual amount cannot gain rewards even at regular price or Diamante; historical grants stay intact',async()=>{
 const c=await client(120,'diamante');await buy(120,c); const before=await summary(c);
 await buy(121,c,{pack_id:'crm_manual_amount',points:999,pricing_mode:'regular',normal:0,free:0});
 const after=await summary(c);assert.equal(after.coins,before.coins);assert.deepEqual(after.spins,before.spins);
});
test('wizard Nada/Captado/Recuperado use regular level matrix with equal rewards and truthful balances',async()=>{
 for(const [n,classification] of [[130,'nada'],[131,'captado'],[132,'recuperado']]){
  const c=await client(n),p=payload(n,c,{purchase_classification:classification,captado:classification==='captado',recuperado:classification==='recuperado'});
  const r=await call(p);assert.deepEqual(await summary(c),{coins:50,free:0,normal:15,spins:[1,1],oracle:0});
  await call(p);assert.equal((await summary(c)).coins,50);assert.equal(r.balances.normal_after,15);
  await assert.rejects(call({...p,promo:true,purchase_classification:'promo'}),/PAYMENT_OPERATION_CONFLICT/);
 }
});
test('wizard Promo gets no Coins/spins despite forged benefits; Super gets exactly one special',async()=>{
 let c=await client(140);await call(payload(140,c,{promo:true,pricing_mode:'promotion',purchase_classification:'promo',points_to_add:500,purchase_benefits:{coins:500,oracle_credits:2,roulette_level:2,roulette_spins:8}}));
 assert.deepEqual(await summary(c),{coins:0,free:0,normal:15,spins:[],oracle:2});
 c=await client(141,'diamante');await call(payload(141,c,{super_promo_ruleta:true,pricing_mode:'super_promo',purchase_classification:'super_promo_ruleta',points_to_add:500,purchase_benefits:{oracle_credits:0,roulette_level:4,roulette_spins:5}}));
 assert.deepEqual(await summary(c),{coins:0,free:0,normal:15,spins:[4],oracle:0});
});
test('DB-first deployment keeps the legacy Super Promo callback idempotent on its stable key and source',async()=>{
 const c=await client(142),p=payload(142,c,{super_promo_ruleta:true,pricing_mode:'super_promo',purchase_classification:'super_promo_ruleta',purchase_benefits:{oracle_credits:0,roulette_level:4,roulette_spins:1}});
 const r=await call(p),paymentKey='rendimiento:'+r.rendimiento.id;
 // The old API callback looks up this identity before attempting a grant.
 const existing=await scalar('select to_jsonb(g) v from cliente_ruleta_giros g where payment_key=$1',[paymentKey]);
 assert.ok(existing);assert.equal(existing.source,'super_promo_ruleta');assert.equal(existing.nivel,4);
 assert.equal(existing.purchase_id,r.payment.id);assert.equal(existing.cliente_id,c);
 if(!existing)await db.query("insert into cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,estado) values($1,$2,'super_promo_ruleta',4,$3,'pending')",[c,paymentKey,r.payment.id]);
 await call(p);assert.deepEqual(await summary(c),{coins:0,free:0,normal:15,spins:[4],oracle:0});
 assert.equal(await scalar("select count(*)::int v from tc_client_benefit_events where payment_id=$1 and benefit_type='roulette'",[r.payment.id]),1);
});
test('manual collection requires explicit selection and is claimed once without reward bypass by Nada or Super',async()=>{
 for(const [n,classification] of [[150,'nada'],[151,'super_promo_ruleta']]){
  const c=await client(n),order=await collection(n+1000,c),p=payload(n,c,{forma_pago:'paypal_manual',purchase_classification:classification,super_promo_ruleta:classification==='super_promo_ruleta'});
  await assert.rejects(call(p),/PAYPAL_COLLECTION_SELECTION_REQUIRED/);assert.equal((await summary(c)).coins,0);
  const chosen={...p,paypal_collection_order_id:order,paypal_collection_source:'crm_collection',expected_paypal_environment:'live'};
  const r=await call(chosen);assert.deepEqual(await summary(c),{coins:0,free:0,normal:15,spins:[],oracle:0});
  assert.equal(r.collection_linked,true);await call(chosen);assert.equal((await summary(c)).normal,15);
  await assert.rejects(call({...chosen,operation_id:id(n+20000)}),/PAYPAL_COLLECTION_ALREADY_REGISTERED/);
 }
});
test('external confirmation can register a distinct PayPal purchase without silently claiming an old collection',async()=>{
 const c=await client(160),order=await collection(1160,c),p=payload(160,c,{forma_pago:'paypal_manual',paypal_collection_source:'external'});
 await call(p);assert.equal((await summary(c)).coins,50);
 assert.equal(await scalar('select payment_id v from crm_paypal_orders where id=$1',[order]),null);
});
test('explicit external source registers a distinct payment even after a same-price completed web purchase',async()=>{
 const c=await client(166),previous=await buy(166,c),order=await collection(1166,c,'pack_20');
 await db.query("update crm_paypal_orders set payment_id=$1,checkout_kind='client_purchase' where id=$2",[previous.payment.id,order]);
 const p=payload(166,c,{forma_pago:'paypal_manual',expected_paypal_environment:'live'});
 await assert.rejects(call(p),/PAYPAL_PAYMENT_ALREADY_CONFIRMED/);
 await call({...p,paypal_collection_source:'external'});assert.equal((await summary(c)).coins,100);
 assert.equal(await scalar('select payment_id v from crm_paypal_orders where id=$1',[order]),previous.payment.id);
});
test('linked regular packs preserve their locked native Oracle snapshot plus rank benefits, including Diamante',async()=>{
 for(const [n,amount,total,nativeOracle,rank] of [[161,49,80,1,'bronce'],[162,69,120,2,'bronce'],[163,99,180,3,'bronce'],[164,99,180,3,'diamante']]){
  const c=await client(n,rank),order=await collection(n+1000,c,'pack_'+total,amount);
  await db.query('update crm_paypal_orders set purchase_payload=$1,pack_name=$2 where id=$3',[JSON.stringify({pack_id:'pack_'+total,pack_name:total+' minutos',normal:total,free:0,points:0,oracle_credits:nativeOracle,roulette_level:3,roulette_spins:amount===99?2:1}),total+' minutos',order]);
  const p=payload(n,c,{importe:amount,forma_pago:'paypal_manual',paypal_collection_source:'crm_collection',paypal_collection_order_id:order,expected_paypal_environment:'live',purchase_benefits:{oracle_credits:999}});
  const r=await call(p),actual=await summary(c);
  assert.equal(actual.oracle,nativeOracle+(rank==='diamante'?3:2));assert.equal(actual.coins,rank==='diamante'?500:300);
  assert.equal(actual.spins.filter(x=>x===3).length,amount===99?3:2);assert.equal(actual.spins.filter(x=>x===4).length,rank==='diamante'?1:0);
  assert.equal(r.payment.pack_id,'pack_'+total);assert.equal(r.purchase_benefits.oracle_credits,actual.oracle);
  await call(p);assert.deepEqual(await summary(c),actual);
 }
});
test('a first-ever regular purchase resolves its current rank without a fixture override',async()=>{
 const c=id(165);await db.query('insert into crm_clientes(id) values($1)',[c]);await call(payload(165,c));
 assert.equal((await summary(c)).coins,50);
});
test('wrong customer/amount/noncompleted/web order references fail atomically',async()=>{
 const c=await client(170),other=await client(171),order=await collection(1170,other);
 await assert.rejects(call(payload(170,c,{forma_pago:'paypal_manual',paypal_collection_source:'crm_collection',paypal_collection_order_id:order})),/PAYPAL_COLLECTION_INVALID/);
 for(const [n,field,value] of [[172,'amount',26],[173,'status','pending'],[174,'checkout_kind','client_purchase'],[175,'capture_id',null],[176,'environment','sandbox']]){
  const otherOrder=await collection(n+1000,c);
  await db.query(`update crm_paypal_orders set ${field}=$1 where id=$2`,[value,otherOrder]);
  await assert.rejects(call(payload(n,c,{forma_pago:'paypal_manual',paypal_collection_source:'crm_collection',paypal_collection_order_id:otherOrder,expected_paypal_environment:'live'})),/PAYPAL_COLLECTION_INVALID/);
 }
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[c]),0);
});
test('client PayPal capture accepts suppressed promo snapshot and records actual delivered amounts once',async()=>{
 const c=await client(180),order=id(1180),pack='promo:248faa2a-d863-4174-b068-9619c434fe29';
 const snapshot={pack_id:pack,pack_name:'Promoción',normal:30,free:20,total_minutes:50,points:0,oracle_credits:2,roulette_level:null,roulette_spins:0,reward_policy_version:1,pricing_mode:'promotion'};
 await db.query("insert into crm_paypal_orders(id,cliente_id,checkout_kind,purchaser_auth_user_id,order_id,amount,currency,pack_id,pack_name,purchase_payload,status) values($1,$2,'client_purchase',$3,'WEB180',25,'EUR',$4,'Promoción',$5,'pending')",[order,c,id(2180),pack,JSON.stringify(snapshot)]);
 const finish=()=>scalar("select tc_complete_paypal_client($1,'WEB180','CAPWEB180',25,'EUR') v",[order]);
 const r=await finish();assert.equal(r.credited.coins,0);assert.deepEqual(r.credited.spins,[]);assert.equal(r.credited.oracle_credits,2);
 const before=await summary(c);assert.equal((await finish()).duplicated,true);assert.deepEqual(await summary(c),before);
 const note=await scalar("select texto v from crm_client_notes where cliente_id=$1 and event_type='client_paypal_purchase'",[c]);
 assert.match(note,/0 Coins/);assert.match(note,/ruleta: ninguno/);
});
test('deferred direct-payment trigger also denies promo rewards regardless of payload eligibility',async()=>{
 const c=await client(190);
 await db.query("insert into crm_cliente_pagos(cliente_id,importe,moneda,estado,pack_id,benefits_context) values($1,25,'EUR','completed','promo:248faa2a-d863-4174-b068-9619c434fe29',$2)",[c,JSON.stringify({coins:999,special_spins:99,rewards_eligible:true,pricing_mode:'regular'})]);
 assert.deepEqual(await summary(c),{coins:0,free:0,normal:0,spins:[],oracle:0});
});
test('legacy promotion finalizer delegates to canonical engine and cannot bypass suppression',async()=>{
 const c=await client(191),attempt=id(1191),pack='promo:248faa2a-d863-4174-b068-9619c434fe29';
 await db.query("insert into cliente_payment_attempts(id,cliente_id,status,promotion_snapshot,amount,currency,provider,order_id,pack_id) values($1,$2,'processing',$3,25,'EUR','mollie','LEGACY191',$4)",
 [attempt,c,JSON.stringify({kind:'promotion_minute_pack',price:25,currency:'EUR',paid_minutes:30,free_minutes:20,coins:250,oracle_credits:2,roulette_level:1,roulette_spins:1}),pack]);
 const finalize=()=>scalar('select cliente_confirmar_compra_promocion_v1($1) v',[attempt]);
 await finalize();assert.deepEqual(await summary(c),{coins:0,free:20,normal:30,spins:[],oracle:2});
 await finalize();assert.deepEqual(await summary(c),{coins:0,free:20,normal:30,spins:[],oracle:2});
});
test('reward failures roll back payment, minutes, claims and events together',async()=>{
 const c=await client(200),order=await collection(1200,c,'pack_20');
 await db.exec(`create function fail_purchase_test() returns trigger language plpgsql as $$begin if new.cliente_id='${c}'::uuid and new.benefit_key='purchase_processed' then raise exception 'TEST_REWARD_FAILURE'; end if;return new;end$$;
 create trigger fail_purchase_test before insert on tc_client_benefit_events for each row execute function fail_purchase_test();`);
 const p=payload(200,c,{forma_pago:'paypal_manual',paypal_collection_source:'crm_collection',paypal_collection_order_id:order,expected_paypal_environment:'live'});
 await assert.rejects(call(p),/TEST_REWARD_FAILURE/);assert.deepEqual(await summary(c),{coins:0,free:0,normal:0,spins:[],oracle:0});
 assert.equal(await scalar('select payment_id v from crm_paypal_orders where id=$1',[order]),null);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[c]),0);
 await db.exec('drop trigger fail_purchase_test on tc_client_benefit_events;drop function fail_purchase_test();');
 await call(p);assert.equal((await summary(c)).coins,50);
});
test('service_role only functions prohibit browser role economic writes',async()=>{
 for(const name of ['tc_purchase_reward_policy(uuid)','cliente_confirmar_compra_ruleta_v3(jsonb)','tc_apply_purchase_benefits(uuid)','tc_apply_rank_package_benefits(uuid)','tc_register_call_minutes(jsonb)','tc_register_call_with_payment(jsonb)']){
  assert.equal(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE') v",[name]),false);
  assert.equal(await scalar("select has_function_privilege('anon',$1,'EXECUTE') v",[name]),false);
  assert.equal(await scalar("select has_function_privilege('service_role',$1,'EXECUTE') v",[name]),true);
 }
});
