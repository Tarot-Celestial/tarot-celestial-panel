const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Local Postgres only: no credentials, network requests or production records.
// PGlite serializes requests; repeated calls below verify idempotency, not
// multi-connection PostgreSQL lock scheduling.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const scalar = async (sql, values = []) => (await db.query(sql, values)).rows[0]?.v;
const rows = async (table, raffle = id(1)) => (await db.query(`select to_jsonb(t) as row from ${table} t where raffle_id = $1 order by id`, [raffle])).rows.map(r => r.row);
const manage = (action, data = {}, { raffle = id(1), worker = id(101) } = {}) => scalar(
  'select public.tc_raffle_manage($1::uuid,$2::uuid,$3::text,$4::jsonb) v',
  [raffle, worker, action, JSON.stringify(data)],
);
const reset = (data = {}, options) => manage('reset', { request_id: id(901), confirmed: true, ...data }, options);
const active = () => scalar("select to_jsonb(r) v from raffles r where status = 'active'");
const snapshot = () => scalar(`select jsonb_build_object(
  'raffles', (select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from raffles r),
  'entries', (select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from raffle_entries e),
  'prizes', (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from raffle_prizes p),
  'audit', (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from raffle_selection_audit a)
) v`);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table workers (
      id uuid primary key, user_id uuid, role text, is_active boolean,
      display_name text, email text
    );
    create table crm_clientes (
      id uuid primary key, auth_user_id uuid, nombre text, apellido text,
      telefono text, telefono_normalizado text, email text
    );
    create table raffles (
      id uuid primary key default gen_random_uuid(), title text not null,
      status text not null default 'active' check (status in ('active','closed')),
      max_number integer not null default 40 check (max_number between 40 and 10000 and max_number % 40 = 0),
      allow_repeat_winners boolean not null default false,
      created_by_worker_id uuid references workers(id),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create unique index raffles_one_active_idx on raffles(status) where status = 'active';
    create table raffle_entries (
      id uuid primary key default gen_random_uuid(), raffle_id uuid not null references raffles(id),
      raffle_number integer not null, client_id uuid not null references crm_clientes(id),
      client_auth_user_id uuid, assigned_by_worker_id uuid references workers(id),
      assigned_at timestamptz not null default now(), unique (raffle_id, raffle_number)
    );
    create table raffle_prizes (
      id uuid primary key default gen_random_uuid(), raffle_id uuid not null references raffles(id),
      position integer not null check (position between 1 and 100),
      name text not null check (length(btrim(name)) between 1 and 200),
      candidate_entry_id uuid references raffle_entries(id), candidate_number integer,
      selected_at timestamptz, selected_by uuid, confirmed_at timestamptz, confirmed_by uuid,
      selection_method text not null default 'roulette', is_test boolean not null default false,
      simulation_only boolean not null default false, selection_revision bigint not null default 0,
      candidate_client_id uuid references crm_clientes(id), unique (raffle_id, position)
    );
    create table raffle_selection_audit (
      id uuid primary key default gen_random_uuid(), worker_id uuid references workers(id),
      action_type text not null, entity_type text not null default 'raffle_selection',
      entity_id uuid references raffles(id), payload jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    grant select, insert, update on workers, crm_clientes, raffles, raffle_entries, raffle_prizes, raffle_selection_audit to service_role;
  `);
  const migrations = path.join(__dirname, '../supabase/migrations');
  const migration = process.env.RAFFLE_MANAGE_SQL || fs.readdirSync(migrations).filter(name =>
    name.endsWith('.sql') && /function\s+public\.tc_raffle_manage\s*\(/i.test(fs.readFileSync(path.join(migrations, name), 'utf8')),
  ).sort().at(-1);
  assert.ok(migration, 'The actual tc_raffle_manage migration must exist before this test runs');
  const sql = fs.readFileSync(path.isAbsolute(migration) ? migration : path.join(migrations, migration), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // Existing installations can apply the migration again safely.
});

beforeEach(async () => {
  await db.exec('reset role; truncate raffle_selection_audit, raffle_prizes, raffle_entries, raffles, crm_clientes, workers cascade');
  for (const [n, role, enabled] of [[101, 'central', true], [102, 'admin', true], [103, 'central', false], [104, 'tarotista', true], [105, 'central', null]]) {
    await db.query('insert into workers(id,user_id,role,is_active,display_name) values($1,$1,$2,$3,$4)', [id(n), role, enabled, `Operadora ${n}`]);
  }
  await db.query("insert into crm_clientes(id,auth_user_id,nombre,apellido,telefono) values($1,$2,'Clienta','Local','000000000')", [id(201), id(301)]);
  await db.query("insert into crm_clientes(id,nombre,apellido) values($1,'Otra','Local')", [id(202)]);
  await db.query("insert into raffles(id,title,status,max_number,allow_repeat_winners,created_by_worker_id) values($1,'Sorteo histórico a conservar','active',80,true,$2)", [id(1), id(101)]);
  await db.query('insert into raffle_entries(id,raffle_id,raffle_number,client_id,client_auth_user_id,assigned_by_worker_id) values($1,$2,7,$3,$4,$5)', [id(401), id(1), id(201), id(301), id(101)]);
  await db.query("insert into raffle_prizes(id,raffle_id,position,name,candidate_entry_id,candidate_number,candidate_client_id,selected_at,selected_by,confirmed_at,confirmed_by) values($1,$2,1,'Premio ya confirmado',$3,7,$4,now(),$5,now(),$5)", [id(501), id(1), id(401), id(201), id(101)]);
  await db.query("insert into raffle_prizes(id,raffle_id,position,name) values($1,$2,2,'Premio sin sortear')", [id(502), id(1)]);
  await db.query("insert into raffle_selection_audit(id,worker_id,action_type,entity_id,payload) values($1,$2,'confirmed',$3,'{\"fixture\":true}')", [id(601), id(101), id(1)]);
});

after(async () => { if (db) await db.close(); });

test('restart archives the old raffle and creates an empty 40-number raffle without changing its history', async () => {
  const before = await snapshot();
  const result = await reset();
  const next = await active();
  assert.equal(result.raffle.id, next.id);
  assert.equal(result.already_reset, false);
  assert.notEqual(next.id, id(1));
  assert.equal(next.max_number, 40);
  assert.equal(next.status, 'active');
  assert.equal((await rows('raffle_entries', next.id)).length, 0);
  assert.equal((await rows('raffle_prizes', next.id)).length, 0);
  const old = await scalar('select to_jsonb(r) v from raffles r where id = $1', [id(1)]);
  assert.equal(old.status, 'closed');
  assert.equal(old.title, before.raffles[0].title);
  assert.equal(old.max_number, 80);
  assert.equal(old.created_at, before.raffles[0].created_at);
  assert.equal(old.allow_repeat_winners, true);
  assert.deepEqual(await rows('raffle_entries'), before.entries);
  assert.deepEqual(await rows('raffle_prizes'), before.prizes);
  assert.deepEqual(await scalar('select to_jsonb(a) v from raffle_selection_audit a where id=$1', [id(601)]), before.audit[0]);
  assert.equal(await scalar("select count(*)::int v from raffle_selection_audit where action_type='raffle_restarted'"), 1);
});

test('retrying the same reset returns the same new raffle and does not erase new assignments', async () => {
  await reset();
  const next = await active();
  await manage('assign', { raffle_number: 3, client_id: id(202) }, { raffle: next.id });
  const state = await snapshot();
  const retry = await reset();
  assert.equal(retry.raffle.id, next.id);
  assert.equal(retry.already_reset, true);
  assert.deepEqual(await snapshot(), state);
  assert.equal((await active()).id, next.id);
});

test('a different reset request and stale assign/extend against the closed raffle are rejected', async () => {
  await reset();
  const state = await snapshot();
  for (const action of [() => reset({ request_id: id(902) }), () => manage('extend'), () => manage('assign', { raffle_number: 8, client_id: id(202) })]) {
    await assert.rejects(action);
    assert.deepEqual(await snapshot(), state);
  }
});

test('a reset receipt cannot be reused by a different worker or against a different raffle', async () => {
  await reset();
  const state = await snapshot();
  await assert.rejects(reset({}, { worker: id(102) }));
  assert.deepEqual(await snapshot(), state);
  await assert.rejects(reset({}, { raffle: id(999) }));
  assert.deepEqual(await snapshot(), state);
});

test('a selected but unconfirmed prize blocks reset without touching either raffle or prize', async () => {
  await db.query('update raffle_prizes set selected_at=now(),candidate_entry_id=$1,candidate_number=7,candidate_client_id=$2 where id=$3', [id(401), id(201), id(502)]);
  const state = await snapshot();
  await assert.rejects(reset());
  assert.deepEqual(await snapshot(), state);
});

test('reset needs explicit boolean confirmation and a valid request id', async () => {
  const state = await snapshot();
  for (const data of [{}, { confirmed: false, request_id: id(901) }, { confirmed: 'true', request_id: id(901) }, { confirmed: true }, { confirmed: true, request_id: 'bad-id' }]) {
    await assert.rejects(manage('reset', data));
    assert.deepEqual(await snapshot(), state);
  }
});

test('inactive, unknown and wrong-role workers cannot modify raffles', async () => {
  const state = await snapshot();
  for (const worker of [id(103), id(104), id(999), null]) {
    for (const action of ['reset', 'extend', 'assign']) {
      await assert.rejects(manage(action, { confirmed: true, request_id: id(901), raffle_number: 8, client_id: id(202) }, { worker }));
      assert.deepEqual(await snapshot(), state);
    }
  }
});

test('legacy workers with null is_active retain access; only explicit false disables them', async () => {
  // Matches the existing raffle selection RPC and worker gate contract.
  const result = await reset({}, { worker: id(105) });
  assert.equal(result.raffle.created_by_worker_id, id(105));
  assert.equal((await active()).id, result.raffle.id);
});

test('assign validates numbers and clients, never overwrites an occupied number, and extend keeps entries', async () => {
  const state = await snapshot();
  for (const data of [{ raffle_number: 7, client_id: id(202) }, { raffle_number: 0, client_id: id(202) }, { raffle_number: 81, client_id: id(202) }, { raffle_number: 2.5, client_id: id(202) }, { raffle_number: 8, client_id: id(999) }]) {
    await assert.rejects(manage('assign', data));
    assert.deepEqual(await snapshot(), state);
  }
  await manage('assign', { raffle_number: 8, client_id: id(202) });
  await manage('extend');
  assert.equal((await active()).max_number, 120);
  assert.equal((await rows('raffle_entries')).length, 2);
  assert.equal((await rows('raffle_entries')).find(r => r.raffle_number === 8).assigned_by_worker_id, id(101));
});

test('failed new-raffle insertion rolls back the closure and audit record', async () => {
  await db.exec(`create function reject_test_raffle() returns trigger language plpgsql as $$ begin raise exception 'SIMULATED_INSERT_FAILURE'; end $$; create trigger reject_test_raffle before insert on raffles for each row execute function reject_test_raffle()`);
  const state = await snapshot();
  try {
    await assert.rejects(reset(), /SIMULATED_INSERT_FAILURE/);
    assert.deepEqual(await snapshot(), state);
  } finally { await db.exec('drop trigger reject_test_raffle on raffles; drop function reject_test_raffle()'); }
});

test('failed reset audit rolls back the new raffle and leaves the previous one active', async () => {
  await db.exec(`create function reject_test_audit() returns trigger language plpgsql as $$ begin if new.action_type='raffle_restarted' then raise exception 'SIMULATED_AUDIT_FAILURE'; end if; return new; end $$; create trigger reject_test_audit before insert on raffle_selection_audit for each row execute function reject_test_audit()`);
  const state = await snapshot();
  try {
    await assert.rejects(reset(), /SIMULATED_AUDIT_FAILURE/);
    assert.deepEqual(await snapshot(), state);
  } finally { await db.exec('drop trigger reject_test_audit on raffle_selection_audit; drop function reject_test_audit()'); }
});

test('extension stops at 10000 without changing the active raffle or its entries', async () => {
  await db.query('update raffles set max_number=10000 where id=$1', [id(1)]);
  const state = await snapshot();
  await assert.rejects(manage('extend'));
  assert.deepEqual(await snapshot(), state);
});

test('browser roles cannot execute the RPC, even with a forged active worker; service role can', async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await scalar("select has_function_privilege($1,'public.tc_raffle_manage(uuid,uuid,text,jsonb)','EXECUTE') v", [role]), false);
    await db.exec(`set role ${role}`);
    try { await assert.rejects(reset(), error => error.code === '42501'); }
    finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { await reset(); assert.equal((await active()).max_number, 40); }
  finally { await db.exec('reset role'); }
});
