const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const snapshot = require('./fixtures/delegated-admin-current-definitions.json');
const policies = [...snapshot.policies, ...snapshot.rolePolicies];
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261106222000_delegated_admin_access.sql'), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const quote = s => '"' + s.replaceAll('"', '""') + '"';
let db, originalRoles;
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
async function claims(role = 'service_role', n = null) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({role, ...(n ? {sub: id(n)} : {})})]);
}
const check = n => scalar('select tc_has_admin_access($1) v', [id(n)]);
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    grant usage on schema auth,public,private to authenticated,service_role,anon;
    create table workers(id uuid primary key,user_id uuid,auth_user_id uuid,role text,is_active boolean,display_name text,email text);
    create function public.current_worker() returns table(worker_id uuid,role text) language sql security definer as $$
      select id,role from workers where user_id=auth.uid()
    $$;
    create function public.current_worker_id() returns uuid language sql security definer as $$
      select id from workers where user_id=auth.uid() limit 1
    $$;
    set check_function_bodies=off;
  `);
  const special = {
    billing_collaborator_report_exclusions: 'deleted_by_worker_id text',
    crm_client_followups: 'worker_id uuid,client_id uuid',
    crm_clientes: 'captured_by_worker_id uuid',
    manual_invoice_lines: 'invoice_id uuid',
    central_notifications: 'recipient_worker_id uuid',
    captacion_leads: 'assigned_worker_id uuid',
    chat_threads: 'central_worker_id uuid,tarotist_worker_id uuid',
    chat_messages: 'thread_id uuid,sender_worker_id uuid',
    cliente_payment_attempts: 'provider text,provider_response jsonb',
    incidencias: 'worker_id uuid',
    work_sessions: 'worker_id uuid',
    invoices: 'worker_id uuid',
    checklist_turnos: 'worker_id uuid',
    internal_chat: 'to_role text',
  };
  const tables = new Set([...policies.map(p => p.tablename), 'crm_clientes', 'manual_invoices']);
  for (const table of tables) if (table !== 'workers') {
    await db.exec('create table public.' + quote(table) + '(id uuid primary key' + (special[table] ? ',' + special[table] : '') + ')');
    await db.exec('alter table public.' + quote(table) + ' enable row level security; grant select on public.' + quote(table) + ' to authenticated');
  }
  await db.exec('alter table workers enable row level security; grant select on workers to authenticated');
  for (const f of snapshot.functions) {
    await db.exec(f.definition);
    if (f.schema === 'public' && f.name !== 'current_role') {
      const signature = snapshot.patches.find(p => p.signature.startsWith('public.' + f.name + '(')).signature;
      await db.exec('revoke all on function ' + signature + ' from public,anon,authenticated; grant execute on function ' + signature + ' to service_role');
    }
  }
  for (const p of policies) {
    const roles = p.roles.slice(1,-1).split(',').map(quote).join(',');
    await db.exec('create policy ' + quote(p.policyname) + ' on public.' + quote(p.tablename)
      + ' as ' + p.permissive + ' for ' + p.cmd + ' to ' + roles
      + (p.qual ? ' using (' + p.qual + ')' : '')
      + (p.with_check ? ' with check (' + p.with_check + ')' : ''));
  }
  for (const [n, role, active] of [[1,'admin',true],[2,'central',true],[3,'central',true],[4,'central',false],[5,'tarotista',true]]) {
    await db.query('insert into auth.users values($1)',[id(n+100)]);
    await db.query('insert into workers(id,user_id,role,is_active,display_name,email) values($1,$2,$3,$4,$5,$6)',
      [id(n),id(n+100),role,active,'Fixture '+n,'fixture'+n+'@example.test']);
  }
  originalRoles = await scalar("select jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'role',role,'is_active',is_active) order by id) v from workers");
  await db.exec(migration);
  await claims();
});
after(async () => db?.close());

test('migration preserves worker identities and operational roles; no grants are implicit', async () => {
  assert.deepEqual(await scalar("select jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'role',role,'is_active',is_active) order by id) v from workers"), originalRoles);
  assert.equal(await scalar('select count(*)::int v from worker_admin_access'), 0);
  assert.equal(await check(101), true);
  for (const n of [102,103,104,105]) assert.equal(await check(n), false);
  await db.query('insert into worker_admin_access(worker_id,user_id,reason,granted_by_user_id) values($1,$2,$3,$4)',
    [id(2),id(102),'Explicit fixture delegation',id(101)]);
  assert.equal(await check(102), true);
  assert.equal(await check(103), false);
  assert.equal(await scalar('select role v from workers where id=$1',[id(2)]), 'central');
});

test('authenticated callers cannot impersonate other actors, metadata or legacy links', async () => {
  await claims('authenticated',102);
  assert.equal(await check(102), true);
  assert.equal(await check(101), false);
  assert.equal(await scalar('select tc_worker_has_admin_access($1) v',[id(1)]), false);
  assert.equal(await scalar('select "current_role"() v'), 'admin');
  assert.equal(await scalar('select private.current_worker_role() v'), 'central');
  await claims('authenticated',103);
  assert.equal(await check(102), false);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:id(103),user_metadata:{role:'admin',can_admin:true},email:'fixture2@example.test'})]);
  assert.equal(await check(103), false);
  await db.query('update workers set auth_user_id=$1 where id=$2',[id(103),id(2)]);
  assert.equal(await check(103), false);
  await db.query('update workers set auth_user_id=null where id=$1',[id(2)]);
  await claims();
});

test('delegation requires exact identity, current active worker/grant, and immediate revocation', async () => {
  await assert.rejects(db.query('insert into worker_admin_access(worker_id,user_id,reason) values($1,$2,$3)',[id(3),id(102),'Wrong identity']),/IDENTITY_MISMATCH/);
  await assert.rejects(db.query('insert into worker_admin_access(worker_id,user_id,reason) values($1,$2,$3)',[id(5),id(105),'Tarotista not central']),/IDENTITY_MISMATCH/);
  await db.query('update workers set is_active=false where id=$1',[id(2)]);
  assert.equal(await check(102),false);
  await db.query('update workers set is_active=true where id=$1',[id(2)]);
  await db.query('update worker_admin_access set is_active=false where worker_id=$1',[id(2)]);
  assert.equal(await check(102),false);
  await db.query('update worker_admin_access set is_active=true,revoked_at=now() where worker_id=$1',[id(2)]);
  assert.equal(await check(102),false);
  await db.query('update worker_admin_access set revoked_at=null where worker_id=$1',[id(2)]);
  assert.equal(await check(102),true);
  await db.query('update workers set user_id=$1 where id=$2',[id(103),id(2)]);
  assert.equal(await check(102),false);
  assert.equal(await scalar('select tc_worker_has_admin_access($1) v',[id(2)]),false);
  await db.query('update workers set user_id=$1 where id=$2',[id(102),id(2)]);
});

test('browser roles cannot change delegation or append-only audit', async () => {
  for(const role of ['anon','authenticated']) {
    assert.equal(await scalar("select has_table_privilege($1,'worker_admin_access','insert,update,delete,select') v",[role]),false);
    assert.equal(await scalar("select has_table_privilege($1,'worker_admin_access_audit','insert,update,delete,select') v",[role]),false);
  }
  assert.equal(await scalar("select has_table_privilege('service_role','worker_admin_access_audit','insert,update,delete') v"),false);
  assert.equal(await scalar("select has_function_privilege('anon','tc_has_admin_access(uuid)','execute') v"),false);
  assert.ok(await scalar("select count(*)::int v from worker_admin_access_audit where action='revoke'")>=1);
  assert.equal(await scalar("select count(*)::int v from worker_admin_access_audit where action='grant'"),1);
});

test('real SQL admin guard and RLS admit delegated admin and reject other central', async () => {
  await claims();
  assert.equal(await scalar('select tc_atlas_admin($1) v',[id(102)]),id(2));
  await scalar('select tc_assert_benefit_admin($1) v',[id(102)]);
  await assert.rejects(scalar('select tc_atlas_admin($1) v',[id(103)]),/FORBIDDEN/);
  await assert.rejects(scalar('select tc_assert_benefit_admin($1) v',[id(103)]),/ADMIN_REQUIRED/);
  await db.query('insert into accounting_entries(id) values($1)',[id(999)]);
  await claims('authenticated',102);
  await db.exec('set role authenticated');
  assert.equal(await scalar('select count(*)::int v from accounting_entries'),1);
  await db.exec('reset role');
  await claims('authenticated',103);
  await db.exec('set role authenticated');
  assert.equal(await scalar('select count(*)::int v from accounting_entries'),0);
  await db.exec('reset role');
  await claims();
});

test('current_role adds administration without removing Central policies or causing workers RLS recursion',async()=>{
  await claims();
  await db.query('insert into invoices(id,worker_id) values($1,$2),($3,$4)',[id(901),id(2),id(902),id(3)]);
  await db.query('insert into internal_chat(id,to_role) values($1,$2),($3,$4)',[id(903),'central',id(904),'admin']);
  await claims('authenticated',102);
  await db.exec('set role authenticated');
  assert.equal(await scalar('select count(*)::int v from workers'),5);
  assert.equal(await scalar('select count(*)::int v from invoices'),2);
  assert.equal(await scalar('select count(*)::int v from internal_chat'),2);
  await db.exec('reset role');
  await claims('authenticated',103);
  await db.exec('set role authenticated');
  assert.equal(await scalar('select count(*)::int v from workers'),4);
  assert.equal(await scalar('select count(*)::int v from invoices'),1);
  assert.equal(await scalar('select count(*)::int v from internal_chat'),1);
  await db.exec('reset role');
  await claims();
});

test('reviewed RPC business bodies and execute grants are unchanged',async()=>{
  for(const patch of snapshot.patches) {
    const name=patch.signature.split('.')[1].split('(')[0];
    const source=snapshot.functions.find(f=>f.name===name).definition;
    const actual=await scalar('select pg_get_functiondef(to_regprocedure($1)) v',[patch.signature]);
    assert.equal(actual.replaceAll('\r\n','\n'),source.replaceAll(patch.old,patch.replacement).replaceAll('\r\n','\n'),name);
    assert.equal(await scalar("select has_function_privilege('authenticated',$1,'execute') v",[patch.signature]),false,name);
  }
});

test('reapplying the migration preserves the single grant and audit',async()=>{
  const before=await scalar('select count(*)::int v from worker_admin_access_audit');
  await db.exec(migration);
  assert.equal(await scalar('select count(*)::int v from worker_admin_access'),1);
  assert.equal(await scalar('select count(*)::int v from worker_admin_access_audit'),before);
});
