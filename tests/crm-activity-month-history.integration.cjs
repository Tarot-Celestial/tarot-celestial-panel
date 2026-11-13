const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// All source events are fictional and execute in an isolated local PostgreSQL.
const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');
const id = n => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const historySql = migration('20261113225107_crm_activity_month_history_2026.sql');
let db;
let sequence = 1000;
let beforeHistory;
let uppercaseMayId;
const scalar = async (query, params = []) => (await db.query(query, params)).rows[0].v;
const labels = n => scalar(`select coalesce(jsonb_agg(e.nombre order by e.nombre),'[]'::jsonb) v
  from crm_cliente_etiquetas ce join crm_etiquetas e on e.id=ce.etiqueta_id where ce.cliente_id=$1`, [id(n)]);
const monthState = n => scalar('select to_jsonb(a) v from crm_client_activity_month a where cliente_id=$1', [id(n)]);

async function addTag(n, label) {
  await db.query('insert into crm_etiquetas(nombre) values($1) on conflict do nothing', [label]);
  await db.query(`insert into crm_cliente_etiquetas(cliente_id,etiqueta_id)
    select $1,id from crm_etiquetas where nombre=$2 on conflict do nothing`, [id(n), label]);
}

async function client(n, oldMonth = 'Noviembre') {
  await db.query(`insert into crm_clientes(id,nombre,puntos,minutos_free_pendientes,minutos_normales_pendientes,
    rango_actual,created_at,updated_at) values($1,$2,300,7,20,'oro','2025-12-01T12:00Z','2026-01-01T12:00Z')`,
  [id(n), `Persona ficticia ${n}`]);
  for (const label of [oldMonth, 'cliente us', 'Noviembre VIP']) await addTag(n, label);
}

async function call(n, date, purchases = false, missingTimestamp = false) {
  await db.query(`insert into rendimiento_llamadas(id,cliente_id,fecha_hora,created_at,cliente_compra_minutos,tiempo)
    values($1,$2,$3,$4,$5,10)`, [id(++sequence), typeof n === 'number' ? id(n) : n, missingTimestamp ? null : date, date, purchases]);
}

async function purchase(n, date, { state = 'completed', amount = 22, promo = false } = {}) {
  await db.query(`insert into crm_cliente_pagos(id,cliente_id,created_at,estado,importe,benefits_context)
    values($1,$2,$3,$4,$5,jsonb_build_object('promo',$6::boolean))`, [id(++sequence), id(n), date, state, amount, promo]);
}

async function webAttempt(n, date, { status = 'completed', amount = 2, provider = 'mollie' } = {}) {
  const attemptId = id(++sequence);
  await db.query(`insert into cliente_payment_attempts(id,cliente_id,status,amount,provider,pack_id,completed_at,created_at)
    values($1,$2,$3,$4,$5,'oracle_credits_2',$6,coalesce($6::timestamptz,'2026-08-01T12:00Z'))`,
  [attemptId, id(n), status, amount, provider, date]);
  return attemptId;
}

async function oracleMovement(n, date, options = {}) {
  const { question = false, type = 'purchase', amount = 2, reference = `stripe:cs_test_fixture_${n}`,
    meta = { stripe_session_id: `cs_test_fixture_${n}`, amount_eur: '2.00' } } = options;
  const table = question ? 'cliente_oracle_question_movements' : 'cliente_oracle_credit_movements';
  const movementId = id(++sequence);
  await db.query(`insert into ${table}(id,cliente_id,movement_type,amount,reference,meta,created_at)
    values($1,$2,$3,$4,$5,$6,$7)`, [movementId, id(n), type, amount, reference, meta, date]);
  return movementId;
}

async function invariants() {
  return scalar(`select jsonb_build_object(
    'clients',(select jsonb_agg(to_jsonb(c) order by c.id) from crm_clientes c),
    'non_month_tags',(select jsonb_agg(to_jsonb(ce) order by ce.id) from crm_cliente_etiquetas ce
      join crm_etiquetas e on e.id=ce.etiqueta_id where not tc_crm_is_month_tag(e.nombre)),
    'calls',(select jsonb_agg(to_jsonb(r) order by r.id) from rendimiento_llamadas r),
    'purchases',(select jsonb_agg(to_jsonb(p) order by p.id) from crm_cliente_pagos p),
    'capture_audit',(select jsonb_agg(to_jsonb(a) order by a.id) from crm_client_capture_audit a),
    'leads',(select jsonb_agg(to_jsonb(l) order by l.id) from captacion_leads l),
    'web_attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from cliente_payment_attempts a),
    'oracle_credits',(select jsonb_agg(to_jsonb(m) order by m.id) from cliente_oracle_credit_movements m),
    'oracle_questions',(select jsonb_agg(to_jsonb(m) order by m.id) from cliente_oracle_question_movements m)
  ) v`);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table crm_clientes(id uuid primary key,nombre text,puntos integer,minutos_free_pendientes numeric,
      minutos_normales_pendientes numeric,rango_actual text,captured_at timestamptz,
      created_at timestamptz default now(),updated_at timestamptz default now(),
      ultimo_acceso_at timestamptz,ultima_actividad_at timestamptz,lead_status text);
    create table crm_etiquetas(id uuid primary key default gen_random_uuid(),nombre text unique,
      activa boolean default true,created_at timestamptz default now());
    create unique index crm_etiquetas_nombre_uidx on crm_etiquetas(lower(nombre));
    create table crm_cliente_etiquetas(id uuid primary key default gen_random_uuid(),
      cliente_id uuid references crm_clientes(id),etiqueta_id uuid references crm_etiquetas(id),
      created_at timestamptz default now(),unique(cliente_id,etiqueta_id));
    create table rendimiento_llamadas(id uuid primary key,cliente_id text,fecha_hora timestamptz,
      created_at timestamptz default now(),cliente_compra_minutos boolean,tiempo numeric);
    create table crm_cliente_pagos(id uuid primary key,cliente_id uuid references crm_clientes(id),
      created_at timestamptz default now(),estado text,importe numeric,benefits_context jsonb);
    create table crm_client_capture_audit(id uuid primary key default gen_random_uuid(),
      client_id uuid,action text,created_at timestamptz default now());
    create table captacion_leads(id uuid primary key default gen_random_uuid(),cliente_id uuid,
      estado text,created_at timestamptz default now(),updated_at timestamptz default now(),closed_at timestamptz);
    create table cliente_payment_attempts(id uuid primary key,cliente_id uuid,status text,amount numeric,
      provider text,pack_id text,completed_at timestamptz,created_at timestamptz default now());
    create table cliente_oracle_credit_movements(id uuid primary key,cliente_id uuid,movement_type text,
      amount integer,reference text,meta jsonb,created_at timestamptz default now());
    create table cliente_oracle_question_movements(id uuid primary key,cliente_id uuid,movement_type text,
      amount integer,reference text,meta jsonb,created_at timestamptz default now());
    -- Return-only stand-in: the test below exercises this migration's ACL change,
    -- not the unchanged production implementation of Oracle credit grants.
    create function grant_cliente_oracle_questions(uuid,integer,text,text,jsonb) returns integer
      language sql security definer set search_path='' as 'select $2';
    grant execute on function grant_cliente_oracle_questions(uuid,integer,text,text,jsonb) to public;
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
  `);

  for (let n = 1; n <= 14; n++) await client(n, n >= 8 && n <= 11 ? 'Diciembre 2025' : 'Noviembre');
  await addTag(1, 'Julio2026');
  await call(1, '2026-01-15T12:00Z', true);
  await call(1, '2026-08-12T12:00Z', false);
  await purchase(2, '2026-06-10T12:00Z', { promo: true });
  await purchase(2, '2026-09-10T12:00Z', { state: 'pending' });
  await call(3, '2026-05-10T12:00Z', false);
  await purchase(3, '2026-10-02T12:00Z');
  await db.query("update crm_clientes set captured_at='2026-02-10T12:00Z' where id=$1", [id(4)]);
  await db.query(`insert into crm_client_capture_audit(client_id,action,created_at) values
    ($1,'capture_confirmed','2026-03-10T12:00Z'),($1,'contact_registered','2026-08-10T12:00Z')`, [id(5)]);
  await db.query(`insert into captacion_leads(cliente_id,estado,created_at,closed_at,updated_at)
    values($1,'captado','2026-04-01T12:00Z','2026-04-10T12:00Z','2026-09-10T12:00Z')`, [id(6)]);
  await call(7, '2025-12-31T23:30Z'); // Already January 2026 in Madrid.
  await db.query('update crm_clientes set ultimo_acceso_at=now(),ultima_actividad_at=now(),updated_at=now() where id=$1', [id(8)]);
  await purchase(9, '2026-07-10T12:00Z', { state: 'failed' });
  await purchase(9, '2026-08-10T12:00Z', { state: 'pending' });
  await purchase(9, '2026-09-10T12:00Z', { amount: 0 });
  await call(10, '2025-12-31T22:59:59Z'); // Still December 2025 in Madrid.
  await call(11, '2099-01-15T12:00Z');
  await purchase(11, '2027-01-15T12:00Z');
  await call(12, '2026-07-10T12:00Z');
  await call(13, '2026-02-28T23:30Z'); // March in Madrid.
  await call(14, '2026-09-10T12:00Z', false, true);
  await call('legacy-unlinked-client', '2026-08-12T12:00Z');
  await call(id(999999), '2026-08-12T12:00Z');
  await client(15, 'MAYO 2026');
  await call(15, '2026-05-15T12:00Z');
  await client(16, 'MAYO 2025');
  await client(17, 'MAYO 2026 VIP');
  await client(18, 'MAYO 2026'); // Manual association with no qualifying event.
  uppercaseMayId = await scalar("select id v from crm_etiquetas where nombre='MAYO 2026'");
  for (let n = 20; n <= 36; n++) await client(n, 'Diciembre 2025');
  await webAttempt(20, '2026-05-06T12:00Z');
  await webAttempt(21, '2026-08-06T12:00Z', { provider: 'redsys' });
  await oracleMovement(22, '2026-03-06T12:00Z');
  await oracleMovement(23, '2026-06-06T12:00Z', { question: true });
  await oracleMovement(24, '2026-08-06T12:00Z', { reference: `rank:${id(24)}`, meta: { source: 'rank', amount_eur: 2 } });
  await oracleMovement(25, '2026-08-06T12:00Z', { reference: `daily:${id(25)}`, meta: { source: 'daily' } });
  await oracleMovement(26, '2026-08-06T12:00Z', { type: 'admin_grant' });
  await oracleMovement(27, '2026-08-06T12:00Z', { meta: { stripe_session_id: 'cs_test_fixture_27' } });
  await oracleMovement(28, '2026-08-06T12:00Z', { meta: { stripe_session_id: 'cs_test_fixture_28', amount_eur: 'invalid amount' } });
  await webAttempt(29, '2026-08-06T12:00Z', { status: 'pending' });
  await webAttempt(30, '2026-08-06T12:00Z', { amount: 0 });
  await webAttempt(31, null);
  await oracleMovement(32, '2026-08-06T12:00Z', { amount: 0 });
  await oracleMovement(33, '2026-08-06T12:00Z', { reference: 'stripe:cs_test_wrong_reference' });
  await oracleMovement(34, '2099-08-06T12:00Z');
  await webAttempt(35, '2025-08-06T12:00Z');
  await oracleMovement(36, '2026-08-06T12:00Z', { meta: { stripe_session_id: 'cs_test_fixture_36', amount_eur: 0 } });
  // Audit rows with missing CRM clients must not abort the historical repair.
  await db.query(`insert into crm_client_capture_audit(client_id,action,created_at)
    values($1,'capture_confirmed','2026-04-10T12:00Z')`, [id(999999)]);

  await db.exec(migration('20261113220847_crm_activity_month.sql'));
  await db.query("select tc_crm_record_activity($1,'2026-11-05T12:00Z','call',$2)", [id(12), id(9000)]);
  beforeHistory = await invariants();
  await db.exec(historySql);
});

after(async () => { if (db) await db.close(); });

test('historical client uses the latest real call even without any purchase', async () => {
  assert.deepEqual(await labels(1), ['Agosto 2026', 'Noviembre VIP', 'cliente us']);
  assert.equal((await monthState(1)).source, 'call');
});

test('normal and promo completed purchases both set their actual month; pending payments do not', async () => {
  assert.deepEqual(await labels(2), ['Junio 2026', 'Noviembre VIP', 'cliente us']);
  assert.deepEqual(await labels(3), ['Noviembre VIP', 'Octubre 2026', 'cliente us']);
  assert.equal((await monthState(2)).source, 'purchase');
});

test('capture evidence selects its event date instead of a later contact or profile update', async () => {
  assert.deepEqual(await labels(4), ['Febrero 2026', 'Noviembre VIP', 'cliente us']);
  assert.deepEqual(await labels(5), ['Marzo 2026', 'Noviembre VIP', 'cliente us']);
  assert.deepEqual(await labels(6), ['Abril 2026', 'Noviembre VIP', 'cliente us']);
});

test('Madrid date controls both the year inclusion boundary and the displayed month', async () => {
  assert.deepEqual(await labels(7), ['Enero 2026', 'Noviembre VIP', 'cliente us']);
  assert.deepEqual(await labels(13), ['Marzo 2026', 'Noviembre VIP', 'cliente us']);
});

test('login-only, failed/zero purchases, 2025-only and future-only clients retain their labels', async () => {
  for (const n of [8, 9, 10, 11]) {
    assert.deepEqual(await labels(n), ['Diciembre 2025', 'Noviembre VIP', 'cliente us'], `client ${n}`);
    assert.equal(await scalar('select count(*)::int v from crm_client_activity_month where cliente_id=$1', [id(n)]), 0);
  }
});

test('historical reconciliation cannot move a newer recorded activity month backwards', async () => {
  assert.deepEqual(await labels(12), ['Noviembre 2026', 'Noviembre VIP', 'cliente us']);
  assert.equal((await monthState(12)).source_id, id(9000));
});

test('legacy call timestamps fall back to created_at, and unlinked IDs are ignored safely', async () => {
  assert.deepEqual(await labels(14), ['Noviembre VIP', 'Septiembre 2026', 'cliente us']);
  assert.equal(await scalar('select count(*)::int v from crm_client_activity_month where cliente_id=$1', [id(999999)]), 0);
});

test('confirmed paid Mollie and Redsys web attempts qualify without a duplicated CRM purchase', async () => {
  assert.deepEqual(await labels(20), ['Mayo 2026', 'Noviembre VIP', 'cliente us']);
  assert.deepEqual(await labels(21), ['Agosto 2026', 'Noviembre VIP', 'cliente us']);
  assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id in ($1,$2)', [id(20), id(21)]), 0);
});

test('verified legacy Stripe purchases for Oracle credits and questions qualify', async () => {
  assert.deepEqual(await labels(22), ['Marzo 2026', 'Noviembre VIP', 'cliente us']);
  assert.deepEqual(await labels(23), ['Junio 2026', 'Noviembre VIP', 'cliente us']);
});

test('rank, daily and admin Oracle grants are not purchases even with purchase-like ledger metadata', async () => {
  for (const n of [24, 25, 26]) {
    assert.deepEqual(await labels(n), ['Diciembre 2025', 'Noviembre VIP', 'cliente us']);
    assert.equal(await scalar('select count(*)::int v from crm_client_activity_month where cliente_id=$1', [id(n)]), 0);
  }
});

test('unpaid, zero, unverified, missing-date, malformed and out-of-range web events are excluded', async () => {
  for (const n of [27, 28, 29, 30, 31, 32, 33, 34, 35, 36]) {
    assert.deepEqual(await labels(n), ['Diciembre 2025', 'Noviembre VIP', 'cliente us'], `client ${n}`);
    assert.equal(await scalar('select count(*)::int v from crm_client_activity_month where cliente_id=$1', [id(n)]), 0);
  }
});

test('the complete client row, non-month associations and original source histories remain identical', async () => {
  assert.deepEqual(await invariants(), beforeHistory);
});

test('2026 case-only catalog labels keep their IDs and associations; other years and descriptive labels stay unchanged', async () => {
  assert.equal(await scalar("select id v from crm_etiquetas where nombre='Mayo 2026'"), uppercaseMayId);
  for (const n of [15, 18]) {
    assert.equal(await scalar('select count(*)::int v from crm_cliente_etiquetas where cliente_id=$1 and etiqueta_id=$2', [id(n), uppercaseMayId]), 1);
    assert.deepEqual(await labels(n), ['Mayo 2026', 'Noviembre VIP', 'cliente us']);
  }
  assert.deepEqual(await labels(16), ['MAYO 2025', 'Noviembre VIP', 'cliente us']);
  assert.deepEqual(await labels(17), ['MAYO 2026 VIP', 'Noviembre VIP', 'cliente us']);
  assert.equal(await scalar('select count(*)::int v from crm_client_activity_month where cliente_id=$1', [id(18)]), 0);
});

test('reapplying the history migration creates no duplicate state, audit, or label relations', async () => {
  const snapshot = () => scalar(`select jsonb_build_object(
    'state',(select jsonb_agg(to_jsonb(a) order by cliente_id) from crm_client_activity_month a),
    'audit',(select jsonb_agg(to_jsonb(a) order by id) from crm_client_month_tag_audit a),
    'relations',(select jsonb_agg(to_jsonb(e) order by id) from crm_cliente_etiquetas e)
  ) v`);
  const beforeReplay = await snapshot();
  await db.exec(historySql);
  assert.deepEqual(await snapshot(), beforeReplay);
  assert.deepEqual(await invariants(), beforeHistory);
});

test('new paid web completion updates labels automatically and a webhook replay changes neither labels nor audit', async () => {
  await client(40, 'Diciembre 2025');
  await db.exec('set role service_role');
  try {
    const attempt = await webAttempt(40, '2026-10-06T12:00Z', { status: 'pending', provider: 'redsys' });
    assert.deepEqual(await labels(40), ['Diciembre 2025', 'Noviembre VIP', 'cliente us']);
    await db.query("update cliente_payment_attempts set status='completed' where id=$1", [attempt]);
    assert.deepEqual(await labels(40), ['Noviembre VIP', 'Octubre 2026', 'cliente us']);
    const state = await monthState(40);
    const count = await scalar('select count(*)::int v from crm_client_month_tag_audit where cliente_id=$1', [id(40)]);
    await db.query("update cliente_payment_attempts set status='completed' where id=$1", [attempt]);
    assert.deepEqual(await monthState(40), state);
    assert.equal(await scalar('select count(*)::int v from crm_client_month_tag_audit where cliente_id=$1', [id(40)]), count);
    // A retry must not turn an October purchase into November activity merely
    // because a provider handler rewrites completed_at during reconciliation.
    await db.query("update cliente_payment_attempts set completed_at='2026-11-13T12:00Z' where id=$1", [attempt]);
    assert.deepEqual(await monthState(40), state);
    assert.deepEqual(await labels(40), ['Noviembre VIP', 'Octubre 2026', 'cliente us']);
    assert.equal(await scalar('select count(*)::int v from crm_client_month_tag_audit where cliente_id=$1', [id(40)]), count);
  } finally { await db.exec('reset role'); }
});

test('an incomplete completed-payment record qualifies when its first verified completion time arrives', async () => {
  await client(43, 'Diciembre 2025');
  const attempt = await webAttempt(43, null);
  assert.deepEqual(await labels(43), ['Diciembre 2025', 'Noviembre VIP', 'cliente us']);
  await db.query("update cliente_payment_attempts set completed_at='2026-08-10T12:00Z' where id=$1", [attempt]);
  assert.deepEqual(await labels(43), ['Agosto 2026', 'Noviembre VIP', 'cliente us']);
});

test('new paid Stripe Oracle credit and question events update labels; ordinary grants still do not', async () => {
  for (const [n, question] of [[41, false], [42, true]]) {
    await client(n, 'Diciembre 2025');
    await oracleMovement(n, '2026-09-06T12:00Z', { type: 'admin_grant', question });
    assert.deepEqual(await labels(n), ['Diciembre 2025', 'Noviembre VIP', 'cliente us']);
    await oracleMovement(n, '2026-09-06T12:00Z', { question });
    assert.deepEqual(await labels(n), ['Noviembre VIP', 'Septiembre 2026', 'cliente us']);
  }
});

test('only the server role can execute the existing privileged Oracle question grant function', async () => {
  const statement = "select grant_cliente_oracle_questions($1,2,'test-receipt','fixture','{}'::jsonb) v";
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(db.query(statement, [id(41)]), /permission denied/i); }
    finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { assert.equal(await scalar(statement, [id(41)]), 2); }
  finally { await db.exec('reset role'); }
});
