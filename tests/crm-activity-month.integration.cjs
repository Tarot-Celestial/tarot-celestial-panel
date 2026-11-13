const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// These are isolated PostgreSQL fixtures. No live customer, purchase, or call is created.
const migrationPath = path.join(__dirname, '../supabase/migrations/20261113220847_crm_activity_month.sql');
const id = n => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
let serial = 5000;
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0].v;
const tags = n => scalar(`select coalesce(jsonb_agg(e.nombre order by e.nombre),'[]'::jsonb) v
  from crm_cliente_etiquetas ce join crm_etiquetas e on e.id=ce.etiqueta_id where ce.cliente_id=$1`, [id(n)]);
const wallet = n => scalar(`select jsonb_build_object('coins',puntos,'free',minutos_free_pendientes,
  'normal',minutos_normales_pendientes,'rank',rango_actual) v from crm_clientes where id=$1`, [id(n)]);
const currentMonthLabel = () => scalar(`select (array['Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'])[extract(month from now() at time zone 'Europe/Madrid')::int]
  || ' ' || extract(year from now() at time zone 'Europe/Madrid')::int v`);

async function client(n, initialTags = []) {
  await db.query(`insert into crm_clientes(id,nombre,puntos,minutos_free_pendientes,minutos_normales_pendientes,rango_actual)
    values ($1,'Cliente de prueba',420,5,20,'plata')`, [id(n)]);
  for (const label of initialTags) await addTag(n, label);
}

async function tagId(label) {
  await db.query('insert into crm_etiquetas(nombre) values($1) on conflict do nothing', [label]);
  return scalar('select id v from crm_etiquetas where nombre=$1', [label]);
}

async function addTag(n, label) {
  const tag = await tagId(label);
  await db.query('insert into crm_cliente_etiquetas(cliente_id,etiqueta_id) values($1,$2) on conflict do nothing', [id(n), tag]);
  return tag;
}

async function call(n, at, buys = false) {
  const callId = id(++serial);
  await db.query(`insert into rendimiento_llamadas(id,cliente_id,fecha_hora,created_at,fecha,cliente_compra_minutos,tipo_registro,tiempo)
    values($1,$2,$3,$3,($3::timestamptz at time zone 'Europe/Madrid')::date,$4,'llamada',10)`, [callId, id(n), at, buys]);
  return callId;
}

async function payment(n, at, state = 'completed', amount = 15, promo = true) {
  const paymentId = id(++serial);
  await db.query(`insert into crm_cliente_pagos(id,cliente_id,created_at,updated_at,estado,importe,metodo,benefits_context)
    values($1,$2,$3,$3,$4,$5,'paypal',jsonb_build_object('promo',$6::boolean))`, [paymentId, id(n), at, state, amount, promo]);
  return paymentId;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key);
    create table crm_clientes(
      id uuid primary key,nombre text,puntos integer default 0,minutos_free_pendientes numeric default 0,
      minutos_normales_pendientes numeric default 0,rango_actual text,created_at timestamptz default now(),
      updated_at timestamptz default now(),ultimo_acceso_at timestamptz,ultima_actividad_at timestamptz,
      captured_at timestamptz,captured_by_worker_id uuid,lead_status text,estado text,
      capture_origin text,capture_business text,total_accesos integer default 0
    );
    create table crm_etiquetas(id uuid primary key default gen_random_uuid(),nombre text unique,
      activa boolean default true,color text,created_at timestamptz default now(),creado_por_worker_id uuid);
    create unique index crm_etiquetas_nombre_uidx on crm_etiquetas(lower(nombre));
    create table crm_cliente_etiquetas(id uuid primary key default gen_random_uuid(),
      cliente_id uuid references crm_clientes(id),etiqueta_id uuid references crm_etiquetas(id),
      created_at timestamptz default now(),creado_por_worker_id uuid,unique(cliente_id,etiqueta_id));
    create table rendimiento_llamadas(id uuid primary key default gen_random_uuid(),cliente_id text,
      created_at timestamptz default now(),fecha_hora timestamptz,fecha date,cliente_compra_minutos boolean,
      captado boolean default false,promo boolean default false,tipo_registro text,tiempo numeric);
    create table crm_cliente_pagos(id uuid primary key default gen_random_uuid(),cliente_id uuid references crm_clientes(id),
      importe numeric,estado text,metodo text,created_at timestamptz default now(),updated_at timestamptz default now(),
      benefits_context jsonb,benefits_processed_at timestamptz);
    create table captacion_leads(id uuid primary key default gen_random_uuid(),cliente_id uuid references crm_clientes(id),
      estado text,created_at timestamptz default now(),updated_at timestamptz default now(),closed_at timestamptz,
      contacted_at timestamptz,last_contact_at timestamptz);
    create table captacion_state_events(id bigint generated by default as identity primary key,lead_id uuid,
      cliente_id uuid,actor_worker_id uuid,previous_state text,next_state text,action text,source text,
      metadata jsonb,created_at timestamptz default now());
    create table crm_client_capture_audit(id uuid primary key default gen_random_uuid(),cliente_id uuid,
      client_id uuid,action text,created_at timestamptz default now());
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
  `);
  // A known current-month purchase and a login-only client predate the migration.
  await client(1000, ['Octubre 2025', 'Noviembre', 'cliente us']);
  await payment(1000, new Date().toISOString());
  await client(1001, ['Octubre 2025', 'cliente us']);
  await db.query('update crm_clientes set ultimo_acceso_at=now(),ultima_actividad_at=now() where id=$1', [id(1001)]);
  await client(1002, ['Octubre 2025']);
  await db.query('insert into rendimiento_llamadas(id,cliente_id,created_at) values($1,$2,now())', [id(++serial), id(1002)]);
  await db.exec(fs.readFileSync(migrationPath, 'utf8'));
});

after(async () => { if (db) await db.close(); });

test('backfill uses actual purchases, keeps unrelated tags and does not promote login-only clients', async () => {
  assert.deepEqual(await tags(1000), [await currentMonthLabel(), 'cliente us'].sort());
  assert.deepEqual(await tags(1001), ['Octubre 2025', 'cliente us']);
  assert.deepEqual(await tags(1002), [await currentMonthLabel()]);
  assert.deepEqual(await wallet(1000), {coins: 420, free: 5, normal: 20, rank: 'plata'});
  assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1', [id(1000)]), 1);
});

test('a call without a purchase moves old month variants to one year-qualified label', async () => {
  await client(1, ['Julio2026', 'Octubre 2026', 'Noviembre', 'cliente us', 'Noviembre VIP']);
  const before = await wallet(1);
  await call(1, '2026-11-05T14:14:00Z');
  assert.deepEqual(await tags(1), ['Noviembre 2026', 'Noviembre VIP', 'cliente us']);
  assert.deepEqual(await wallet(1), before);
});

test('completed promo and regular purchases both qualify, without changing benefits or amounts', async () => {
  for (const [n, promo] of [[2, true], [3, false]]) {
    await client(n, ['Octubre 2026', 'cliente us']);
    const before = await wallet(n);
    const purchase = await payment(n, '2026-11-12T05:58:13Z', 'completed', 15, promo);
    assert.deepEqual(await tags(n), ['Noviembre 2026', 'cliente us']);
    assert.deepEqual(await wallet(n), before);
    assert.deepEqual(await scalar('select jsonb_build_object(\'importe\',importe,\'promo\',benefits_context->\'promo\') v from crm_cliente_pagos where id=$1', [purchase]), {importe: 15, promo});
  }
});

test('failed, pending and zero-value payments do not create activity; completion does', async () => {
  await client(4, ['Octubre 2026']);
  await payment(4, '2026-11-12T05:58:13Z', 'failed');
  const pending = await payment(4, '2026-11-12T05:58:13Z', 'pending');
  await payment(4, '2026-11-12T05:58:13Z', 'completed', 0);
  assert.deepEqual(await tags(4), ['Octubre 2026']);
  await db.query("update crm_cliente_pagos set estado='completed' where id=$1", [pending]);
  assert.deepEqual(await tags(4), ['Noviembre 2026']);
});

test('login, balance refresh and ordinary client edits are not qualifying activity', async () => {
  await client(5, ['Octubre 2026']);
  await db.query(`update crm_clientes set ultimo_acceso_at=now(),ultima_actividad_at=now(),
    updated_at=now(),total_accesos=1,nombre='Nombre corregido' where id=$1`, [id(5)]);
  assert.deepEqual(await tags(5), ['Octubre 2026']);
});

test('confirmed capture advances the month even when the client has an old first-capture timestamp', async () => {
  await client(6, ['Julio 2026']);
  await db.query("update crm_clientes set captured_at='2026-07-02T12:00:00Z' where id=$1", [id(6)]);
  const lead = id(++serial);
  await db.query("insert into captacion_leads(id,cliente_id,estado) values($1,$2,'pendiente')", [lead, id(6)]);
  await db.query("update captacion_leads set estado='captado',closed_at=now(),updated_at=now() where id=$1", [lead]);
  assert.deepEqual(await tags(6), [await currentMonthLabel()]);
});

test('capture audit confirmation qualifies but ordinary capture contact does not', async () => {
  await client(13, ['Octubre 2025', 'cliente us']);
  await db.query("insert into crm_client_capture_audit(client_id,action) values($1,'contact_registered')", [id(13)]);
  assert.deepEqual(await tags(13), ['Octubre 2025', 'cliente us']);
  await db.query("insert into crm_client_capture_audit(client_id,action) values($1,'capture_confirmed')", [id(13)]);
  assert.deepEqual(await tags(13), [await currentMonthLabel(), 'cliente us'].sort());
});

test('older and duplicate events never move an already active client backwards', async () => {
  await client(7);
  const latest = await call(7, '2026-11-12T10:00:00Z', true);
  const auditsBefore = await scalar('select count(*)::int v from crm_client_month_tag_audit where cliente_id=$1', [id(7)]);
  await call(7, '2026-10-12T10:00:00Z', false);
  await db.query('update rendimiento_llamadas set tiempo=12 where id=$1', [latest]);
  await db.query("select tc_crm_record_activity($1,'2026-11-12T10:00:00Z','call',$2)", [id(7), latest]);
  assert.deepEqual(await tags(7), ['Noviembre 2026']);
  assert.equal(await scalar('select count(*)::int v from crm_client_activity_month where cliente_id=$1', [id(7)]), 1);
  assert.equal(await scalar('select count(*)::int v from crm_client_month_tag_audit where cliente_id=$1', [id(7)]), auditsBefore);
});

test('Madrid month/year boundary does not inherit the UTC month', async () => {
  await client(8);
  await call(8, '2025-12-31T23:30:00Z');
  assert.deepEqual(await tags(8), ['Enero 2026']);
});

test('manual tag saves preserve the canonical activity month and rollback unknown tag IDs', async () => {
  await client(9, ['cliente us', 'Octubre 2026']);
  await call(9, '2026-11-12T10:00:00Z');
  const oldMonth = await tagId('Octubre 2026');
  const custom = await tagId('Seguimiento prioritario');
  await db.query('select tc_crm_replace_client_tags($1,$2::uuid[])', [id(9), [oldMonth, custom]]);
  assert.deepEqual(await tags(9), ['Noviembre 2026', 'Seguimiento prioritario']);
  await assert.rejects(db.query('select tc_crm_replace_client_tags($1,$2::uuid[])', [id(9), [id(999999)]]));
  assert.deepEqual(await tags(9), ['Noviembre 2026', 'Seguimiento prioritario']);
});

test('old open forms cannot delete the activity month or restore another monthly label', async () => {
  await client(10, ['cliente us']);
  await call(10, '2026-11-12T10:00:00Z');
  await db.query('delete from crm_cliente_etiquetas where cliente_id=$1', [id(10)]);
  assert.deepEqual(await tags(10), ['Noviembre 2026']);
  await addTag(10, 'Noviembre');
  await addTag(10, 'Julio2026');
  assert.deepEqual(await tags(10), ['Noviembre 2026']);
});

test('an unsuccessful transaction does not leak activity or change existing month labels', async () => {
  await client(11, ['Octubre 2026', 'cliente us']);
  await db.exec('begin');
  await call(11, '2026-11-12T10:00:00Z');
  await db.exec('rollback');
  assert.deepEqual(await tags(11), ['Octubre 2026', 'cliente us']);
  assert.equal(await scalar('select count(*)::int v from rendimiento_llamadas where cliente_id=$1', [id(11)]), 0);
});

test('legacy call rows without a valid CRM UUID do not abort registration or attach an unrelated client', async () => {
  await db.query(`insert into rendimiento_llamadas(id,cliente_id,fecha_hora,created_at)
    values($1,'sin ficha','2026-11-12T10:00:00Z','2026-11-12T10:00:00Z')`, [id(++serial)]);
  assert.equal(await scalar('select count(*)::int v from crm_client_activity_month where cliente_id=$1', [id(11)]), 0);
});

test('the real server role can record a call and atomically preserve its automatic label', async () => {
  await client(12, ['Octubre 2026']);
  const custom = await tagId('VIP fixture');
  await db.exec('set role service_role');
  try {
    await call(12, '2026-11-12T10:00:00Z');
    await db.query('select tc_crm_replace_client_tags($1,$2::uuid[])', [id(12), [custom]]);
    assert.deepEqual(await tags(12), ['Noviembre 2026', 'VIP fixture']);
  } finally {
    await db.exec('reset role');
  }
});

test('month matcher is anchored and does not erase month-themed campaigns', async () => {
  for (const label of ['Noviembre', 'noviembre2026', 'Julio 2026', 'Septiembre-2026']) {
    assert.equal(await scalar('select tc_crm_is_month_tag($1) v', [label]), true, label);
  }
  for (const label of ['Noviembre VIP', 'Promoción noviembre 2026', 'cliente us', '2026']) {
    assert.equal(await scalar('select tc_crm_is_month_tag($1) v', [label]), false, label);
  }
});

test('anonymous and authenticated clients cannot grant themselves activity or replace CRM labels', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query('select tc_crm_record_activity($1,now(),$2,$3)', [id(1), 'call', id(9000)]), /permission denied/i);
      await assert.rejects(db.query('select tc_crm_replace_client_tags($1,$2::uuid[])', [id(1), []]), /permission denied/i);
    } finally {
      await db.exec('reset role');
    }
  }
});
