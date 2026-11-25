const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db, seq = 10000;
const fresh = () => id(++seq);
const row = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
const scalar = async (sql, params=[]) => (await row(sql,params)).v;
const client = async (n, extra={}) => {
  await db.query('insert into crm_clientes(id,auth_user_id,telefono,puntos,minutos_free_pendientes,minutos_normales_pendientes) values($1,$2,$3,5,7,9)',[id(n),extra.auth||id(n+1000000),extra.phone||`+1555${n}`]);
  return id(n);
};
const pay = async (n,amount,status='completed',call=null) => {
  const pid=fresh();await db.query("insert into crm_cliente_pagos(id,cliente_id,importe,estado,source_rendimiento_id,created_at) values($1,$2,$3,$4,$5,'2026-01-01')",[pid,id(n),amount,status,call]);return pid;
};
const link = (a,b,operation=fresh(),actor=1) => scalar('select tc_add_client_referral($1,$2,$3,$4,$5) v',[id(a),id(b),id(actor),id(actor+100),operation]);
async function reward(type,amount=10,extra={},rid=fresh(),expected=null,operation=fresh(),actor=1) {
  return scalar('select tc_save_referral_reward($1,$2,$3,$4,$5,$6) v',[rid,expected,{title:`Premio ${type}`,referrals_required:1,reward_type:type,amount,enabled:true,...extra},id(actor),id(actor+100),operation]);
}
const claim=(n,r,op=fresh(),uid=id(n+1000000)) => scalar('select tc_claim_referral_reward($1,$2,$3,$4,$5) v',[id(n),uid,r.id,r.version,op]);
const status=n=>db.query('select * from tc_client_referral_status($1)',[id(n)]).then(r=>r.rows);
async function eligible(a,b,amount=11){await client(a);await client(b);await pay(b,amount);await link(a,b);}

before(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id uuid unique,role text,is_active boolean,display_name text);
    create function tc_worker_has_admin_access(p uuid) returns boolean language sql stable as $$select exists(select 1 from public.workers where id=p and display_name='Delegated')$$;
    create table crm_clientes(id uuid primary key,auth_user_id uuid,telefono text,telefono_normalizado text,nombre text,apellido text,origen text,puntos integer default 0,minutos_free_pendientes integer default 0,minutos_normales_pendientes integer default 0,rango_actual text,updated_at timestamptz default now());
    create table rendimiento_llamadas(id uuid primary key,cliente_id text,importe numeric,created_at timestamptz default now(),fecha_hora timestamptz);
    create table crm_cliente_pagos(id uuid primary key,cliente_id uuid references crm_clientes(id),importe numeric,estado text,created_at timestamptz default now(),source_rendimiento_id uuid references rendimiento_llamadas(id));
    create index crm_pagos_client_idx on crm_cliente_pagos(cliente_id); create index crm_pagos_call_idx on crm_cliente_pagos(source_rendimiento_id);
    create table cliente_puntos_historial(id uuid primary key default gen_random_uuid(),cliente_id uuid references crm_clientes(id),tipo text,puntos integer,descripcion text,operation_id uuid unique,saldo_despues integer,meta jsonb);
    create table cliente_oracle_credit_movements(id uuid primary key default gen_random_uuid(),cliente_id uuid references crm_clientes(id),amount integer check(amount<>0),movement_type text check(movement_type in('purchase','draw','adjustment')),reference text unique,notes text,meta jsonb);
    create function get_cliente_oracle_balance(p_cliente_id uuid) returns integer language sql stable as $$select coalesce(sum(amount),0)::integer from public.cliente_oracle_credit_movements where cliente_id=p_cliente_id$$;
    create table cliente_ruleta_giros(id uuid primary key default gen_random_uuid(),cliente_id uuid references crm_clientes(id),payment_key text unique,source text,nivel smallint check(nivel between 1 and 5),estado text check(estado in('pending','used','revoked')),required_rank text);
    create table cliente_ruleta_signal(cliente_id uuid primary key,updated_at timestamptz);
    create table crm_client_notes(id uuid primary key default gen_random_uuid(),cliente_id text,texto text,author_user_id uuid,author_name text,event_type text,event_data jsonb,is_pinned boolean);
    create table cliente_notificaciones(id uuid primary key default gen_random_uuid(),cliente_id uuid,tipo text,titulo text,mensaje text,leida boolean,meta jsonb,created_at timestamptz);
    create table tc_client_rank_benefits(rank_key text primary key,min_spend numeric,sort_order integer);
    insert into tc_client_rank_benefits values('bronce',0,0),('plata',100,1),('oro',500,2),('diamante',1000,3);
    create table client_rank_overrides(id uuid primary key default gen_random_uuid(),client_id uuid references crm_clientes(id),business text,assigned_rank text,intervention_type text,starts_at timestamptz,ends_at timestamptz,reason text,notes text,active boolean,automatic_rank_at_creation text,previous_effective_rank text,created_by uuid references workers(id),created_at timestamptz default now(),restored_by uuid,restored_at timestamptz,updated_at timestamptz default now());
    create table client_rank_override_audit(override_id uuid,client_id uuid,business text,action text,automatic_rank text,previous_effective_rank text,new_effective_rank text,intervention_type text,reason text,notes text,starts_at timestamptz,ends_at timestamptz,actor_worker_id uuid);
    insert into workers values('${id(1)}','${id(101)}','admin',true,'Admin'),('${id(2)}','${id(102)}','central',true,'Central'),('${id(3)}','${id(103)}','tarotista',true,'Reader'),('${id(4)}','${id(104)}','admin',false,'Inactive'),('${id(5)}','${id(105)}','central',true,'Delegated');
    grant usage on schema public to service_role; grant all on all tables in schema public to service_role;
  `);
  // Exact dependency definitions inspected read-only in production. No real data.
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/referral-production-dependencies.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261122054306_client_referral_rewards.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261124144159_referral_reward_bundles.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261125145838_referral_claim_history.sql'),'utf8'));
});
after(async()=>{await db?.close();});

test('browser roles have no grants and all referral tables enforce RLS',async()=>{
  const rows=(await db.query(`select relname,relrowsecurity,has_table_privilege('authenticated',oid,'SELECT') client_read,has_table_privilege('authenticated',oid,'INSERT') client_write from pg_class where relname in('client_referral_rewards','client_referral_reward_events','client_referral_claims','client_referrals') order by relname`)).rows;
  assert.equal(rows.length,4);for(const r of rows){assert.equal(r.relrowsecurity,true);assert.equal(r.client_read,false);assert.equal(r.client_write,false);}
  assert.equal(await scalar("select has_function_privilege('anon','tc_claim_referral_reward(uuid,uuid,uuid,integer,uuid)','EXECUTE') v"),false);
  assert.equal(await scalar("select has_function_privilege('authenticated','tc_add_client_referral(uuid,uuid,uuid,uuid,uuid)','EXECUTE') v"),false);
});
test('catalog validates boundaries, authorizes admin/delegated only, optimistic version and idempotency',async()=>{
  for(const actor of [2,3,4])await assert.rejects(reward('coins',10,{},fresh(),null,fresh(),actor),/REFERRAL_FORBIDDEN/);
  for(const [type,amount,extra] of [['coins',0,{}],['coins',1.5,{}],['oracle',101,{}],['rank',1,{rank_days:4}],['rank',1,{rank_key:'oro',rank_days:0}],['roulette',1,{roulette_level:6}]])await assert.rejects(reward(type,amount,extra));
  const rid=fresh(),op=fresh();const r=await reward('coins',10,{},rid,null,op,5);
  assert.deepEqual(await reward('coins',10,{},rid,null,op,5),r);
  await assert.rejects(reward('coins',11,{},rid,null,op,5),/REFERRAL_OPERATION_REUSED/);
  const edited=await reward('coins',12,{},rid,1);assert.equal(edited.version,2);
  await assert.rejects(reward('coins',20,{},rid,1),/REFERRAL_REWARD_CHANGED/);
});
test('central can link, same person and duplicate links/cycles are rejected, retries return same link',async()=>{
  await client(10);await client(11);await client(12);await client(13,{phone:'+1 (555) 10'});await client(14,{auth:id(1000010)});
  await assert.rejects(link(10,11,fresh(),3),/REFERRAL_FORBIDDEN/);
  for(const b of [10,13,14])await assert.rejects(link(10,b),/REFERRAL_SELF/);
  const op=fresh();const r=await link(10,11,op,2);assert.deepEqual(await link(10,11,op,2),r);
  await assert.rejects(link(12,11),/REFERRAL_ALREADY_LINKED/);
  await assert.rejects(link(10,12,op,2),/REFERRAL_OPERATION_REUSED/);
  await link(11,12);await assert.rejects(link(12,10),/REFERRAL_CYCLE/);
});
test('qualification requires strictly over10 cumulative confirmed purchases and ignores failed/refunded evidence',async()=>{
  await client(20);await client(21);await client(22);await client(23);
  await link(20,21);await link(20,22);await link(20,23);
  await pay(21,4);await pay(21,6);await pay(21,50,'pending');await pay(21,50,'refunded');
  const call=fresh();await db.query("insert into rendimiento_llamadas values($1,$2,20,'2026-01-01','2026-01-01')",[call,id(22)]);
  const payment=await pay(22,20,'completed',call);
  const cancelled=fresh();await db.query("insert into rendimiento_llamadas values($1,$2,30,'2026-01-01','2026-01-01')",[cancelled,id(23)]);
  await pay(23,30,'refunded',cancelled);
  let rows=await status(20);assert.equal(rows.find(r=>r.referred_id===id(21)).status,'pending');assert.equal(rows.find(r=>r.referred_id===id(21)).paid_total,'10');
  assert.equal(rows.find(r=>r.referred_id===id(22)).paid_total,'20');assert.equal(rows.find(r=>r.referred_id===id(23)).paid_total,'0');
  await pay(21,0.01);assert.equal((await status(20)).find(r=>r.referred_id===id(21)).status,'available');
  await db.query("update crm_cliente_pagos set estado='refunded' where id=$1",[payment]);
  assert.equal((await status(20)).find(r=>r.referred_id===id(22)).status,'pending');
});
test('coins claim consumes exact eligible referrals, credits real balance+ledger, repeated operations cannot double grant',async()=>{
  await client(30);for(const n of [31,32,33,34]){await client(n);await link(30,n);await pay(n,n===34?10:11);}
  const r=await reward('coins',300,{referrals_required:3}),op=fresh();
  const receipt=await claim(30,r,op);assert.equal(receipt.after_balance,305);assert.equal(receipt.referrals_used,3);
  assert.equal(await scalar('select puntos v from crm_clientes where id=$1',[id(30)]),305);
  assert.equal(await scalar('select count(*)::int v from cliente_puntos_historial where cliente_id=$1',[id(30)]),1);
  const replay=await claim(30,r,op);assert.equal(replay.replayed,true);assert.equal(replay.claim_id,receipt.claim_id);
  await assert.rejects(claim(30,r),/REFERRAL_NOT_ENOUGH/);
  await assert.rejects(claim(30,{...r,version:2},op),/REFERRAL_OPERATION_REUSED/);
  const rows=await status(30);assert.equal(rows.filter(r=>r.status==='claimed').length,3);assert.equal(rows.filter(r=>r.status==='pending').length,1);
  const claimRow=await row('select * from client_referral_claims where id=$1',[op]);assert.equal(claimRow.referral_ids.length,3);assert.equal(claimRow.reward_snapshot.amount,300);
  assert.equal(await scalar('select count(*)::int v from crm_client_notes where cliente_id=$1 and event_type=$2',[id(30),'referral_reward_claimed']),1);
  assert.equal(await scalar('select count(*)::int v from cliente_notificaciones where cliente_id=$1',[id(30)]),1);
  assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[id(30)]),0);
});
test('different concurrent claim operations cannot spend the same referral',async()=>{
  await eligible(40,41);const r=await reward('coins',25);
  const results=await Promise.allSettled([claim(40,r),claim(40,r)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await scalar('select puntos v from crm_clientes where id=$1',[id(40)]),30);
});
test('owner binding, stale reward and disabled reward never consume referrals',async()=>{
  await eligible(50,51);const r=await reward('coins',30);
  await assert.rejects(claim(50,r,fresh(),id(1000051)),/REFERRAL_FORBIDDEN/);
  const disabled=await reward('coins',30,{enabled:false},r.id,r.version);
  await assert.rejects(claim(50,disabled),/REFERRAL_REWARD_UNAVAILABLE/);
  const enabled=await reward('coins',30,{},r.id,disabled.version);
  await assert.rejects(claim(50,r),/REFERRAL_REWARD_CHANGED/);
  assert.equal((await status(50))[0].status,'available');await claim(50,enabled);
});
test('free and normal minutes update their own canonical balances only',async()=>{
  for(const [a,b,type,field,expected] of [[60,61,'free_minutes','minutos_free_pendientes',22],[62,63,'normal_minutes','minutos_normales_pendientes',24]]){
    await eligible(a,b);await claim(a,await reward(type,15));
    const c=await row('select puntos,minutos_free_pendientes,minutos_normales_pendientes from crm_clientes where id=$1',[id(a)]);
    assert.equal(c[field],expected);assert.equal(c.puntos,5);assert.equal(c[type==='free_minutes'?'minutos_normales_pendientes':'minutos_free_pendientes'],type==='free_minutes'?9:7);
  }
});
test('Oracle credit and every roulette level use existing spendable ledgers with unique references',async()=>{
  await eligible(70,71);await claim(70,await reward('oracle',2));
  const oracle=await row('select * from cliente_oracle_credit_movements where cliente_id=$1',[id(70)]);assert.equal(oracle.movement_type,'adjustment');assert.equal(oracle.amount,2);
  assert.equal(await scalar('select get_cliente_oracle_balance($1) v',[id(70)]),2);
  for(const level of [1,2,3,4,5]){const a=80+level*2;await eligible(a,a+1);await claim(a,await reward('roulette',2,{roulette_level:level}));
    const spins=(await db.query('select * from cliente_ruleta_giros where cliente_id=$1',[id(a)])).rows;
    assert.equal(spins.length,2);for(const spin of spins){assert.equal(spin.nivel,level);assert.equal(spin.estado,'pending');assert.equal(spin.required_rank,level===5?'diamante':null);}
  }
});
test('temporary rank uses existing override/audit engine and will not replace stronger or admin ranks',async()=>{
  await eligible(100,101);const r=await reward('rank',1,{rank_key:'oro',rank_days:7});const receipt=await claim(100,r);
  assert.equal(receipt.rank_key,'oro');assert.equal(await scalar("select tc_client_rank_state($1)->>'effective' v",[id(100)]),'oro');
  const override=await row('select * from client_rank_overrides where client_id=$1',[id(100)]);assert.equal(override.intervention_type,'temporary');assert.equal((new Date(override.ends_at)-new Date(override.starts_at))/86400000,7);
  await client(102);await pay(102,12);await link(100,102);
  await assert.rejects(claim(100,await reward('rank',1,{rank_key:'diamante',rank_days:1})),/REFERRAL_RANK_CONFLICT/);
  assert.equal((await status(100)).find(r=>r.referred_id===id(102)).status,'available');
  assert.equal((await row('select * from client_rank_overrides where client_id=$1',[id(100)])).id,override.id);
  await eligible(110,111);const recentPayment=await pay(110,1000);
  await db.query('update crm_cliente_pagos set created_at=now() where id=$1',[recentPayment]);
  await assert.rejects(claim(110,r),/REFERRAL_RANK_CONFLICT/);
});
test('delivery failure rolls back claim, consumption and balance together; retry can succeed',async()=>{
  await eligible(120,121);const r=await reward('oracle',4),op=fresh();
  await db.exec("create function fail_referral_oracle() returns trigger language plpgsql as $$begin raise exception 'TEST_DELIVERY_FAIL';end$$; create trigger fail_referral_oracle before insert on cliente_oracle_credit_movements for each row execute function fail_referral_oracle();");
  await assert.rejects(claim(120,r,op),/TEST_DELIVERY_FAIL/);
  assert.equal(await scalar('select count(*)::int v from client_referral_claims where id=$1',[op]),0);assert.equal((await status(120))[0].status,'available');
  await db.exec('drop trigger fail_referral_oracle on cliente_oracle_credit_movements;');
  await claim(120,r,op);assert.equal((await status(120))[0].status,'claimed');
});
test('refund before claim disqualifies; refund after delivered claim preserves immutable receipt',async()=>{
  await client(130);await client(131);await link(130,131);const pid=await pay(131,15),r=await reward('coins',20);
  await db.query("update crm_cliente_pagos set estado='refunded' where id=$1",[pid]);await assert.rejects(claim(130,r),/REFERRAL_NOT_ENOUGH/);
  await db.query("update crm_cliente_pagos set estado='completed' where id=$1",[pid]);const op=fresh(),receipt=await claim(130,r,op);
  await db.query("update crm_cliente_pagos set estado='refunded' where id=$1",[pid]);assert.equal((await status(130))[0].status,'claimed');
  const replay=await claim(130,r,op);assert.equal(replay.after_balance,receipt.after_balance);assert.equal(replay.replayed,true);
});
test('service role can execute the complete catalog, link, status and claim contract with invoker permissions',async()=>{
  await client(140);await client(141);await pay(141,12);
  await db.exec('set role service_role');
  try {
    const r=await reward('coins',8);
    await link(140,141);
    assert.equal((await status(140))[0].status,'available');
    assert.equal((await claim(140,r)).after_balance,13);
    assert.equal((await status(140))[0].status,'claimed');
  } finally {await db.exec('reset role');}
});

const benefit = (reward_type, amount, extra={}) => ({reward_type,amount,...extra});
const bundle = (items,extra={},rid=fresh(),expected=null,operation=fresh()) => reward('free_minutes',15,{title:'Premio combinado',reward_items:items,...extra},rid,expected,operation);

test('bundle normalizer rejects empty, duplicate and out-of-range items while allowing distinct roulette levels',async()=>{
  const normalize=items=>scalar('select tc_referral_reward_items($1) v',[items]);
  const invalid=[null,{},[],Array.from({length:11},()=>benefit('coins',1)),[benefit('coins',0)],
    [benefit('coins',1.5)],[benefit('coins',1000001)],[benefit('free_minutes',10001)],
    [benefit('normal_minutes',10001)],[benefit('oracle',101)],[benefit('roulette',1,{roulette_level:6})],
    [benefit('rank',1,{rank_key:'oro',rank_days:366})],[benefit('rank',2,{rank_key:'oro',rank_days:1})],
    [benefit('coins',10),benefit('coins',20)],
    [benefit('roulette',1,{roulette_level:2}),benefit('roulette',2,{roulette_level:2})],
    [benefit('rank',1,{rank_key:'oro',rank_days:1}),benefit('rank',1,{rank_key:'diamante',rank_days:2})]];
  for(const items of invalid)await assert.rejects(normalize(items),/REFERRAL_INVALID_REWARD/);
  const items=await normalize([benefit('roulette',1,{roulette_level:1}),benefit('roulette',2,{roulette_level:5})]);
  assert.equal(items.length,2);assert.equal(items[0].roulette_level,1);assert.equal(items[1].roulette_level,5);
  await assert.rejects(bundle([]),/REFERRAL_INVALID_REWARD/);
});

test('a bundle delivers every canonical balance and roulette level but consumes its referral cost only once',async()=>{
  await eligible(200,201);
  const items=[benefit('free_minutes',15),benefit('normal_minutes',6),benefit('coins',30),benefit('oracle',2),
    ...[1,2,3,4,5].map(level=>benefit('roulette',level===2?2:1,{roulette_level:level})),
    benefit('rank',1,{rank_key:'diamante',rank_days:7})];
  const r=await bundle(items),op=fresh();
  const receipt=await claim(200,r,op);
  assert.equal(receipt.referrals_used,1);assert.equal(receipt.reward_items.length,10);
  assert.equal(receipt.reward_type,'free_minutes');assert.equal(receipt.after_balance,22);
  const balances=await row('select puntos,minutos_free_pendientes,minutos_normales_pendientes from crm_clientes where id=$1',[id(200)]);
  assert.deepEqual(balances,{puntos:35,minutos_free_pendientes:22,minutos_normales_pendientes:15});
  assert.equal(await scalar('select get_cliente_oracle_balance($1) v',[id(200)]),2);
  assert.equal(await scalar("select tc_client_rank_state($1)->>'effective' v",[id(200)]),'diamante');
  const spins=(await db.query('select nivel,count(*)::int n from cliente_ruleta_giros where cliente_id=$1 group by nivel order by nivel',[id(200)])).rows;
  assert.deepEqual(spins,[{nivel:1,n:1},{nivel:2,n:2},{nivel:3,n:1},{nivel:4,n:1},{nivel:5,n:1}]);
  assert.equal(await scalar('select count(*)::int v from cliente_puntos_historial where cliente_id=$1',[id(200)]),1);
  assert.equal(await scalar('select count(*)::int v from cliente_oracle_credit_movements where cliente_id=$1',[id(200)]),1);
  assert.equal(await scalar('select count(*)::int v from client_referral_claims where cliente_id=$1',[id(200)]),1);
  assert.equal(await scalar('select count(*)::int v from client_referrals where claimed_by=$1',[op]),1);
  assert.equal(await scalar('select count(*)::int v from cliente_notificaciones where cliente_id=$1',[id(200)]),1);
  const stored=await row('select reward_snapshot,receipt from client_referral_claims where id=$1',[op]);
  assert.deepEqual(stored.reward_snapshot.reward_items,r.reward_items);
  assert.deepEqual(stored.receipt.reward_items,receipt.reward_items);
});

test('bundle replay and concurrent retries do not duplicate any component or consume another referral',async()=>{
  await eligible(210,211);await client(212);await pay(212,12);await link(210,212);
  const r=await bundle([benefit('coins',30),benefit('oracle',2),benefit('roulette',2,{roulette_level:3})]),op=fresh();
  const first=await claim(210,r,op);
  const replays=await Promise.all([claim(210,r,op),claim(210,r,op)]);
  for(const receipt of replays){assert.equal(receipt.replayed,true);assert.deepEqual(receipt.reward_items,first.reward_items);}
  assert.equal(await scalar('select puntos v from crm_clientes where id=$1',[id(210)]),35);
  assert.equal(await scalar('select get_cliente_oracle_balance($1) v',[id(210)]),2);
  assert.equal(await scalar('select count(*)::int v from cliente_ruleta_giros where cliente_id=$1',[id(210)]),2);
  assert.equal((await status(210)).filter(r=>r.status==='available').length,1);
  assert.equal((await status(210)).filter(r=>r.status==='claimed').length,1);
});

test('a late component failure rolls back earlier balances, ledgers, receipt and consumption; same operation can retry',async()=>{
  await eligible(220,221);
  const r=await bundle([benefit('free_minutes',15),benefit('coins',30),benefit('roulette',2,{roulette_level:1}),benefit('oracle',2)]),op=fresh();
  await db.exec("create function fail_bundle_oracle() returns trigger language plpgsql as $$begin raise exception 'TEST_BUNDLE_DELIVERY_FAIL';end$$; create trigger fail_bundle_oracle before insert on cliente_oracle_credit_movements for each row execute function fail_bundle_oracle();");
  try{await assert.rejects(claim(220,r,op),/TEST_BUNDLE_DELIVERY_FAIL/);}finally{await db.exec('drop trigger fail_bundle_oracle on cliente_oracle_credit_movements;');}
  assert.equal(await scalar('select puntos v from crm_clientes where id=$1',[id(220)]),5);
  assert.equal(await scalar('select minutos_free_pendientes v from crm_clientes where id=$1',[id(220)]),7);
  for(const table of ['cliente_puntos_historial','cliente_oracle_credit_movements','cliente_ruleta_giros','client_referral_claims','cliente_notificaciones'])
    assert.equal(await scalar(`select count(*)::int v from ${table} where cliente_id=$1`,[id(220)]),0);
  assert.equal((await status(220))[0].status,'available');
  const receipt=await claim(220,r,op);assert.equal(receipt.reward_items.length,4);assert.equal(receipt.referrals_used,1);
  assert.equal((await status(220))[0].status,'claimed');
});

test('catalog changes never change the bundle or quantities stored in an earlier claim',async()=>{
  await eligible(230,231);
  const original=await bundle([benefit('free_minutes',15),benefit('coins',30)]),op=fresh();
  const receipt=await claim(230,original,op);
  const edited=await bundle([benefit('free_minutes',20),benefit('coins',50)],{title:'Premio actualizado'},original.id,original.version);
  assert.equal(edited.version,2);
  const stored=await row('select reward_snapshot,receipt from client_referral_claims where id=$1',[op]);
  assert.equal(stored.reward_snapshot.title,'Premio combinado');assert.equal(stored.reward_snapshot.version,1);
  assert.deepEqual(stored.reward_snapshot.reward_items,original.reward_items);
  assert.deepEqual(stored.receipt.reward_items,receipt.reward_items);
  assert.equal((await claim(230,original,op)).replayed,true);
  await assert.rejects(claim(230,edited,op),/REFERRAL_OPERATION_REUSED/);
});

test('legacy singleton catalog rows remain claimable while old admin payloads cannot overwrite a bundle',async()=>{
  await eligible(240,241);
  const single=await reward('coins',25);
  await db.query('update client_referral_rewards set reward_items=null where id=$1',[single.id]);
  const legacyReceipt=await claim(240,single);
  assert.equal(legacyReceipt.after_balance,30);assert.equal(legacyReceipt.reward_items.length,1);
  assert.equal(legacyReceipt.reward_items[0].reward_type,'coins');
  const r=await bundle([benefit('free_minutes',15),benefit('coins',30)]);
  await assert.rejects(reward('free_minutes',20,{},r.id,r.version),/REFERRAL_REWARD_CHANGED/);
  const saved=await row('select version,reward_items from client_referral_rewards where id=$1',[r.id]);
  assert.equal(saved.version,r.version);assert.deepEqual(saved.reward_items,r.reward_items);
});

test('bundle normalizer is service-only, invoker based, and a service-role bundle can be delivered',async()=>{
  const grants=await row("select has_function_privilege('anon','tc_referral_reward_items(jsonb)','EXECUTE') anon,has_function_privilege('authenticated','tc_referral_reward_items(jsonb)','EXECUTE') client,has_function_privilege('service_role','tc_referral_reward_items(jsonb)','EXECUTE') service");
  assert.deepEqual(grants,{anon:false,client:false,service:true});
  const functions=(await db.query("select proname,prosecdef from pg_proc where proname in ('tc_referral_reward_items','tc_save_referral_reward','tc_claim_referral_reward')")).rows;
  for(const fn of functions)assert.equal(fn.prosecdef,false);
  await eligible(250,251);
  await db.exec('set role service_role');
  try{
    const r=await bundle([benefit('free_minutes',15),benefit('coins',30)]);
    const receipt=await claim(250,r);assert.equal(receipt.reward_items.length,2);assert.equal(receipt.referrals_used,1);
  }finally{await db.exec('reset role');}
});

const history = ({query=null,rewardId=null,from=null,to=null,offset=0,limit=25}={}) =>
  scalar('select tc_admin_referral_claim_history($1,$2,$3,$4,$5,$6) v',[query,rewardId,from,to,offset,limit]);

test('admin history searches literal full names and normalized phones with stable pagination and exclusive end dates',async()=>{
  const r=await bundle([benefit('free_minutes',15),benefit('coins',30)]);
  const alternative=await reward('oracle',2);
  const claims=[];
  const people=[
    {n:300,nombre:'María José',apellido:'Pérez Historial',phone:'+1 (787) 555-0123',normal:'17875550123',at:'2026-11-25T09:00:00Z',reward:r},
    {n:310,nombre:'Ana',apellido:'Vega Historial',phone:'+34 600 123 456',normal:'34600123456',at:'2026-11-25T09:00:00Z',reward:r},
    {n:320,nombre:'Literal % _',apellido:'Historial',phone:'+1 787 555 0199',normal:null,at:'2026-11-24T23:00:00Z',reward:alternative},
  ];
  for(const p of people){
    await eligible(p.n,p.n+1);
    await db.query('update crm_clientes set nombre=$1,apellido=$2,telefono=$3,telefono_normalizado=$4 where id=$5',[p.nombre,p.apellido,p.phone,p.normal,id(p.n)]);
    const receipt=await claim(p.n,p.reward);claims.push(receipt);
    await db.query('update client_referral_claims set created_at=$1 where id=$2',[p.at,receipt.claim_id]);
  }
  const all=await history({query:'historial'});
  assert.equal(all.total,3);assert.equal(all.offset,0);assert.equal(all.limit,25);
  assert.deepEqual(all.claims.map(c=>c.id),[claims[1].claim_id,claims[0].claim_id,claims[2].claim_id]);
  const page=await history({query:'historial',offset:1,limit:1});
  assert.equal(page.total,3);assert.equal(page.claims.length,1);assert.equal(page.claims[0].id,claims[0].claim_id);
  assert.equal(page.claims[0].cliente_id,id(300));assert.equal(page.claims[0].client_name,'María José Pérez Historial');
  assert.equal(page.claims[0].client_phone,'+1 (787) 555-0123');assert.equal(page.claims[0].referrals_used,1);
  assert.deepEqual(page.claims[0].reward_snapshot.reward_items,r.reward_items);
  assert.equal((await history({query:'historial',offset:100,limit:1})).total,3);
  assert.deepEqual((await history({query:'historial',offset:100,limit:1})).claims,[]);
  assert.equal((await history({query:'MARÍA   JOSÉ   PÉREZ'})).claims[0].id,claims[0].claim_id);
  assert.equal((await history({query:'+1 (787) 555-0123'})).claims[0].id,claims[0].claim_id);
  assert.equal((await history({query:'7875550199'})).claims[0].id,claims[2].claim_id);
  const literal=await history({query:'% _'});assert.equal(literal.total,1);assert.equal(literal.claims[0].id,claims[2].claim_id);
  assert.equal((await history({query:'historial',rewardId:r.id})).total,2);
  assert.equal((await history({query:'historial',from:'2026-11-25T00:00:00Z',to:'2026-11-26T00:00:00Z'})).total,2);
  assert.equal((await history({query:'historial',from:'2026-11-24T23:00:00Z',to:'2026-11-25T09:00:00Z'})).total,1);
  assert.equal((await history({query:'historial',from:'2026-11-25T09:00:00Z'})).total,2);
  assert.deepEqual((await history({query:'no such customer 99999999'})).claims,[]);
});

test('admin history keeps original bundle snapshots after catalog edits and supports legacy singleton receipts',async()=>{
  await eligible(330,331);
  const original=await bundle([benefit('free_minutes',15),benefit('coins',30)]),op=fresh();
  await claim(330,original,op);
  await bundle([benefit('free_minutes',20),benefit('coins',50)],{title:'Cambió el catálogo',referrals_required:2},original.id,original.version);
  const delivered=(await history({rewardId:original.id})).claims[0];
  assert.equal(delivered.reward_snapshot.title,'Premio combinado');assert.equal(delivered.referrals_used,1);
  assert.deepEqual(delivered.reward_snapshot.reward_items,original.reward_items);
  assert.deepEqual(delivered.receipt.reward_items.map(item=>item.amount),[15,30]);

  await eligible(340,341);
  const single=await reward('coins',25),legacy=await claim(340,single);
  // Historical records predating bundles retain their scalar snapshot/receipt.
  await db.query("update client_referral_claims set reward_snapshot=reward_snapshot-'reward_items'-'referrals_required',receipt=receipt-'reward_items' where id=$1",[legacy.claim_id]);
  const before=await row('select reward_snapshot,receipt from client_referral_claims where id=$1',[legacy.claim_id]);
  const legacyRow=(await history({rewardId:single.id})).claims[0];
  assert.equal(legacyRow.referrals_used,1);assert.equal(legacyRow.reward_snapshot.reward_type,'coins');
  assert.equal(legacyRow.reward_snapshot.amount,25);assert.equal('reward_items' in legacyRow.reward_snapshot,false);
  assert.deepEqual(legacyRow.reward_snapshot,before.reward_snapshot);assert.deepEqual(legacyRow.receipt,before.receipt);
});

test('admin history is read-only service-only and validates bounds before reading customer data',async()=>{
  for(const bad of [{offset:-1},{offset:null},{limit:0},{limit:101},{limit:null},{query:'x'.repeat(201)},
    {from:'2026-11-25T00:00:00Z',to:'2026-11-24T00:00:00Z'},
    {from:'2026-11-25T00:00:00Z',to:'2026-11-25T00:00:00Z'}])
    await assert.rejects(history(bad),/REFERRAL_INVALID_HISTORY_FILTER/);
  const signature='tc_admin_referral_claim_history(text,uuid,timestamptz,timestamptz,integer,integer)';
  const privileges=await row("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') client,has_function_privilege('service_role',$1,'EXECUTE') service",[signature]);
  assert.deepEqual(privileges,{anon:false,client:false,service:true});
  const fn=await row("select prosecdef,provolatile from pg_proc where proname='tc_admin_referral_claim_history'");
  assert.equal(fn.prosecdef,false);assert.equal(fn.provolatile,'s');
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    try{await assert.rejects(history(),/permission denied/);}finally{await db.exec('reset role');}
  }
  await db.exec('set role service_role');
  try{const result=await history({limit:1});assert.equal(result.claims.length,1);assert.ok(result.total>0);}
  finally{await db.exec('reset role');}
});
