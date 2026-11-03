const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const migration=read('../supabase/migrations/20261102025228_customer_benefits_november_2026.sql')+'\n'+read('../supabase/migrations/20261102153603_customer_coins_catalog_sync.sql')+'\n'+read('../supabase/migrations/20261103010836_customer_diamond_roulette_choice.sql');
const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
let db,seq=1000;
const scalar=async(q,p=[])=>(await db.query(q,p)).rows[0].v;
const fn=(name,...p)=>scalar('select '+name+'('+p.map((_,i)=>'$'+(i+1)).join(',')+') v',p);
async function client(rank='bronce',coins=0){const cid=id(seq++);await db.query("insert into crm_clientes(id,nombre,telefono,telefono_normalizado,puntos) values($1,'Synthetic','000','000',$2)",[cid,coins]);await db.query("insert into client_rank_overrides(client_id,assigned_rank,intervention_type,reason,created_by,starts_at,active) values($1,$2,'temporary','Local fixture','30000000-0000-4000-8000-000000000011',now()-interval '1 day',true)",[cid,rank]);return cid;}
const wallet=c=>scalar("select jsonb_build_object('coins',puntos,'free',minutos_free_pendientes,'normal',minutos_normales_pendientes) v from crm_clientes where id=$1",[c]);
const buy=(c,extra={})=>fn('cliente_confirmar_compra_ruleta_v3',JSON.stringify({cliente_id:c,payment_ref:'fixture:'+id(seq++),amount:22,currency:'EUR',metodo:'fixture',pack_id:'pack_20',pack_name:'20 minutos',normal:20,free:0,points:0,oracle_credits:0,...extra}));
before(async()=>{
 db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await db.exec(read('fixtures/benefits-nov-schema.sql'));
 await db.exec(read('fixtures/benefits-nov-schema-extra.sql'));
 await db.exec("create sequence fixture_call_number;alter table rendimiento_llamadas alter column id_unico set default nextval('fixture_call_number');");
 const config=JSON.parse(read('fixtures/benefits-nov-config.json'));
 for(const [table,rows] of Object.entries(config))for(const row of rows){const keys=Object.keys(row);await db.query('insert into '+table+'('+keys.map(k=>'"'+k+'"').join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>typeof row[k]==='object'&&row[k]!==null&&!Array.isArray(row[k])?JSON.stringify(row[k]):row[k]));}
 await db.exec('set check_function_bodies=off');
 await db.exec(read('fixtures/benefits-nov-functions.sql'));
 await db.exec(read('fixtures/benefits-nov-call-functions.sql'));
 await db.exec(read('fixtures/benefits-nov-spin-trigger.sql'));
 const deps=read('fixtures/benefits-nov-dependencies.sql');
 const blocks=deps.split(/(?=CREATE OR REPLACE FUNCTION public\.)/).filter(Boolean);
 for(const block of blocks)if(/FUNCTION public\.(get_cliente_oracle_balance|grant_cliente_oracle_credits|tc_ruleta_level_for_amount|tc_touch_roulette_signal|tc_evaluate_benefits|tc_ruleta_catalogo_v3|tc_ruleta_catalogo_v4|tc_register_call_with_payment)\(/.test(block))await db.exec(block);
 await db.exec('set check_function_bodies=on');
 await db.exec('create unique index fixture_delivery_key on tc_client_benefit_events(delivery_key) where delivery_key is not null;');
 await db.query("insert into crm_clientes(id,nombre,telefono,telefono_normalizado,puntos) values($1,'Legacy synthetic','000','000',1200)",[id(50)]);
 await db.query("insert into cliente_ruleta_giros(id,cliente_id,payment_key,source,nivel,created_at) values($1,$2,'legacy-fixture','fixture',1,'2026-09-01T12:00:00Z')",[id(51),id(50)]);
 await db.exec(migration);
 await db.query("insert into workers(id,user_id,role,display_name,is_active) values($1,$2,'central','Synthetic Central',true),($3,$4,'tarotista','Synthetic Reader',true)",[id(1),id(11),id(2),id(12)]);
 await db.query("insert into crm_new_tarotista_releases(tarotista_worker_id,source) values($1,'explicit_rollout')",[id(2)]);
});
after(async()=>{await db?.close()});
test('migration activates once and preserves the exact Special catalogue in Diamond',async()=>{
 const original=await scalar("select jsonb_agg(jsonb_build_array(name,reward_type,reward_value,weight,is_active) order by name) v from tc_client_roulette_rewards where nivel=4");
 const diamond=await scalar("select jsonb_agg(jsonb_build_array(name,reward_type,reward_value,weight,is_active) order by name) v from tc_client_roulette_rewards where nivel=5");
 assert.deepEqual(diamond,original);
 const before=await fn('tc_customer_benefits_config');await db.exec(migration);assert.equal((await fn('tc_customer_benefits_config')).activated_at,before.activated_at);
});
test('intro uses server amounts for all ranks and never credits on preview',async()=>{
 for(const [rank,minutes] of [['bronce',7],['plata',8],['oro',9],['diamante',12]]){const c=await client(rank,1200);const b=await wallet(c);const p=await fn('tc_new_tarotista_gift_preview',c);assert.equal(p.minutes,minutes);assert.equal(p.offers[0].consume_minutes,minutes);assert.deepEqual(await wallet(c),b);}
});
test('confirmed regular purchases grant 0/3/5/8 extra minutes and preserve other rank Coins',async()=>{
 for(const [rank,extra,coins] of [['bronce',0,50],['plata',3,50],['oro',5,50],['diamante',8,300]]){const c=await client(rank);const payment=await buy(c);assert.deepEqual(await wallet(c),{coins,free:extra,normal:20});await fn('tc_apply_purchase_benefits',payment.payment.id);assert.deepEqual(await wallet(c),{coins,free:extra,normal:20});}
});
test('Diamond Nada purchases keep 300 total Coins and only the purchased level wheels',async()=>{
 for(const [pack,amount,level,count] of [['pack_20',22,1,1],['pack_60',35,2,1],['pack_120',69,3,1],['pack_180',99,3,2]]){const c=await client('diamante',500);await buy(c,{pack_id:pack,amount,points:999,pricing_mode:'regular',purchase_classification:'nada'});assert.equal((await wallet(c)).coins,800);assert.equal((await wallet(c)).free,8);const spins=await scalar('select jsonb_agg(nivel) v from cliente_ruleta_giros where cliente_id=$1',[c]);assert.deepEqual(spins,Array(count).fill(level));}
});
test('redemptions use all four new prices and retry without another debit',async()=>{
 for(const [minutes,cost] of [[10,800],[20,1200],[30,1800],[60,3000]]){const c=await client('bronce',cost);const reward=await scalar('select id v from recompensas where minutos_otorgados=$1 limit 1',[minutes]),op=id(seq++);await fn('cliente_canjear_coins_minutos_v1',c,reward,op);await fn('cliente_canjear_coins_minutos_v1',c,reward,op);assert.deepEqual(await wallet(c),{coins:0,free:minutes,normal:0});}
});

test('Promo grants no Coins or roulette to any rank, even with native rewards and known package levels',async()=>{
 for(const rank of ['bronce','plata','oro','diamante']) for(const [pack,amount] of [['pack_20',22],['pack_60',35],['pack_120',69],[null,12]]) {
  const c=await client(rank,1200);
  const purchase=await buy(c,{pack_id:pack,amount,points:999,roulette_level:3,roulette_spins:2,pricing_mode:'regular',purchase_classification:'promo'});
  assert.deepEqual(await wallet(c),{coins:1200,free:0,normal:20});
  assert.equal(await scalar('select count(*)::int v from cliente_ruleta_giros where cliente_id=$1',[c]),0);
  await fn('tc_apply_purchase_benefits',purchase.payment.id);
  assert.equal((await wallet(c)).coins,1200);
 }
});

test('promotion catalogue suppresses rank Coins/spins and preserves Oracle configuration',async()=>{
 const key=await scalar("select package_key v from tc_purchase_package_levels where package_source='promotion' limit 1");
 assert.ok(key);
 for(const rank of ['bronce','plata','oro','diamante']) {
  const c=await client(rank);
  const quote=await fn('tc_resolve_rank_package_benefit',c,null,'promotion',key,null);
  assert.equal(quote.rank_benefits.coins,0);
  for(const field of ['roulette_level_1_spins','roulette_level_2_spins','roulette_level_3_spins','roulette_special_spins','roulette_diamond_spins']) assert.equal(quote.rank_benefits[field],0);
  assert.equal(quote.replaces_level_spin,false);
 }
});

test('Central Nada resolves levels by amount; Promo suppresses rewards and Super Promo keeps its special spin',async()=>{
 for(const [classification,amount,level] of [['nada',12,1],['nada',35,2],['nada',69,3],['promo',35,2],['super_promo_ruleta',35,2],['ruleta_diamante',12,1],['ruleta_diamante',35,2],['ruleta_diamante',69,3],['ruleta_diamante',99,3]]) {
  const c=await client('diamante',1200);
  const payload={operation_id:id(seq++),cliente_id:c,telefonista_worker_id:id(1),tarotista_worker_id:id(2),cliente_compra_minutos:true,tipo_registro:'compra',codigo_1:'CLIENTE',minutos_1:5,minutos_2:0,guarda_minutos:true,minutos_guardados_free:0,minutos_guardados_normales:15,importe:amount,forma_pago:'tpv',promo:classification==='promo',captado:false,recuperado:false,super_promo_ruleta:classification==='super_promo_ruleta',pricing_mode:classification==='promo'?'promotion':classification==='super_promo_ruleta'?'super_promo':'regular',purchase_classification:classification,points_to_add:0,purchase_benefits:{oracle_credits:0,roulette_level:level,roulette_spins:1},note_text:'Local fixture'};
  await fn('tc_register_call_minutes',JSON.stringify(payload));
  assert.equal((await wallet(c)).coins,['nada','ruleta_diamante'].includes(classification)?1500:1200);
  const spins=await scalar("select coalesce(jsonb_agg(nivel order by nivel),'[]') v from cliente_ruleta_giros where cliente_id=$1",[c]);
  assert.deepEqual(spins,classification==='nada'?[level]:classification==='ruleta_diamante'?[5]:classification==='promo'?[]:[4]);
  await fn('tc_register_call_minutes',JSON.stringify(payload));
  assert.equal((await wallet(c)).coins,['nada','ruleta_diamante'].includes(classification)?1500:1200);
 }
});

test('a stale catalogue quote never debits Coins; a confirmed retry survives a later price change',async()=>{
 const c=await client('bronce',800),reward=await scalar('select id v from recompensas where minutos_otorgados=10 limit 1'),op=id(seq++);
 await assert.rejects(fn('cliente_canjear_coins_minutos_v2',c,reward,op,500,10),/CATALOGO_ACTUALIZADO/);
 assert.deepEqual(await wallet(c),{coins:800,free:0,normal:0});
 await fn('cliente_canjear_coins_minutos_v2',c,reward,op,800,10);
 await db.exec('begin');
 try {
  await db.query('update recompensas set puntos_coste=900 where id=$1',[reward]);
  const replay=await fn('cliente_canjear_coins_minutos_v2',c,reward,op,800,10);
  assert.equal(replay.duplicated,true);
  assert.deepEqual(await wallet(c),{coins:0,free:10,normal:0});
 } finally { await db.exec('rollback'); }
});
test('two independent redemption requests cannot overdraw one balance',async()=>{const c=await client('bronce',800),r=await scalar('select id v from recompensas where minutos_otorgados=10 limit 1');const outcomes=await Promise.allSettled([fn('cliente_canjear_coins_minutos_v1',c,r,id(seq++)),fn('cliente_canjear_coins_minutos_v1',c,r,id(seq++))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(await wallet(c),{coins:0,free:10,normal:0});});
test('expiry rejects direct stale spin consumption and never changes 1200 Coins',async()=>{const c=await client('bronce',1200);const spin=await scalar("insert into cliente_ruleta_giros(cliente_id,payment_key,source,nivel,created_at) values($1,$2,'fixture',1,now()-interval '49 hours') returning id v",[c,id(seq++)]);await assert.rejects(fn('cliente_girar_ruleta_ultra_v1',c,spin,1),/SPIN_EXPIRED/);assert.equal((await wallet(c)).coins,1200);await assert.rejects(db.query("update cliente_ruleta_giros set estado='used' where id=$1",[spin]),/SPIN_EXPIRED/);assert.equal((await fn('cliente_ruleta_resumen_ultra_v1',c)).available_spins,0);});
test('Bronze never has a pass; old purchase and recent pass usage block new grants',async()=>{
 const bronze=await client('bronce');await buy(bronze);assert.equal((await fn('crm_free_pass_status',bronze)).available,0);
 for(const [rank,minutes] of [['plata',5],['oro',10],['diamante',12]]){const c=await client(rank);await buy(c);let s=await fn('crm_free_pass_status',c);assert.equal(s.available,1);assert.equal(s.minutes,minutes);await fn('crm_free_pass_use',c,id(1),id(seq++),s.cycle_start,s.used);s=await fn('crm_free_pass_status',c);assert.equal(s.available,0);await buy(c);assert.equal((await fn('crm_free_pass_status',c)).available,0);}
});
test('daily Diamond bonus is retired server-side',async()=>{const c=await client('diamante');assert.deepEqual(await fn('tc_available_rank_bonuses',c),[]);await assert.rejects(fn('tc_claim_rank_bonus',c,id(seq++)),/BONUS_NOT_ACTIVE/);});
test('automatic raffle grants exactly one rank number despite repeat purchases and Gold to Diamond',async()=>{
 const c=await client('oro');await db.query("insert into raffles(title,max_number,status) values('Fixture',10000,'active')");await fn('tc_assign_rank_raffle',c);await fn('tc_assign_rank_raffle',c);await db.query("update client_rank_overrides set assigned_rank='diamante' where client_id=$1",[c]);await buy(c);assert.equal(await scalar("select count(*)::int v from raffle_entries where client_id=$1 and benefit_origin='rank'",[c]),1);
});
test('legacy spin deadline is fixed, reruns never extend it or rewrite its creation date',async()=>{
 const before=await scalar('select to_jsonb(g) v from cliente_ruleta_giros g where id=$1',[id(51)]);
 assert.equal(Date.parse(before.expires_at),Date.parse('2026-11-04T02:55:09Z'));assert.equal(Date.parse(before.created_at),Date.parse('2026-09-01T12:00:00Z'));
 await db.exec(migration);assert.deepEqual(await scalar('select to_jsonb(g) v from cliente_ruleta_giros g where id=$1',[id(51)]),before);assert.equal((await wallet(id(50))).coins,1200);
});
test('pending payment from the old regime keeps 500 Coins even when confirmed now',async()=>{
 const c=await client('diamante'),ref='fixture:'+id(seq++);
 await db.query("insert into crm_cliente_pagos(cliente_id,importe,moneda,estado,metodo,referencia_externa,pack_id,created_at) values($1,22,'EUR','pending','fixture',$2,'pack_20',now()-interval '1 day')",[c,ref]);
 await buy(c,{payment_ref:ref});assert.equal((await wallet(c)).coins,500);assert.equal((await wallet(c)).free,15);
 await buy(c,{payment_ref:ref});assert.equal((await wallet(c)).coins,500);
});
test('a historic purchase beyond 30 days is not enough for a new pass',async()=>{
 const c=await client('plata');await buy(c);await db.query("update crm_cliente_pagos set created_at=now()-interval '31 days' where cliente_id=$1",[c]);const s=await fn('crm_free_pass_status',c);assert.equal(s.available,0);assert.equal(s.eligibility_reason,'NO_RECENT_PURCHASE');
});
test('old uses in the current cycle and a last grant crossing the cycle boundary both count',async()=>{
 const c=await client('oro');await buy(c);let s=await fn('crm_free_pass_status',c);
 await db.query("insert into crm_free_pass_uses(request_id,cliente_id,cycle_start,slot,minutes,worker_id,created_at) values($1,$2,$3,1,7,$4,now()-interval '2 days')",[id(seq++),c,s.cycle_start,id(1)]);
 assert.equal((await fn('crm_free_pass_status',c)).available,0);
 await db.query("update crm_free_pass_uses set cycle_start=cycle_start-interval '30 days' where cliente_id=$1",[c]);assert.equal((await fn('crm_free_pass_status',c)).available,0);
});
test('cofre grants and consumes once in the same transaction without touching existing balances',async()=>{
 const c=await client('plata');await db.query('update crm_clientes set minutos_free_pendientes=20,minutos_normales_pendientes=37 where id=$1',[c]);
 const request={operation_id:id(seq++),cliente_id:c,tarotista_worker_id:id(2),rank_free_expected_rank:'plata',rank_free_expected_minutes:8,rank_free_eligibility_key:id(2)};
 const result=await fn('tc_register_new_tarotista_gift',id(11),JSON.stringify(request));assert.ok(result.rendimiento.id);assert.equal(result.rank_free.minutes,8);
 await fn('tc_register_new_tarotista_gift',id(11),JSON.stringify(request));assert.deepEqual(await wallet(c),{coins:0,free:20,normal:37});
 await assert.rejects(fn('tc_register_new_tarotista_gift',id(11),JSON.stringify({...request,operation_id:id(seq++)})),/ALREADY_USED/);
 const offer=await fn('tc_new_tarotista_gift_offer',c,id(2));assert.equal(offer.remaining_minutes,0);assert.equal(offer.used_minutes,8);assert.equal(offer.call_id,result.rendimiento.id);
});
test('stale cofre rank cannot register or credit a consultation',async()=>{
 const c=await client('oro');await assert.rejects(fn('tc_register_new_tarotista_gift',id(11),JSON.stringify({operation_id:id(seq++),cliente_id:c,tarotista_worker_id:id(2),rank_free_expected_rank:'plata',rank_free_expected_minutes:8,rank_free_eligibility_key:id(2)})),/RANK_CHANGED/);assert.equal((await wallet(c)).free,0);
});
test('Diamond spin remains Diamond after downgrade and a new purchase follows its new rank',async()=>{
 const c=await client('diamante');await buy(c,{purchase_classification:'ruleta_diamante'});await db.query("update client_rank_overrides set assigned_rank='bronce' where client_id=$1",[c]);await buy(c);const summary=await fn('cliente_ruleta_resumen_ultra_v1',c);assert.equal(summary.level_5_spins,1);assert.equal(summary.diamond_access,true);assert.ok(summary.level_1_spins>0);
});
test('unprivileged callers cannot execute new granting helpers',async()=>{await db.exec('set role anon');try{await assert.rejects(fn('tc_assign_rank_raffle',id(50)),/permission denied/);await assert.rejects(fn('tc_customer_benefits_config'),/permission denied/);}finally{await db.exec('reset role');}});

test('checkout started before activation retains the legacy purchase regime',async()=>{
 const c=await client('diamante');await buy(c,{benefits_started_at:'2026-10-30T12:00:00Z'});
 assert.equal((await wallet(c)).coins,500);assert.equal((await wallet(c)).free,15);
});
test('a Diamond reward is credited exactly once and replay survives expiry and rank downgrade',async()=>{
 await db.exec('begin');
 try {
  await db.exec("update tc_client_roulette_rewards set is_active=false where nivel=5");
  await db.exec("update tc_client_roulette_rewards set is_active=true,weight=1,reward_value=10 where id=(select id from tc_client_roulette_rewards where nivel=5 and reward_type='coins' limit 1)");
  const c=await client('diamante');await buy(c,{purchase_classification:'ruleta_diamante'});
  const spin=await scalar("select id v from cliente_ruleta_giros where cliente_id=$1 and nivel=5",[c]);
  await db.query("update cliente_ruleta_giros set required_rank='diamante' where id=$1",[spin]);
  await db.query("update client_rank_overrides set assigned_rank='bronce' where client_id=$1",[c]);
  assert.equal((await fn('cliente_ruleta_resumen_ultra_v1',c)).level_5_spins,1);
  const first=await fn('cliente_girar_ruleta_ultra_v1',c,spin,5);assert.equal(first.reward_type,'coins');assert.equal((await wallet(c)).coins,310);
  await db.query("update cliente_ruleta_giros set expires_at=now()-interval '1 hour' where id=$1",[spin]);
  const replay=await fn('cliente_girar_ruleta_ultra_v1',c,spin,5);assert.equal(replay.replayed,true);assert.equal(replay.reward_id,first.reward_id);assert.equal((await wallet(c)).coins,310);
 }finally{await db.exec('rollback')}
});
test('the exact expiry instant is unavailable, while a later individual spin remains available',async()=>{
 const c=await client('bronce',1200);
 for(let i=0;i<2;i++)await db.query("insert into cliente_ruleta_giros(cliente_id,payment_key,source,nivel) values($1,$2,'fixture',1)",[c,id(seq++)]);
 const ids=(await db.query("select id from cliente_ruleta_giros where cliente_id=$1 order by created_at,id",[c])).rows;
 await db.exec('begin');
 try{
  await db.query("update cliente_ruleta_giros set expires_at=now() where id=$1",[ids[0].id]);
  assert.equal((await fn('cliente_ruleta_resumen_ultra_v1',c)).available_spins,ids.length-1);
 }finally{await db.exec('commit')}
 await assert.rejects(fn('cliente_girar_ruleta_ultra_v1',c,ids[0].id,1),/SPIN_EXPIRED/);
 assert.equal((await wallet(c)).coins,1200);
});
test('two staff operations cannot consume the same cofre and switching rank never adds a pass',async()=>{
 const c=await client('oro');await buy(c);const s=await fn('crm_free_pass_status',c);
 await fn('crm_free_pass_use',c,id(1),id(seq++),s.cycle_start,s.used);
 await db.query("update client_rank_overrides set assigned_rank='diamante' where client_id=$1",[c]);assert.equal((await fn('crm_free_pass_status',c)).available,0);
 await db.query("insert into workers(id,user_id,role,display_name,is_active) values($1,$2,'central','Synthetic second Central',true)",[id(4),id(14)]);
 const request={cliente_id:c,tarotista_worker_id:id(2),rank_free_expected_rank:'diamante',rank_free_expected_minutes:12,rank_free_eligibility_key:id(2)};
 const before=await wallet(c);
 const results=await Promise.allSettled([fn('tc_register_new_tarotista_gift',id(11),JSON.stringify({...request,operation_id:id(seq++)})),fn('tc_register_new_tarotista_gift',id(14),JSON.stringify({...request,operation_id:id(seq++)}))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(await wallet(c),before);
});

test('Diamond choice grants one exclusive spin and 300 Coins at every level and retry is idempotent',async()=>{
 for(const [pack,amount] of [['pack_20',22],['pack_60',35],['pack_120',69],['pack_180',99]]){
  const c=await client('diamante',700),ref='fixture:'+id(seq++);
  const p=await buy(c,{payment_ref:ref,pack_id:pack,amount,points:999,roulette_level:3,roulette_spins:50,purchase_classification:'ruleta_diamante'});
  assert.equal((await wallet(c)).coins,1000);
  assert.deepEqual(await scalar("select jsonb_agg(nivel) v from cliente_ruleta_giros where cliente_id=$1",[c]),[5]);
  await fn('tc_apply_purchase_benefits',p.payment.id);await buy(c,{payment_ref:ref,pack_id:pack,amount,purchase_classification:'ruleta_diamante'});
  assert.equal((await wallet(c)).coins,1000);
  assert.equal(await scalar('select count(*)::int v from cliente_ruleta_giros where cliente_id=$1',[c]),1);
 }
});
test('non-Diamond, promotional, manual and unmapped purchases cannot claim a Diamond choice',async()=>{
 for(const [rank,extra,error] of [
  ['bronce',{},'DIAMOND_ROULETTE_REQUIRES_DIAMOND'],['plata',{},'DIAMOND_ROULETTE_REQUIRES_DIAMOND'],['oro',{},'DIAMOND_ROULETTE_REQUIRES_DIAMOND'],
  ['diamante',{pricing_mode:'promotion'},'DIAMOND_ROULETTE_REQUIRES_REGULAR_PURCHASE'],
  ['diamante',{pricing_mode:'manual_amount'},'DIAMOND_ROULETTE_REQUIRES_REGULAR_PURCHASE'],
  ['diamante',{pack_id:'unknown',amount:1},'DIAMOND_ROULETTE_REQUIRES_REGULAR_PURCHASE']
 ]){
  const c=await client(rank,700),before=await wallet(c);
  await assert.rejects(buy(c,{purchase_classification:'ruleta_diamante',...extra}),new RegExp(error));
  assert.deepEqual(await wallet(c),before);
  assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[c]),0);
  assert.equal(await scalar('select count(*)::int v from cliente_ruleta_giros where cliente_id=$1',[c]),0);
 }
});
test('normal levels preserve non-Diamond Coins and the configured rank wheel grants',async()=>{
 for(const rank of ['bronce','plata','oro'])for(const [pack,amount,level,coins]of [['pack_20',22,1,50],['pack_60',35,2,150],['pack_120',69,3,300]]){
  const c=await client(rank,200),p=await buy(c,{pack_id:pack,amount,purchase_classification:'nada'});
  assert.equal((await wallet(c)).coins,200+coins);
  const spins=(await db.query('select nivel from cliente_ruleta_giros where cliente_id=$1',[c])).rows;
  assert.ok(spins.length>0);assert.ok(spins.every(x=>x.nivel===level));
  await fn('tc_apply_purchase_benefits',p.payment.id);assert.equal((await wallet(c)).coins,200+coins);
 }
});
test('Diamond catalogue advertises 300 Coins with native level wheels and an optional Diamond choice',async()=>{
 const c=await client('diamante');
 for(const pack of ['pack_20','pack_60','pack_120']){
  const q=await fn('tc_resolve_rank_package_benefit',c,null,'standard',pack,null);
  assert.equal(q.rank_benefits.coins,300);assert.equal(q.replaces_native_coins,true);
  assert.equal(q.replaces_level_spin,false);assert.equal(q.rank_benefits.roulette_diamond_spins,0);
  assert.equal(q.diamond_roulette_choice_available,true);
 }
});
test('reapplying the choice migration preserves wallets, purchases, events and spins',async()=>{
 const c=await client('diamante',200);await buy(c,{purchase_classification:'ruleta_diamante'});
 const snapshot=async()=>scalar("select jsonb_build_object('wallet',(select to_jsonb(c) from crm_clientes c where id=$1),'payments',(select jsonb_agg(to_jsonb(p) order by id) from crm_cliente_pagos p where cliente_id=$1),'spins',(select jsonb_agg(to_jsonb(g) order by id) from cliente_ruleta_giros g where cliente_id=$1),'events',(select jsonb_agg(to_jsonb(e) order by id) from tc_client_benefit_events e where cliente_id=$1)) v",[c]);
 const before=await snapshot();await db.exec(read('../supabase/migrations/20261103010836_customer_diamond_roulette_choice.sql'));assert.deepEqual(await snapshot(),before);
});
