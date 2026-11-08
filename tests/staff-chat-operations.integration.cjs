const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db, sequence = 10000;
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.v;
const thread = (central = 1, tarotista = 3) => scalar('select id v from chat_threads where central_worker_id=$1 and tarotist_worker_id=$2', [id(central), id(tarotista)]);
const card = async (central = 1, tarotista = 3) => scalar("select to_jsonb(m) v from chat_messages m where thread_id=$1 and kind='consultation'", [await thread(central, tarotista)]);
const operate = async (actor, action, target = null, revision = null, reason = '', operation = ++sequence, threadId = null) => scalar('select staff_chat_operation($1,$2,$3,$4,$5,$6,$7) v', [id(actor), threadId || await thread(), action, id(operation), target, reason, revision]);
const insertCall = async (n, name, timestamp = '2026-11-08T12:00:00Z', tarotista = 3, central = 1) => db.query(`insert into rendimiento_llamadas(id,cliente_nombre,telefonista_worker_id,tarotista_worker_id,tiempo,fecha_hora,code_blocks) values($1,$2,$3,$4,30,$5,'[{"code":"FREE","minutes":10},{"code":"CLIENTE","minutes":20}]')`, [id(n), name, typeof central === 'number' ? id(central) : central, typeof tarotista === 'number' ? id(tarotista) : tarotista, timestamp]);
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,role text,display_name text,is_active boolean default true);
    create function tc_worker_has_admin_access(actor uuid) returns boolean language sql as $$select role='admin' from public.workers where id=actor$$;
    create table chat_threads(id uuid primary key default gen_random_uuid(),central_worker_id uuid references workers,tarotist_worker_id uuid not null references workers,status text,title text,last_message_at timestamptz,last_message_preview text);
    create unique index chat_threads_private_pair_unique on chat_threads(central_worker_id,tarotist_worker_id) where central_worker_id is not null;
    create table chat_messages(id uuid primary key default gen_random_uuid(),thread_id uuid references chat_threads,sender_worker_id uuid references workers,sender_display_name text,body text check(length(btrim(body)) between 1 and 2000),created_at timestamptz default now(),client_message_id text,unique(sender_worker_id,client_message_id));
    alter table chat_messages enable row level security;
    create policy fixture_existing_permissive_chat on chat_messages for all to authenticated using(true) with check(true);
    grant select,insert,update,delete on chat_messages to authenticated;
    create table rendimiento_llamadas(id uuid primary key,cliente_nombre text,telefonista_worker_id text,tarotista_worker_id text,fecha_hora timestamptz,created_at timestamptz default now(),tiempo numeric,edit_revision bigint not null default 0,code_blocks jsonb,codigo_1 text,minutos_1 numeric,codigo_2 text,minutos_2 numeric,resumen_codigo text,tipo_registro text);
    create table protected_balances(id integer primary key,coins integer,free numeric);
    insert into protected_balances values(1,1234,47);
    create table protected_attendance(worker_id uuid,state text);
    insert into protected_attendance values('${id(3)}','working');
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
  `);
  for (const [n, role, name] of [[1,'central','Central uno'],[2,'admin','Admin'],[3,'tarotista','Tarotista tres'],[4,'central','Otra central'],[5,'tarotista','Otra tarotista']]) await db.query('insert into workers(id,role,display_name) values($1,$2,$3)', [id(n), role, name]);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261108205745_staff_chat_operations.sql'), 'utf8'));
});
after(async () => { await db?.close(); });

test('call projection contains only first name and exact minutes/code; no client phone, surname or purchase data', async () => {
  await insertCall(100, 'Michell PrivateSurname');
  const c = await card();
  assert.equal(c.body, '10 FREE · 20 CLIENTE · Michell');
  assert.deepEqual(c.operation_meta, { call_id: id(100) });
  assert.equal(c.sender_worker_id, id(1));
  assert.equal(await scalar("select count(*)::int v from chat_messages where kind='consultation'"), 1);
});
test('new call replaces the same card; edits refresh codes without exposing historical consultations', async () => {
  const previous = await card();
  await insertCall(101, 'Ana Secret', '2026-11-08T13:00:00Z');
  assert.equal((await card()).id, previous.id);
  assert.deepEqual((await card()).operation_meta, { call_id: id(101) });
  await db.query("update rendimiento_llamadas set tiempo=15,code_blocks='[{\"code\":\"REPITE\",\"minutes\":15}]',edit_revision=1 where id=$1", [id(101)]);
  assert.equal((await card()).body, '15 REPITE · Ana');
  await db.query("update rendimiento_llamadas set cliente_nombre='Old Name' where id=$1", [id(100)]);
  assert.equal((await card()).body, '15 REPITE · Ana');
  assert.equal(await scalar("select count(*)::int v from chat_messages where kind='consultation'"), 1);
});
test('delete falls back to previous live source, then retracts card when no calls remain', async () => {
  await db.query('delete from rendimiento_llamadas where id=$1', [id(101)]);
  assert.equal((await card()).body, '10 FREE · 20 CLIENTE · Old');
  await db.query('delete from rendimiento_llamadas where id=$1', [id(100)]);
  assert.deepEqual((await card()).operation_meta, {});
  assert.equal((await card()).body, 'No hay una consulta registrada disponible.');
});
test('invalid manual IDs are ignored; phone-only, spaced phone and email names are private', async () => {
  await insertCall(102, 'Should Never Leak', undefined, 'manual:worker');
  assert.deepEqual((await card()).operation_meta, {});
  for (const [n, name] of [[103, '+17875108391'], [104, '17875108391'], [105, 'client@example.test'], [106, '+ 1787 5108391']]) {
    await insertCall(n, name, `2026-11-08T14:0${n-103}:00Z`);
    assert.equal((await card()).body, '10 FREE · 20 CLIENTE · Clienta');
  }
});
test('worker reassignment refreshes both canonical pairs; no fuzzy name routing', async () => {
  await db.query('update rendimiento_llamadas set tarotista_worker_id=$1 where id=$2', [id(5), id(106)]);
  assert.deepEqual((await card(1,5)).operation_meta, { call_id: id(106) });
  assert.deepEqual((await card()).operation_meta, { call_id: id(105) });
});
test('bathroom notice, idempotent retry, return and audit do not change attendance or balances', async () => {
  const p = await operate(3, 'bathroom', null, null, '', 20000);
  assert.equal(p.status, 'active');
  assert.deepEqual(await operate(3, 'bathroom', null, null, '', 20000), p);
  assert.equal(await scalar('select count(*)::int v from staff_chat_operation_audit where operation_id=$1', [id(20000)]), 1);
  await assert.rejects(operate(3, 'request_lunch'), /PAUSE_ALREADY_OPEN/);
  await assert.rejects(operate(3, 'request_lunch', null, null, '', 20000), /OPERATION_CONFLICT/);
  const returned = await operate(3, 'return', p.id, 0);
  assert.equal(returned.status, 'returned');
  assert.equal(returned.revision, 1);
  assert.deepEqual(await scalar('select to_jsonb(b) v from protected_balances b'), { id:1, coins:1234, free:47 });
  assert.equal(await scalar('select state v from protected_attendance'), 'working');
});
test('lunch needs manager acceptance; unauthorized manager and stale revisions cannot act', async () => {
  const p = await operate(3, 'request_lunch'); assert.equal(p.status, 'pending');
  await assert.rejects(operate(3, 'approve_break', p.id, 0), /FORBIDDEN/);
  await assert.rejects(operate(4, 'approve_break', p.id, 0), /FORBIDDEN/);
  await assert.rejects(operate(1, 'approve_break', p.id, 99), /OPERATION_CONFLICT/);
  const approved = await operate(1, 'approve_break', p.id, 0); assert.equal(approved.status, 'active');
  await assert.rejects(operate(1, 'reject_break', p.id, 0), /OPERATION_CONFLICT/);
  await assert.rejects(operate(1, 'return', p.id, 1), /FORBIDDEN/);
  assert.equal((await operate(3, 'return', p.id, 1)).status, 'returned');
});
test('break may be withdrawn or rejected and one open pause applies across conversations', async () => {
  const first = await operate(3, 'request_break');
  await insertCall(110, 'Fixture', '2026-11-08T15:00:00Z', 3, 4);
  await assert.rejects(operate(3, 'bathroom', null, null, '', ++sequence, await thread(4,3)), /PAUSE_ALREADY_OPEN/);
  assert.equal((await operate(3, 'cancel_pause', first.id, 0)).status, 'cancelled');
  const second = await operate(3, 'request_break');
  assert.equal((await operate(2, 'reject_break', second.id, 0)).status, 'rejected');
});
test('appeal only current source/revision; resolving audits but never edits call minutes', async () => {
  await insertCall(111, 'Lucía Private', '2026-11-08T16:00:00Z');
  await assert.rejects(operate(3, 'appeal', id(105), 0, 'Revisar minutos'), /CALL_CHANGED/);
  const appeal = await operate(3, 'appeal', id(111), 0, 'Fueron 15 cliente');
  assert.equal(appeal.status, 'pending');
  await assert.rejects(operate(3, 'appeal', id(111), 0, 'Fueron 15 cliente'), /APPEAL_ALREADY_OPEN/);
  await assert.rejects(operate(3, 'resolve_appeal', appeal.id, 0, 'Corregido'), /FORBIDDEN/);
  await db.query("update rendimiento_llamadas set tiempo=25,code_blocks='[{\"code\":\"FREE\",\"minutes\":10},{\"code\":\"CLIENTE\",\"minutes\":15}]',edit_revision=1 where id=$1", [id(111)]);
  const resolved = await operate(1, 'resolve_appeal', appeal.id, 0, 'Revisado en Rendimiento');
  assert.equal(resolved.status, 'resolved'); assert.equal(resolved.revision, 1);
  assert.equal((await card()).body, '10 FREE · 15 CLIENTE · Lucía');
  assert.equal(await scalar('select tiempo v from rendimiento_llamadas where id=$1', [id(111)]), '25');
  await assert.rejects(operate(3, 'appeal', id(111), 0, 'Versión vieja'), /CALL_CHANGED/);
  assert.equal((await operate(3, 'appeal', id(111), 1, 'Revisar otra vez')).status, 'pending');
});
test('deleting source preserves appeal audit and recalculates latest card', async () => {
  const count = await scalar('select count(*)::int v from staff_chat_call_appeals where call_id=$1', [id(111)]);
  await db.query('delete from rendimiento_llamadas where id=$1', [id(111)]);
  assert.equal(await scalar('select count(*)::int v from staff_chat_call_appeals where call_id=$1', [id(111)]), count);
  assert.notEqual((await card()).operation_meta.call_id, id(111));
});
test('transaction rollback restores source and operational projection together', async () => {
  const original = await card();
  await db.exec('begin');
  await db.query("update rendimiento_llamadas set code_blocks='[{\"code\":\"FREE\",\"minutes\":99}]',tiempo=99 where id=$1", [original.operation_meta.call_id]);
  assert.match((await card()).body, /99 FREE/);
  await db.exec('rollback');
  assert.deepEqual(await card(), original);
});
test('rapid source corrections and queued attempts converge to one card without duplicating pause notices', async () => {
  await Promise.all([db.query("update rendimiento_llamadas set code_blocks='[{\"code\":\"CLIENTE\",\"minutes\":7}]',tiempo=7,edit_revision=edit_revision+1 where id=$1", [id(105)]), db.query("update rendimiento_llamadas set code_blocks='[{\"code\":\"CLIENTE\",\"minutes\":8}]',tiempo=8,edit_revision=edit_revision+1 where id=$1", [id(105)])]);
  assert.equal((await card()).body, '8 CLIENTE · Clienta');
  const [a,b] = await Promise.all([operate(3,'bathroom',null,null,'',21000),operate(3,'bathroom',null,null,'',21000)]);
  assert.equal(a.id,b.id); assert.equal(await scalar("select count(*)::int v from chat_messages where client_message_id='operation:'||$1", [id(21000)]),1);
  await operate(3,'return',a.id,0);
});
test('only service role may call mutation RPC and privileged tables stay hidden from authenticated users', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from staff_chat_pauses'), /permission denied/);
    await assert.rejects(db.query('select staff_chat_operation($1,$2,$3,$4)', [id(3),id(999),'bathroom',id(29999)]), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  const p = await operate(3,'bathroom');assert.equal(p.status,'active');
  await operate(3,'return',p.id,0);
  await db.exec('reset role');
});
test('inactive worker cannot replay or create actions', async () => {
  await db.query('update workers set is_active=false where id=$1', [id(3)]);
  await assert.rejects(operate(3, 'bathroom'), /FORBIDDEN/);
  await assert.rejects(operate(3, 'bathroom',null,null,'',20000), /FORBIDDEN/);
  await db.query('update workers set is_active=true where id=$1', [id(3)]);
});
test('existing broad authenticated policy cannot forge, overwrite or delete operational messages', async () => {
  const t = await thread(), before = await card();
  await db.exec('set role authenticated');
  for (const kind of ['pause','appeal','consultation']) await assert.rejects(db.query('insert into chat_messages(thread_id,sender_worker_id,sender_display_name,body,kind) values($1,$2,$3,$4,$5)', [t,id(3),'Fixture','Forged',kind]), /row-level security/);
  await assert.rejects(db.query(`insert into chat_messages(thread_id,sender_worker_id,sender_display_name,body,operation_meta) values($1,$2,'Fixture','Forged','{"call_id":"private"}')`, [t,id(3)]), /row-level security/);
  assert.equal((await db.query("update chat_messages set body='Forged' where id=$1 returning id", [before.id])).rows.length, 0);
  assert.equal((await db.query('delete from chat_messages where id=$1 returning id', [before.id])).rows.length, 0);
  const text = await db.query("insert into chat_messages(thread_id,sender_worker_id,sender_display_name,body) values($1,$2,'Fixture','Plain chat') returning id", [t,id(3)]);
  await assert.rejects(db.query("update chat_messages set kind='consultation' where id=$1", [text.rows[0].id]), /row-level security/);
  await db.exec('reset role');
  assert.deepEqual(await card(), before);
});
test('service-role call creation and edit trigger work and migration safely replays without extra messages', async () => {
  await db.exec('set role service_role');
  await insertCall(120,'Nora Example','2026-11-08T19:00:00Z');
  await db.query("update rendimiento_llamadas set tiempo=11,code_blocks='[{\"code\":\"CALL\",\"minutes\":11}]' where id=$1", [id(120)]);
  assert.equal((await card()).body, '11 CALL · Nora');
  await db.exec('reset role');
  const before = await scalar('select count(*)::int v from chat_messages');
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261108205745_staff_chat_operations.sql'), 'utf8'));
  assert.equal(await scalar('select count(*)::int v from chat_messages'), before);
});
