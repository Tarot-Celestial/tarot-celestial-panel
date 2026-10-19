const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const sql = async (query, params = []) => (await db.query(query, params)).rows;
const rpc = async (query, params = []) => (await sql(`select ${query} result`, params))[0].result;
const list = (user = 1) => rpc('tc_atlas_minute_watches($1)', [id(user)]);
const watch = (client = 10, threshold = 30, enabled = true, user = 1) => rpc('tc_atlas_upsert_minute_watch($1,$2,$3,$4)', [id(user), id(client), threshold, enabled]);
const balance = (free, normal, client = 10) => sql('update crm_clientes set minutos_free_pendientes=$1,minutos_normales_pendientes=$2 where id=$3', [free, normal, id(client)]);
const count = async table => (await sql(`select count(*)::int n from ${table}`))[0].n;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text);
    create table crm_clientes(id uuid primary key,nombre text,apellido text,minutos_free_pendientes integer not null default 0,minutos_normales_pendientes integer not null default 0,updated_at timestamptz default now());
    create table atlas_admin_audit(id uuid default gen_random_uuid(),worker_id uuid not null,action text,entity_type text,entity_id text,detail jsonb,created_at timestamptz default now());
    create function tc_atlas_admin(p_user uuid) returns uuid language plpgsql stable security invoker as $$
      declare actor uuid; begin select id into actor from workers where user_id=p_user and role='admin' and is_active is distinct from false;
      if actor is null then raise exception 'FORBIDDEN'; end if; return actor; end $$;
    revoke all on function tc_atlas_admin(uuid) from public; grant execute on function tc_atlas_admin(uuid) to service_role;
    grant select,update on crm_clientes to service_role,authenticated; grant select on workers to service_role; grant insert on atlas_admin_audit to service_role;
    insert into workers values('${id(1)}','${id(1)}','admin',true,'Alex'),('${id(2)}','${id(2)}','admin',true,'Other'),('${id(3)}','${id(3)}','central',true,'Isa'),('${id(4)}','${id(4)}','admin',false,'Inactive');`);
  const dir = path.join(__dirname, '../supabase/migrations');
  const migration = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(p => p.endsWith('_atlas_client_minute_watches.sql'))), 'utf8');
  await db.exec(migration); await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(`reset role; truncate atlas_client_minute_alerts,atlas_client_minute_watches,atlas_admin_audit,crm_clientes cascade;
    insert into crm_clientes(id,nombre,minutos_free_pendientes,minutos_normales_pendientes) values('${id(10)}','Cliente A',40,105),('${id(11)}','Cliente B',0,0);`);
});
after(async () => { await db.close(); });

test('authoritative FREE plus normal total is read without any balance mutation or GET side effect', async () => {
  await db.exec('set role service_role');
  const created = await watch();
  assert.equal(created.watches[0].balance.total, 145); assert.equal(created.watches[0].threshold, 30); assert.equal(created.unreadCount, 0);
  await db.exec('reset role'); const audit = await count('atlas_admin_audit');
  const before = await sql('select * from crm_clientes order by id');
  await list(); await list(); await watch();
  assert.deepEqual(await sql('select * from crm_clientes order by id'), before);
  assert.equal(await count('atlas_admin_audit'), audit); assert.equal(await count('atlas_client_minute_watches'), 1);
});
test('crossing exactly thirty, falling to zero and repeated writes creates one durable episode without an open panel', async () => {
  await watch();
  await balance(20, 11); assert.equal(await count('atlas_client_minute_alerts'), 0);
  await balance(20, 10); assert.equal(await count('atlas_client_minute_alerts'), 1);
  await balance(10, 20); await balance(0, 0); await balance(0, 0);
  const result = await list(); assert.equal(result.unreadCount, 1); assert.equal(result.watches[0].balance.total, 0);
  assert.equal(result.watches[0].alert.totalAtTrigger, 30); assert.equal(await count('atlas_client_minute_alerts'), 1);
});
test('creating a watch already at zero alerts immediately and missing clients are never interpreted as zero', async () => {
  const result = await watch(11); assert.equal(result.unreadCount, 1); assert.equal(result.watches[0].alert.totalAtTrigger, 0);
  await assert.rejects(watch(12), /CLIENT_NOT_FOUND/); assert.equal(await count('atlas_client_minute_watches'), 1);
  for (const threshold of [-1, 1001, null]) await assert.rejects(watch(10, threshold), /INVALID_WATCH/);
});
test('acknowledgment is repeat safe and only a balance above threshold rearms a fresh alert', async () => {
  await watch(); await balance(0, 30); const first = (await list()).watches[0].alert.id;
  const ack = () => rpc('tc_atlas_ack_minute_alert($1,$2)', [id(1), first]);
  assert.equal((await ack()).unreadCount, 0); await ack();
  await balance(0, 29); await watch(); assert.equal((await list()).unreadCount, 0);
  assert.equal(await count('atlas_client_minute_alerts'), 1);
  await balance(0, 31); assert.equal((await list()).watches[0].alert, null);
  await balance(0, 30); const next = await list();
  assert.notEqual(next.watches[0].alert.id, first); assert.equal(next.unreadCount, 1); assert.equal(await count('atlas_client_minute_alerts'), 2);
  assert.equal((await sql("select count(*)::int n from atlas_admin_audit where action='minute_alert_acknowledged'"))[0].n, 1);
});
test('pausing suppresses new alerts, re-enabling checks the current balance, and toggling does not duplicate an episode', async () => {
  const initial = await watch(); const watchId = initial.watches[0].id;
  const enabled = value => rpc('tc_atlas_set_minute_watch_enabled($1,$2,$3)', [id(1), watchId, value]);
  await enabled(false); await balance(0, 20); assert.equal(await count('atlas_client_minute_alerts'), 0);
  assert.equal((await enabled(true)).unreadCount, 1); assert.equal(await count('atlas_client_minute_alerts'), 1);
  await enabled(false); assert.equal((await list()).unreadCount, 0);
  await enabled(true); assert.equal(await count('atlas_client_minute_alerts'), 1);
  await enabled(false); await balance(0, 80); await balance(0, 10); await enabled(true);
  assert.equal(await count('atlas_client_minute_alerts'), 2);
});
test('two admins can watch independently and cannot pause or acknowledge one another', async () => {
  const one = await watch(); await watch(10, 15, true, 2);
  await balance(0, 20); assert.equal((await list(1)).unreadCount, 1); assert.equal((await list(2)).unreadCount, 0);
  const alert = (await list()).watches[0].alert.id;
  await assert.rejects(rpc('tc_atlas_ack_minute_alert($1,$2)', [id(2), alert]), /ALERT_NOT_FOUND/);
  await assert.rejects(rpc('tc_atlas_set_minute_watch_enabled($1,$2,false)', [id(2), one.watches[0].id]), /WATCH_NOT_FOUND/);
  await balance(0, 15); assert.equal((await list(2)).unreadCount, 1);
  assert.equal((await list(1)).watches.length, 1); assert.equal((await list(2)).watches.length, 1);
});
test('server RPCs reject inactive/central identities and browser roles cannot read or execute admin watches', async () => {
  for (const user of [3, 4, 99]) { await assert.rejects(list(user), /FORBIDDEN/); await assert.rejects(watch(10, 30, true, user), /FORBIDDEN/); }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(sql('select * from atlas_client_minute_watches'), /permission denied/);
    await assert.rejects(list(), /permission denied/);
    await assert.rejects(rpc('atlas_private.evaluate_minute_watches($1)', [id(10)]), /permission denied/);
    await db.exec('reset role');
  }
  const rls = await sql("select relrowsecurity from pg_class where relname in ('atlas_client_minute_watches','atlas_client_minute_alerts')");
  assert.ok(rls.every(row => row.relrowsecurity));
});
test('authorized CRM browser updates trigger private alerts without granting access to the admin tables', async () => {
  await watch(); await db.exec('set role authenticated'); await balance(0, 10); await db.exec('reset role');
  assert.equal((await list()).unreadCount, 1);
  assert.equal((await sql("select has_table_privilege('authenticated','atlas_client_minute_alerts','SELECT') allowed"))[0].allowed, false);
});
test('a rolled-back consumption leaves neither changed balance nor phantom notification', async () => {
  await watch(); await db.exec('begin'); await balance(0, 5); assert.equal(await count('atlas_client_minute_alerts'), 1); await db.exec('rollback');
  const result = await list(); assert.equal(result.watches[0].balance.total, 145); assert.equal(result.unreadCount, 0); assert.equal(await count('atlas_client_minute_alerts'), 0);
});
test('threshold changes preserve a low episode, resolve when no longer low, and handle FREE/normal independently', async () => {
  await watch(); await balance(25, 10); assert.equal((await list()).unreadCount, 0);
  await watch(10, 35); assert.equal((await list()).unreadCount, 1);
  await watch(10, 40); assert.equal(await count('atlas_client_minute_alerts'), 1);
  await watch(10, 30); assert.equal((await list()).watches[0].alert, null);
  await balance(-5, 30); const result = await list(); assert.equal(result.watches[0].balance.free, 0); assert.equal(result.watches[0].balance.total, 30);
  assert.equal(await count('atlas_client_minute_alerts'), 2);
});
