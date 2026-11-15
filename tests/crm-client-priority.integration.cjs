const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Fictional data only; exercise the actual migration in local PostgreSQL.
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261115183236_crm_client_priority.sql'), 'utf8');
const history = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261113225107_crm_activity_month_history_2026.sql'), 'utf8');
const oracleHelper = history.match(/create or replace function public\.tc_crm_is_paid_stripe_oracle_purchase\([\s\S]*?\n\$\$;/)[0];
const id = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AS_OF = '2026-11-15T12:00:00Z';
const OLD = '2026-01-01T12:00:00Z';
const signature = 'public.tc_crm_client_priority_page(uuid[],text,text[],text,text,jsonb,timestamptz,integer)';
let db;
let sequence = 10000;

async function client(n, tag = 1, attrs = {}) {
  await db.query(`insert into crm_clientes(id,nombre,apellido,email,pais,telefono,telefono_normalizado,origen,
    onboarding_completado,total_accesos,ultimo_acceso_at,ultima_actividad_at,captured_at,created_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
  [id(n), attrs.nombre || `Persona ${n}`, attrs.apellido || null, attrs.email || null, attrs.pais || null,
    attrs.telefono || null, attrs.telefono_normalizado || null, attrs.origen || null,
    attrs.onboarding_completado || false, attrs.total_accesos || 0, attrs.ultimo_acceso_at || null,
    attrs.ultima_actividad_at || null, attrs.captured_at || null, attrs.created_at || OLD]);
  await db.query('insert into crm_cliente_etiquetas values($1,$2,$3)', [id(n), id(tag), attrs.tag_created_at || OLD]);
}
async function payment(n, amount, attrs = {}) {
  const paymentId = id(++sequence);
  await db.query('insert into crm_cliente_pagos values($1,$2,$3,$4,$5,$6,$7)',
    [paymentId, id(n), amount, attrs.state || 'completed', attrs.currency || 'EUR', attrs.created_at || OLD, attrs.call || null]);
  return paymentId;
}
async function call(n, amount = 0, attrs = {}) {
  const callId = id(++sequence);
  await db.query('insert into rendimiento_llamadas values($1,$2,$3,$4,$5)',
    [callId, typeof n === 'number' ? id(n) : n, amount, attrs.created_at || OLD, attrs.event_at === null ? null : attrs.event_at || OLD]);
  return callId;
}
async function page(options = {}) {
  return (await db.query(`select * from public.tc_crm_client_priority_page($1,$2,$3,$4,$5,$6,$7,$8)`,
    [options.tags || [id(1)], options.search || '', options.phones || [], options.country || '', options.web || 'todos',
      options.after || null, options.asOf || AS_OF, options.limit ?? 121])).rows;
}
const cursor = row => ({ cliente_id: row.cliente_id, gasto_total: row.gasto_total, compras: row.compras, ultima_actividad_at: row.ultima_actividad_at });
async function isolated(fn) { await db.exec('begin'); try { await fn(); } finally { await db.exec('rollback'); } }

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table crm_clientes(id uuid primary key,nombre text,apellido text,email text,pais text,telefono text,
      telefono_normalizado text,origen text,onboarding_completado boolean,total_accesos integer,
      ultimo_acceso_at timestamptz,ultima_actividad_at timestamptz,captured_at timestamptz,created_at timestamptz);
    create table crm_cliente_etiquetas(cliente_id uuid,etiqueta_id uuid,created_at timestamptz);
    create table crm_cliente_pagos(id uuid primary key,cliente_id uuid,importe numeric,estado text,moneda text,
      created_at timestamptz,source_rendimiento_id uuid);
    create table rendimiento_llamadas(id uuid primary key,cliente_id text,importe numeric,created_at timestamptz,fecha_hora timestamptz);
    create table crm_client_activity_month(cliente_id uuid primary key,last_activity_at timestamptz,updated_at timestamptz);
    create table crm_client_capture_audit(client_id uuid,action text,created_at timestamptz);
    create table captacion_leads(cliente_id uuid,estado text,created_at timestamptz,updated_at timestamptz,closed_at timestamptz);
    create table cliente_payment_attempts(cliente_id uuid,status text,amount numeric,created_at timestamptz,completed_at timestamptz);
    create table cliente_oracle_credit_movements(cliente_id uuid,amount integer,movement_type text,reference text,meta jsonb,created_at timestamptz);
    create table cliente_oracle_question_movements(like cliente_oracle_credit_movements);
    grant usage on schema public to service_role;
    grant select on all tables in schema public to service_role;
  `);
  await db.exec(oracleHelper);
  await db.exec(migration);
  for (let n = 1; n <= 145; n++) { await client(n); await payment(n, 1000 - n); }
});
after(async () => { await db?.close(); });

test('global order crosses 120 rows without duplicates or skipped clients', async () => {
  const first = await page();
  assert.equal(first.length, 121);
  assert.equal(first[0].cliente_id, id(1));
  const next = await page({ after: cursor(first[119]) });
  assert.equal(next.length, 25);
  const combined = [...first.slice(0, 120), ...next];
  assert.deepEqual(combined.map(r => r.cliente_id), Array.from({ length: 145 }, (_, i) => id(i + 1)));
  assert.equal(new Set(combined.map(r => r.cliente_id)).size, 145);
});

test('spend then purchase count then actual activity then UUID; nonbuyers last', () => isolated(async () => {
  for (const n of [300, 301, 302, 303, 304, 305]) await client(n, 2);
  await payment(300, 50); await payment(300, 50);
  await payment(301, 100); await payment(302, 100); await payment(303, 101);
  await call(301, 0, { event_at: '2026-11-01T10:00Z' });
  await call(302, 0, { event_at: '2026-11-02T10:00Z' });
  await call(304, 0, { event_at: '2026-11-15T10:00Z' });
  const rows = await page({ tags: [id(2)] });
  assert.deepEqual(rows.map(r => r.cliente_id), [303, 300, 302, 301, 304, 305].map(id));
  for (let i = 0; i < rows.length; i++) {
    assert.deepEqual((await page({ tags: [id(2)], after: cursor(rows[i]) })).map(r => r.cliente_id), rows.slice(i + 1).map(r => r.cliente_id));
  }
}));

test('null activity ties use UUID and repeated matching tag relations do not duplicate', () => isolated(async () => {
  await client(310, 3); await client(311, 3); await client(312, 3);
  await db.query('insert into crm_cliente_etiquetas values($1,$2,$3)', [id(310), id(4), OLD]);
  const rows = await page({ tags: [id(3), id(4)] });
  assert.deepEqual(rows.map(r => r.cliente_id), [310, 311, 312].map(id));
  assert.equal(rows[0].ultima_actividad_at, null);
  assert.deepEqual((await page({ tags: [id(3), id(4)], after: cursor(rows[0]) })).map(r => r.cliente_id), [311, 312].map(id));
}));

test('completed payments and unlinked legacy calls count once; any linked state suppresses calls', () => isolated(async () => {
  await client(320, 5);
  const paidCall = await call(320, 100);
  await payment(320, 100, { call: paidCall });
  const cancelledCall = await call(320, 1000);
  await payment(320, 1000, { state: 'cancelled', call: cancelledCall });
  const failedCall = await call(320, 2000);
  await payment(320, 2000, { state: 'failed', call: failedCall });
  await payment(320, 5000, { state: 'pending' }); await payment(320, 0); await payment(320, -10);
  await call(` ${id(320)} `, 50); await call('unlinked-import-name', 9999); await call(id(99999), 9999);
  await call(320, 0); await call(320, -30);
  const [row] = await page({ tags: [id(5)] });
  assert.equal(Number(row.gasto_total), 150); assert.equal(Number(row.compras), 2);
}));

test('currency breakdown preserves USD; no invented conversion or relabelled currency', () => isolated(async () => {
  await client(330, 6); await payment(330, 10.25); await payment(330, 22, { currency: 'USD' });
  await call(330, 1.25);
  const [row] = await page({ tags: [id(6)] });
  assert.equal(Number(row.gasto_total), 33.5);
  assert.deepEqual(row.gasto_por_moneda, { EUR: 11.5, USD: 22 });
}));

test('snapshot excludes newly inserted clients, tag memberships and backdated purchases/calls', () => isolated(async () => {
  await client(340, 7); await payment(340, 10);
  const before = await page({ tags: [id(7)] });
  const future = '2026-11-15T13:00:00Z';
  await payment(340, 999, { created_at: future });
  await call(340, 888, { created_at: future, event_at: OLD });
  await call(340, 777, { created_at: OLD, event_at: future });
  await client(341, 7, { created_at: future }); await payment(341, 999);
  await client(342, 7, { tag_created_at: future }); await payment(342, 999);
  assert.deepEqual(await page({ tags: [id(7)] }), before);
}));

test('snapshot recovers older actual activity when live month state advanced after cutoff', () => isolated(async () => {
  await client(350, 8);
  await call(350, 0, { event_at: '2026-11-14T12:00Z' });
  await db.query('insert into crm_client_activity_month values($1,$2,$3)', [id(350), '2026-11-15T13:00Z', '2026-11-15T13:00Z']);
  const [row] = await page({ tags: [id(8)] });
  assert.equal(new Date(row.ultima_actividad_at).toISOString(), '2026-11-14T12:00:00.000Z');
}));

test('real capture and paid web/Oracle activity count; login and free ledger gifts do not', () => isolated(async () => {
  for (const n of [360, 361, 362, 363, 364]) await client(n, 9, { ultimo_acceso_at: AS_OF, ultima_actividad_at: AS_OF });
  await db.query('insert into crm_client_capture_audit values($1,$2,$3)', [id(360), 'capture_confirmed', '2026-11-10T10:00Z']);
  await db.query('insert into cliente_payment_attempts values($1,$2,$3,$4,$5)', [id(361), 'completed', 2, OLD, '2026-11-11T10:00Z']);
  await db.query('insert into cliente_payment_attempts values($1,$2,$3,$4,$5)', [id(364), 'pending', 99, OLD, AS_OF]);
  await db.query('insert into cliente_oracle_credit_movements values($1,2,$2,$3,$4,$5)',
    [id(362), 'purchase', 'stripe:cs_fixture_362', { stripe_session_id: 'cs_fixture_362', amount_eur: 2 }, '2026-11-12T10:00Z']);
  await db.query('insert into cliente_oracle_question_movements values($1,2,$2,$3,$4,$5)',
    [id(363), 'purchase', 'rank:gift', { amount_eur: 2 }, AS_OF]);
  const rows = await page({ tags: [id(9)] });
  assert.deepEqual(rows.map(r => r.cliente_id), [362, 361, 360, 363, 364].map(id));
  assert.equal(rows[3].ultima_actividad_at, null); assert.equal(rows[4].ultima_actividad_at, null);
}));

test('all filters run before paging: full name, reverse name, email, phones, country and brand', () => isolated(async () => {
  await client(370, 10, { nombre: 'Maria', apellido: 'Garcia Lopez', email: 'maria@example.test', pais: 'España', telefono: '+34123456789', telefono_normalizado: '34123456789' });
  await client(371, 10, { nombre: 'Maria', apellido: 'Garcia Lopez', email: 'other@example.test', pais: 'España', origen: 'Orion legacy' });
  await client(372, 11, { nombre: 'Maria', apellido: 'Garcia Lopez' });
  for (const opts of [{ search: 'Maria Garcia Lopez' }, { search: 'Garcia Maria' }, { search: 'maria@example.test' }, { phones: ['34123456789'] }, { country: 'spa' }]) {
    assert.deepEqual((await page({ tags: [id(10)], ...opts })).map(r => r.cliente_id), [id(370)], JSON.stringify(opts));
  }
  assert.equal((await page({ tags: [id(10)], search: 'missing' })).length, 0);
  assert.equal((await page({ tags: [id(10)], phones: ['000'], search: 'Maria' })).length, 0);
}));

test('web registration filters retain existing CRM semantics before paging', () => isolated(async () => {
  await client(380, 12); await client(381, 12, { onboarding_completado: true });
  await client(382, 12, { total_accesos: 1 }); await client(383, 12, { ultima_actividad_at: OLD });
  assert.deepEqual((await page({ tags: [id(12)], web: 'no_registrados' })).map(r => r.cliente_id), [id(380)]);
  assert.deepEqual((await page({ tags: [id(12)], web: 'registrados' })).map(r => r.cliente_id), [381, 382, 383].map(id));
  assert.deepEqual((await page({ tags: [id(12)], web: 'onboarding_pendiente' })).map(r => r.cliente_id), [382, 383].map(id));
}));

test('invalid limits, tags, filter and malformed cursors fail closed', async () => {
  for (const opts of [{ limit: 0 }, { limit: 122 }, { tags: [] }, { web: 'bad' }, { after: {} },
    { after: { cliente_id: id(1), gasto_total: -1, compras: 0, ultima_actividad_at: null } }]) {
    await assert.rejects(page(opts));
  }
});

test('service-only RPC is stable invoker and roles cannot call it directly', async () => {
  const [acl] = (await db.query(`select has_function_privilege('anon',$1,'EXECUTE') anon,
    has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
    has_function_privilege('service_role',$1,'EXECUTE') service`, [signature])).rows;
  assert.deepEqual(acl, { anon: false, authenticated: false, service: true });
  const [fn] = (await db.query(`select prosecdef,provolatile from pg_proc where oid=$1::regprocedure`, [signature])).rows;
  assert.equal(fn.prosecdef, false); assert.equal(fn.provolatile, 's');
  await isolated(async () => { await db.exec('set local role service_role'); assert.equal((await page()).length, 121); });
  await isolated(async () => { await db.exec('set local role anon'); await assert.rejects(page(), /permission denied/); });
  await isolated(async () => { await db.exec('set local role authenticated'); await assert.rejects(page(), /permission denied/); });
});

test('migration replay and reads preserve all original source rows', async () => {
  const dump = async () => (await db.query(`select jsonb_build_object(
    'clients',(select jsonb_agg(to_jsonb(c) order by c.id) from crm_clientes c),
    'payments',(select jsonb_agg(to_jsonb(p) order by p.id) from crm_cliente_pagos p),
    'tags',(select jsonb_agg(to_jsonb(t) order by t.cliente_id,t.etiqueta_id) from crm_cliente_etiquetas t),
    'calls',(select jsonb_agg(to_jsonb(l) order by l.id) from rendimiento_llamadas l)) snapshot`)).rows[0].snapshot;
  const initial = await dump(); await db.exec(migration); await page(); await page({ tags: [id(100)] });
  assert.deepEqual(await dump(), initial);
});
