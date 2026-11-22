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
