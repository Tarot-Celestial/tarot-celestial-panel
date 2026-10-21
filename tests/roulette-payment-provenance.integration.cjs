const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// The actual production RPC is exercised, including its reward writes and FK.
// Only the separate rank, active-campaign and summary dependencies are stubs.
// PGlite serializes queries: these tests establish replay safety, not a load test.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const legacy = fs.readFileSync(path.join(__dirname, 'fixtures/roulette-spin-production-before.sql'), 'utf8');
const dir = path.join(__dirname, '../supabase/migrations');
const migration = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('_fix_roulette_legacy_payment_reference.sql'))), 'utf8');
let db, originalAccess, patchedAccess;
const value = async (sql, params = []) => (await db.query(sql, params)).rows[0].value;
const spin = (spinId = 10, clientId = 1, level = 1) => value(
  'select public.cliente_girar_ruleta_ultra_v1($1::uuid,$2::uuid,$3::smallint) as value',
  [id(clientId), id(spinId), level],
);
const payment = (paymentId, clientId = 1, callId = null, status = 'completed') => db.query(
  'insert into crm_cliente_pagos(id,cliente_id,source_rendimiento_id,estado) values($1,$2,$3,$4)',
  [id(paymentId), id(clientId), callId === null ? null : id(callId), status],
);
const pending = (spinId = 10, purchaseId = null, source = 'admin_adjustment', key = null, clientId = 1, level = 1, rank = null) => db.query(
  'insert into cliente_ruleta_giros(id,cliente_id,nivel,estado,purchase_id,source,payment_key,required_rank) values($1,$2,$3,\'pending\',$4,$5,$6,$7)',
  [id(spinId), id(clientId), level, purchaseId === null ? null : id(purchaseId), source, key, rank],
);
const event = () => value('select to_jsonb(e) as value from tc_client_benefit_events e');
const access = () => value(`select jsonb_build_object('owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) as value
  from pg_proc where oid='public.cliente_girar_ruleta_ultra_v1(uuid,uuid,smallint)'::regprocedure`);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table crm_clientes(id uuid primary key,puntos integer default 0,minutos_free_pendientes integer default 0,updated_at timestamptz);
    create table crm_cliente_pagos(id uuid primary key,cliente_id uuid references crm_clientes(id),source_rendimiento_id uuid,estado text);
    create table cliente_ruleta_giros(
      id uuid primary key,cliente_id uuid references crm_clientes(id),nivel smallint,estado text,required_rank text,
      purchase_id uuid,source text,payment_key text,used_at timestamptz,campaign_id uuid,reward_id text,
      reward_type text,reward_value integer,reward_label text,reward_rarity text,reward_meta jsonb,reward_snapshot jsonb,
      result_status text,premio_tipo text,premio_valor integer,premio_id text,premio_especial boolean,premio_minutos integer,
      balance_antes numeric,balance_despues numeric
    );
    create table tc_client_roulette_rewards(
      id uuid primary key,campaign_id uuid,nivel smallint,is_active boolean,weight numeric,sort_order integer,created_at timestamptz,
      metadata jsonb,reward_type text,reward_value numeric,name text,rarity text,special boolean,fulfillment_mode text,description text
    );
    create table tc_client_roulette_entitlements(
      id uuid primary key default gen_random_uuid(),cliente_id uuid,spin_id uuid,reward_id uuid,campaign_id uuid,reward_name text,
      reward_type text,fulfillment_mode text,status text,total_claims integer,claims_used integer,expires_at timestamptz,
      next_claim_at timestamptz,metadata jsonb,updated_at timestamptz
    );
    create table cliente_puntos_historial(cliente_id uuid,tipo text,puntos integer,descripcion text,operation_id uuid,saldo_despues integer,meta jsonb);
    create table cliente_oracle_credit_movements(cliente_id uuid,amount integer,movement_type text,reference text unique,notes text,meta jsonb);
    create table cliente_notificaciones(cliente_id uuid,tipo text,titulo text,mensaje text,meta jsonb,leida boolean,created_at timestamptz);
    create table crm_client_notes(cliente_id text,texto text,author_user_id uuid,author_name text,author_email text,is_pinned boolean,
      ruleta_spin_id uuid,event_type text,event_data jsonb);
    create table tc_client_roulette_audit(campaign_id uuid,reward_id uuid,spin_id uuid,cliente_id uuid,action text,snapshot jsonb);
    create table tc_client_benefit_events(cliente_id uuid,payment_id uuid references crm_cliente_pagos(id),rank_at_event text,
      benefit_key text unique,benefit_type text,coins integer,minutes integer,oracle_credits integer,spin_id uuid,snapshot jsonb);
    create table roulette_signals(cliente_id uuid primary key,touches integer);
    create function tc_assert_roulette_access(uuid,smallint,text) returns void language plpgsql as $$
      begin if $3='denied' then raise exception 'ROULETTE_RANK_REQUIRED'; end if; end $$;
    create function tc_client_roulette_active_campaign_id() returns uuid language sql as $$select '${id(100)}'::uuid$$;
    create function tc_client_rank_state(uuid) returns jsonb language sql as $$select '{"effective":"plata"}'::jsonb$$;
    create function cliente_ruleta_resumen_ultra_v1(uuid) returns jsonb language sql as $$
      select jsonb_build_object('pending',count(*)) from cliente_ruleta_giros where cliente_id=$1 and estado='pending' $$;
    create function tc_touch_roulette_signal(uuid) returns void language sql as $$
      insert into roulette_signals values($1,1) on conflict(cliente_id) do update set touches=roulette_signals.touches+1 $$;
  `);
  await db.exec(legacy);
  await db.exec(`revoke all on function cliente_girar_ruleta_ultra_v1(uuid,uuid,smallint) from public,anon,authenticated;
    grant execute on function cliente_girar_ruleta_ultra_v1(uuid,uuid,smallint) to service_role;`);
  originalAccess = await access();
  await db.exec(migration);
  patchedAccess = await access();
});

beforeEach(async () => {
  await db.exec(`truncate crm_clientes,crm_cliente_pagos,cliente_ruleta_giros,tc_client_roulette_rewards,
    tc_client_roulette_entitlements,cliente_puntos_historial,cliente_oracle_credit_movements,cliente_notificaciones,
    crm_client_notes,tc_client_roulette_audit,tc_client_benefit_events,roulette_signals cascade;
    insert into crm_clientes(id) values('${id(1)}'),('${id(2)}');
    insert into tc_client_roulette_rewards values('${id(101)}','${id(100)}',1,true,1,0,now(),'{}','coins',400,'400 Coins','common',false,'automatic','Coins reward');`);
});
after(async () => { if (db) await db.close(); });

test('original production RPC reproduces FK 23503 and rolls back the whole award', async () => {
  await payment(20, 1, 30);
  await pending(10, 30, 'rendimiento_llamadas', `rendimiento:${id(30)}`);
  await db.exec('begin');
  try {
    await db.exec(legacy);
    await assert.rejects(spin(), error => error.code === '23503');
  } finally {
    await db.exec('rollback');
  }
  assert.equal(await value('select estado as value from cliente_ruleta_giros'), 'pending');
  assert.equal(await value('select puntos as value from crm_clientes where id=$1', [id(1)]), 0);
  assert.equal(await value('select count(*)::int as value from tc_client_benefit_events'), 0);
});

test('canonical purchase_id remains linked to its real payment for the same client', async () => {
  await payment(20, 1, 30);
  await pending(10, 20, 'crm_cliente_pagos', `rendimiento:${id(30)}`);
  const result = await spin();
  assert.equal(result.reward_value, 400);
  assert.equal((await event()).payment_id, id(20));
  assert.equal((await event()).snapshot.payment_provenance.resolution, 'purchase_id');
});

test('legacy call id resolves to the confirmed payment without rewriting spin provenance', async () => {
  await payment(20, 1, 30);
  await pending(10, 30, 'rendimiento_llamadas', `rendimiento:${id(30)}`);
  await spin();
  const awarded = await event();
  assert.equal(awarded.payment_id, id(20));
  assert.equal(awarded.snapshot.reward_type, 'coins');
  assert.deepEqual(awarded.snapshot.payment_provenance, {
    purchase_id: id(30), payment_key: `rendimiento:${id(30)}`, source: 'rendimiento_llamadas',
    payment_id: id(20), resolution: 'source_rendimiento_id',
  });
  assert.equal(await value('select purchase_id as value from cliente_ruleta_giros'), id(30));
  assert.equal(await value('select count(*)::int as value from crm_cliente_pagos'), 1);
});

test('a legacy call without payment still awards once and preserves orphan provenance', async () => {
  await pending(10, 30, 'rendimiento_llamadas', `rendimiento:${id(30)}`);
  await spin();
  assert.equal((await event()).payment_id, null);
  assert.equal((await event()).snapshot.payment_provenance.purchase_id, id(30));
  assert.equal(await value('select count(*)::int as value from crm_cliente_pagos'), 0);
});

test('a gift with no purchase awards without inventing a payment', async () => {
  await pending();
  await spin();
  assert.equal((await event()).payment_id, null);
  assert.equal((await event()).snapshot.payment_provenance.purchase_id, null);
});

test('purchase_id and call links belonging to another client are never associated', async () => {
  await payment(20, 2, 30);
  await pending(10, 20, 'crm_cliente_pagos', `rendimiento:${id(30)}`);
  await spin();
  assert.equal((await event()).payment_id, null);
  assert.equal(await value('select puntos as value from crm_clientes where id=$1', [id(2)]), 0);
});

test('canonical payment key is resolved only for the verified payment source', async () => {
  await payment(20);
  await pending(10, null, 'crm_cliente_pagos', `crm_pago:${id(20)}`);
  await spin();
  assert.equal((await event()).payment_id, id(20));
  assert.equal((await event()).snapshot.payment_provenance.resolution, 'payment_key');
  await pending(11, null, 'unverified_source', `crm_pago:${id(20)}`);
  await spin(11);
  assert.equal(await value('select payment_id as value from tc_client_benefit_events where spin_id=$1', [id(11)]), null);
});

test('call keys support missing legacy purchase ids without expanding unknown sources', async () => {
  await payment(20, 1, 30);
  await pending(10, null, 'rendimiento_llamadas', `rendimiento:${id(30)}`);
  await spin();
  assert.equal((await event()).payment_id, id(20));
  await pending(11, 30, 'unverified_source', `rendimiento:${id(30)}`);
  await spin(11);
  assert.equal(await value('select payment_id as value from tc_client_benefit_events where spin_id=$1', [id(11)]), null);
});

test('ambiguous payment matches and conflicting legacy references stay unlinked', async () => {
  await payment(20, 1, 30);
  await payment(21, 1, 30);
  await pending(10, 30, 'rendimiento_llamadas', `rendimiento:${id(30)}`);
  await spin();
  assert.equal((await event()).payment_id, null);
  assert.equal((await event()).snapshot.payment_provenance.resolution, 'ambiguous_payment');
  await pending(11, 30, 'rendimiento_llamadas', `rendimiento:${id(31)}`);
  await spin(11);
  assert.equal(await value('select snapshot->\'payment_provenance\'->>\'resolution\' as value from tc_client_benefit_events where spin_id=$1', [id(11)]), 'conflicting_origin');
});

test('unconfirmed inferred payments and malformed keys do not block or acquire false links', async () => {
  await payment(20, 1, 30, 'pending');
  await pending(10, 30, 'rendimiento_llamadas', 'rendimiento:not-a-uuid');
  await spin();
  assert.equal((await event()).payment_id, null);
  await pending(11, null, 'crm_cliente_pagos', 'crm_pago:not-a-uuid');
  await spin(11);
  assert.equal(await value('select payment_id as value from tc_client_benefit_events where spin_id=$1', [id(11)]), null);
});

test('replaying the same spin does not award twice or consume another pending level', async () => {
  await payment(20, 1, 30);
  await pending(10, 30, 'rendimiento_llamadas', `rendimiento:${id(30)}`);
  await pending(11, null, 'admin_adjustment', null, 1, 2);
  const first = await spin();
  const replay = await spin();
  assert.equal(first.spin_id, id(10));
  assert.equal(replay.spin_id, id(10));
  assert.equal(replay.replayed, true);
  assert.equal(replay.reward_value, first.reward_value);
  assert.equal(await value('select puntos as value from crm_clientes where id=$1', [id(1)]), 400);
  for (const table of ['tc_client_benefit_events', 'cliente_notificaciones', 'crm_client_notes', 'tc_client_roulette_audit', 'cliente_puntos_historial']) {
    assert.equal(await value(`select count(*)::int as value from ${table}`), 1, table);
  }
  assert.equal(await value('select touches as value from roulette_signals'), 1);
  assert.equal(await value('select estado as value from cliente_ruleta_giros where id=$1', [id(11)]), 'pending');
});

test('minutes reward and used-spin snapshot retain their original behavior', async () => {
  await db.exec("update tc_client_roulette_rewards set reward_type='minutes',reward_value=5,name='5 minutos'");
  await pending(10, 30, 'rendimiento_llamadas', `rendimiento:${id(30)}`);
  const result = await spin();
  assert.equal(result.balance_before, 0);
  assert.equal(result.balance_after, 5);
  assert.equal((await event()).minutes, 5);
  await spin();
  assert.equal(await value('select minutos_free_pendientes as value from crm_clientes where id=$1', [id(1)]), 5);
});

test('invalid level, foreign spin, revoked spin and rank restriction still reject', async () => {
  await pending();
  await assert.rejects(spin(10, 1, 6), /INVALID_LEVEL/);
  await assert.rejects(spin(10, 1, 2), /INVALID_SPIN/);
  await assert.rejects(spin(10, 2), /INVALID_SPIN/);
  await db.exec("update cliente_ruleta_giros set estado='revoked'");
  await assert.rejects(spin(), /INVALID_SPIN/);
  await db.exec("update cliente_ruleta_giros set estado='pending',required_rank='denied'");
  await assert.rejects(spin(), /ROULETTE_RANK_REQUIRED/);
  assert.equal(await value('select count(*)::int as value from tc_client_benefit_events'), 0);
});

test('migration preserves owner, execution ACL, security mode and search path', async () => {
  assert.deepEqual(patchedAccess, originalAccess);
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await value("select has_function_privilege($1,'cliente_girar_ruleta_ultra_v1(uuid,uuid,smallint)','execute') as value", [role]), false);
  }
  assert.equal(await value("select has_function_privilege('service_role','cliente_girar_ruleta_ultra_v1(uuid,uuid,smallint)','execute') as value"), true);
});

test('a changed function fails the migration guard instead of silently replacing unknown code', async () => {
  try {
    await assert.rejects(db.exec(migration), /ROULETTE_PAYMENT_PATCH_SOURCE_MISMATCH/);
  } finally {
    await db.exec('rollback');
  }
  assert.deepEqual(await access(), patchedAccess);
});

test('CRLF production function and Windows migration checkout patch successfully too', async () => {
  await db.exec(legacy.replace(/\r?\n/g, '\r\n'));
  assert.equal(await value(`select position(chr(13)||chr(10) in prosrc)>0 as value from pg_proc
    where oid='cliente_girar_ruleta_ultra_v1(uuid,uuid,smallint)'::regprocedure`), true);
  await db.exec(migration.replace(/\r?\n/g, '\r\n'));
  assert.deepEqual(await access(), originalAccess);
  await payment(20, 1, 30);
  await pending(10, 30, 'rendimiento_llamadas', `rendimiento:${id(30)}`);
  await spin();
  assert.equal((await event()).payment_id, id(20));
});
