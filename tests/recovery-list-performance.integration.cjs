const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Synthetic fixtures only. No customer or worker identities from production.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const signature = 'public.tc_recovery_list(uuid,text,text,text,text,integer)';
const cases = [
  ['pending', 'pending', '', '', '', 1],
  ['recycled', 'recycled', '', '', '', 1],
  ['recovered', 'recovered', '', '', '', 1],
  ['contacted status', 'pending', 'contacted', '', '', 1],
  ['no response status', 'pending', 'no_response', '', '', 1],
  ['pending status', 'pending', 'pending', '', '', 1],
  ['unknown status', 'pending', 'unknown', '', '', 1],
  ['old month tag', 'pending', '', '', 'JUNIO2026', 1],
  ['nondated tag with old month', 'pending', '', '', 'VIP', 1],
  ['no tags', 'pending', '', '', '__none__', 1],
  ['unknown tag', 'pending', '', '', 'NOT_PRESENT', 1],
  ['recycled recent tag', 'recycled', '', '', 'OCTUBRE2026', 1],
  ['name search case insensitive', 'pending', '', 'cLiEnTe 00', '', 1],
  ['phone search formatted', 'pending', '', '600 100', '', 1],
  ['phone search digits', 'pending', '', '34600100', '', 1],
  ['no matches', 'pending', '', 'NOT_A_CUSTOMER', '', 1],
  ['second page', 'pending', '', '', '', 2],
  ['third page', 'pending', '', '', '', 3],
  ['zero page clamps', 'pending', '', '', '', 0],
  ['negative page clamps', 'pending', '', '', '', -4],
  ['past final page', 'pending', '', '', '', 99],
  ['unknown bucket', 'unknown', '', '', '', 1],
];
let db, baselineMetadata, baselineView;
const baseline = new Map();
const sql = async (query, params = []) => (await db.query(query, params)).rows;
const list = async (args, user = id(1)) => (await sql(
  'select public.tc_recovery_list($1,$2,$3,$4,$5,$6) as result', [user, ...args]
))[0].result;
const metadata = async () => (await sql(`select p.prosecdef, p.provolatile,
  p.proowner::regrole::text as owner, p.proacl::text as grants, p.proconfig,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'execute') as service_execute
  from pg_proc p where p.oid=$1::regprocedure`, [signature]))[0];

before(async () => {
  db = new PGlite();
  // Same base dependencies as central-recovery-missions.integration.cjs.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text);
    create table crm_clientes(id uuid primary key,nombre text,apellido text,telefono text,origen text);
    create table crm_etiquetas(id uuid primary key,nombre text);
    create table crm_cliente_etiquetas(cliente_id uuid references crm_clientes(id),etiqueta_id uuid references crm_etiquetas(id));
    create table crm_cliente_pagos(id uuid primary key,cliente_id uuid references crm_clientes(id),estado text,importe numeric,created_at timestamptz default now());
    create table worker_xp_rules(action_key text primary key,name text,description text,xp_reward integer,frequency text,enabled boolean,integration_status text);
    create table worker_xp_events(id uuid primary key default gen_random_uuid(),worker_id uuid references workers(id),action_key text,xp_amount integer,reference_id text,reference_label text,origin text,status text,metadata jsonb,created_by_worker_id uuid,created_at timestamptz default now());
    insert into workers values
      ('${id(11)}','${id(1)}','central',true,'Central Test'),
      ('${id(12)}','${id(2)}','admin',true,'Admin Test'),
      ('${id(13)}','${id(3)}','central',false,'Inactive Test'),
      ('${id(14)}','${id(4)}','tarotista',true,'Other Role Test');
    insert into crm_clientes
      select ('00000000-0000-4000-8000-'||lpad((100+g)::text,12,'0'))::uuid,
      'Cliente '||lpad(g::text,3,'0'),'Prueba','+34 600 '||(100000+g)::text,'celestial'
      from generate_series(1,100) g;
    insert into crm_clientes values
      ('${id(301)}','Excluded','Orion','600123456','OrIoN campaign'),
      ('${id(302)}','Excluded','Short phone','12-3','celestial'),
      ('${id(303)}','Excluded','Null phone',null,null),
      ('${id(304)}','  Spaced',null,'600123499',null);
    insert into crm_etiquetas values
      ('${id(401)}','JUNIO2026'),('${id(402)}','2026-05'),
      ('${id(403)}','OCTUBRE2026'),('${id(404)}','VIP'),
      ('${id(405)}','2025'),('${id(406)}','06/2026');
    insert into crm_cliente_etiquetas
      select ('00000000-0000-4000-8000-'||lpad((100+g)::text,12,'0'))::uuid,
      case g%6 when 1 then '${id(401)}' when 2 then '${id(402)}'
        when 3 then '${id(403)}' when 4 then '${id(404)}' else '${id(405)}' end::uuid
      from generate_series(1,100) g where g%6<>0;
    insert into crm_cliente_etiquetas
      select ('00000000-0000-4000-8000-'||lpad((100+g)::text,12,'0'))::uuid,
      case g%6 when 2 then '${id(404)}' else '${id(403)}' end::uuid
      from generate_series(1,100) g where g%6 in (2,5);
    grant select on workers,crm_clientes,crm_etiquetas,crm_cliente_etiquetas to service_role;
  `);
  const dir = path.join(__dirname, '../supabase/migrations');
  await db.exec(fs.readFileSync(path.join(dir, '20261006182809_client_recovery.sql'), 'utf8'));
  await db.exec(`
    insert into crm_cliente_pagos(id,cliente_id,estado,importe,created_at)
      values('${id(501)}','${id(105)}','completed',20,'2026-10-20T12:00:00Z');
    insert into crm_client_recovery(client_id,status,responsible_id,contacted_at,updated_at)
      values('${id(101)}','contacted','${id(11)}','2026-10-19T12:00:00Z','2026-10-19T12:00:00Z'),
            ('${id(102)}','no_response','${id(11)}','2026-10-19T13:00:00Z','2026-10-19T13:00:00Z'),
            ('${id(103)}','recycled','${id(11)}',null,'2026-10-19T14:00:00Z'),
            ('${id(106)}','pending',null,null,'2026-10-19T15:00:00Z');
    insert into crm_client_recovery(client_id,status,responsible_id,contacted_at,updated_at,recovered_at,payment_id,purchase_amount,xp)
      values('${id(105)}','recovered','${id(11)}','2026-10-19T12:00:00Z','2026-10-20T12:00:00Z','2026-10-20T12:00:00Z','${id(501)}',20,75);
  `);
  baselineMetadata = await metadata();
  baselineView = (await sql("select pg_get_viewdef('public.tc_recovery_candidates'::regclass,true) as definition"))[0].definition;
  for (const [name, ...args] of cases) baseline.set(name, await list(args));
  assert.ok(baseline.get('pending').total > 25, 'fixture exercises pagination');
  assert.equal(baseline.get('recycled').contacts.length, 1);
  assert.equal(baseline.get('recovered').contacts.length, 1);
  await assert.rejects(list(cases[0].slice(1), id(3)), /FORBIDDEN/);
  await assert.rejects(list(cases[0].slice(1), id(4)), /FORBIDDEN/);

  const migration = fs.readFileSync(path.join(dir, '20261024031500_optimize_recovery_list.sql'), 'utf8');
  // Run the actual DDL inside the same transaction boundary as migration runners.
  await db.exec(`begin;\n${migration}\ncommit;`);
  await db.exec(`begin;\n${migration}\ncommit;`); // Safe repeated application.
});
after(async () => { if (db) await db.close(); });

for (const [name, ...args] of cases) {
  test(`optimized list preserves complete JSON: ${name}`, async () => {
    assert.deepEqual(await list(args), baseline.get(name));
  });
}

test('owner, invoker rights, volatility, configuration and role grants are preserved', async () => {
  assert.deepEqual(await metadata(), baselineMetadata);
  assert.equal(baselineMetadata.prosecdef, false);
  assert.equal(baselineMetadata.anon_execute, false);
  assert.equal(baselineMetadata.authenticated_execute, false);
  assert.equal(baselineMetadata.service_execute, true);
});

test('inactive, wrong-role and unknown users remain forbidden; active admin is accepted', async () => {
  for (const user of [id(3), id(4), id(999)]) {
    await assert.rejects(list(cases[0].slice(1), user), /FORBIDDEN/);
  }
  assert.deepEqual(await list(cases[0].slice(1), id(2)), baseline.get('pending'));
});

test('browser roles cannot execute the RPC, while the service role can', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(list(cases[0].slice(1)), /permission denied for function tc_recovery_list/); }
    finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { assert.deepEqual(await list(cases[0].slice(1)), baseline.get('pending')); }
  finally { await db.exec('reset role'); }
});

test('shared candidate view and persisted recovery/payment rows are unchanged', async () => {
  assert.equal((await sql("select pg_get_viewdef('public.tc_recovery_candidates'::regclass,true) as definition"))[0].definition, baselineView);
  assert.deepEqual((await sql('select (select count(*)::int from crm_client_recovery) as recoveries,(select count(*)::int from crm_cliente_pagos) as payments,(select count(*)::int from worker_xp_events) as xp'))[0], { recoveries: 5, payments: 1, xp: 0 });
});
