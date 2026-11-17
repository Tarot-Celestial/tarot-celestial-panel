const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
let db;
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = char => char.repeat(64);
async function serviceQuery(sql, args) {
  await db.exec('set role service_role');
  try { return await db.query(sql, args); }
  finally { await db.exec('reset role'); }
}
async function attempt(actor = 1) { return (await serviceQuery('select public.tc_accounting_reserve_login_attempt($1) value', [uid(actor)])).rows[0].value; }
async function open(token = 'a', session = 10, actor = 1, version = 'd') {
  return (await serviceQuery('select public.tc_accounting_open_session($1,$2,$3,$4) value', [uid(actor), uid(session), hash(token), hash(version)])).rows[0].value;
}
async function read(token = 'a', session = 10, actor = 1, version = 'd') {
  return (await serviceQuery('select public.tc_accounting_read_session($1,$2,$3,$4) value', [uid(actor), uid(session), hash(token), hash(version)])).rows[0].value;
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    create table auth.sessions(id uuid primary key, user_id uuid not null, not_after timestamptz);
    insert into auth.sessions(id,user_id) values('${uid(10)}','${uid(1)}'),('${uid(11)}','${uid(1)}'),('${uid(12)}','${uid(2)}');
    revoke all on auth.sessions from public, anon, authenticated, service_role;
    create table public.test_admins(user_id uuid primary key, active boolean);
    insert into public.test_admins values('${uid(1)}', true),('${uid(2)}', true),('${uid(3)}', false);
    create function public.tc_has_admin_access(p_actor uuid) returns boolean language sql stable as $$
      select coalesce((select active from public.test_admins where user_id=p_actor), false); $$;
    grant select on public.test_admins to service_role;`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../scripts/accounting-access-schema.sql'), 'utf8'));
});
after(async () => db.close());

test('database permits exactly five attempts per 15-minute window and denies the sixth', async () => {
  for (let n = 0; n < 5; n++) { const r = await attempt(); assert.equal(r.allowed, true); assert.equal(r.remaining, 4 - n); }
  const denied = await attempt(); assert.equal(denied.allowed, false); assert.ok(denied.retry_after > 0 && denied.retry_after <= 900);
  await db.exec(`update public.tc_accounting_login_attempts set window_started_at = now() - interval '16 minutes' where user_id='${uid(1)}'`);
  assert.equal((await attempt()).remaining, 4);
});

test('opening session resets attempts, stores expiry and binds token to admin/auth session/password version', async () => {
  const created = await open(); assert.ok(Date.parse(created.expires_at) > Date.now());
  assert.equal((await read()).valid, true);
  assert.equal((await read('a', 11)).valid, false);
  assert.equal((await read('a', 10, 2)).valid, false);
  assert.equal((await read('a', 10, 1, 'e')).valid, false);
  assert.equal((await read('b')).valid, false);
  assert.equal((await db.query('select attempts from public.tc_accounting_login_attempts where user_id=$1', [uid(1)])).rows[0].attempts, 0);
});

test('re-unlock replaces old cookie; expiry, logout and admin revocation invalidate sessions', async () => {
  await open('b'); assert.equal((await read('a')).valid, false); assert.equal((await read('b')).valid, true);
  await db.exec(`update public.tc_accounting_access_sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'`);
  assert.equal((await read('b')).valid, false);
  await open('c'); await db.query('select public.tc_accounting_close_session($1,$2)', [uid(1), hash('c')]);
  assert.equal((await read('c')).valid, false);
  await open('f'); await db.exec(`update public.test_admins set active=false where user_id='${uid(1)}'`);
  await assert.rejects(read('f'), /FORBIDDEN/);
  await db.exec(`update public.test_admins set active=true where user_id='${uid(1)}'`);
});

test('unauthorized actors, malformed session values and browser SQL roles are denied', async () => {
  for (const actor of [3, 4]) { await assert.rejects(attempt(actor), /FORBIDDEN/); await assert.rejects(open('a', 10, actor), /FORBIDDEN/); }
  await assert.rejects(db.query('select public.tc_accounting_open_session($1,$2,$3,$4)', [uid(1), uid(10), 'bad', hash('a')]), /INVALID_SESSION/);
  const tables = (await db.query(`select c.relname, c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'select') as anon_select,
    has_table_privilege('authenticated', c.oid, 'insert') as auth_insert
    from pg_class c where c.relname in ('tc_accounting_login_attempts','tc_accounting_access_sessions')`)).rows;
  assert.equal(tables.length, 2);
  for (const table of tables) { assert.equal(table.relrowsecurity, true); assert.equal(table.anon_select, false); assert.equal(table.auth_insert, false); }
  const functions = (await db.query(`select proname, prosecdef,
    has_function_privilege('anon', p.oid, 'execute') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_execute,
    has_function_privilege('service_role', p.oid, 'execute') as server_execute
    from pg_proc p where proname in ('tc_accounting_reserve_login_attempt','tc_accounting_open_session','tc_accounting_read_session','tc_accounting_close_session')`)).rows;
  assert.equal(functions.length, 4);
  for (const f of functions) { assert.equal(f.prosecdef, false); assert.equal(f.anon_execute, false); assert.equal(f.auth_execute, false); assert.equal(f.server_execute, true); }
});

test('public RPCs use INVOKER rights; the private boolean Auth lookup is service-only and grants no Auth table access', async () => {
  assert.equal((await attempt(2)).allowed, true); await open('c', 12, 2); assert.equal((await read('c', 12, 2)).valid, true);
  const info = (await db.query(`select p.prosecdef, p.proconfig,
    has_function_privilege('anon', p.oid, 'execute') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_execute,
    has_function_privilege('service_role', p.oid, 'execute') as server_execute,
    has_table_privilege('service_role', 'auth.sessions', 'select') as auth_table_select
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='tc_accounting_auth_session_active'`)).rows[0];
  assert.equal(info.prosecdef, true);
  assert.deepEqual(info.proconfig, ['search_path=""']);
  assert.equal(info.anon_execute, false); assert.equal(info.auth_execute, false); assert.equal(info.server_execute, true);
  assert.equal(info.auth_table_select, false);
  await assert.rejects(serviceQuery('select * from auth.sessions'), /permission denied/);
  const ownerCall = (await db.query('select private.tc_accounting_auth_session_active($1,$2) active', [uid(1),uid(10)])).rows[0];
  assert.equal(ownerCall.active, false, 'privileged owner SQL still fails the strict caller role guard');
});

test('deleted Supabase Auth session invalidates cookie immediately and cannot be reopened with the old bearer session id', async () => {
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [uid(13),uid(1)]);
  await open('1', 13);
  assert.equal((await read('1', 13)).valid, true);
  await db.query('delete from auth.sessions where id=$1', [uid(13)]);
  assert.equal((await read('1', 13)).valid, false);
  await assert.rejects(open('2', 13), /AUTH_SESSION_REVOKED/);
});

test('Supabase Auth not_after expiry and subject or session-owner mismatches fail closed', async () => {
  await db.query('insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval \'10 minutes\')', [uid(14),uid(1)]);
  await open('3', 14);
  assert.equal((await read('3', 14)).valid, true);
  await db.query('update auth.sessions set not_after=now()-interval \'1 minute\' where id=$1', [uid(14)]);
  assert.equal((await read('3', 14)).valid, false);
  await assert.rejects(open('4', 14), /AUTH_SESSION_REVOKED/);
  await assert.rejects(open('5', 12, 1), /AUTH_SESSION_REVOKED/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(2)]);
  try {
    assert.equal((await read('f', 10)).valid, false);
    await assert.rejects(open('6', 10), /AUTH_SESSION_REVOKED/);
  } finally { await db.query("select set_config('request.jwt.claim.sub','',false)"); }
});
