const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0].v;
const event = (worker,action,session=null,activity=null,call=null) => scalar('select public.tc_panel_attendance_event($1,$2,$3,$4,$5) v',[id(worker),action,session,activity,call]);
async function worker(n,role='central',active=true) { await db.query('insert into workers values($1,$2,$3)',[id(n),role,active]); }
async function age(session,expired=true) {
  await db.query(`update attendance_panel_sessions set started_at=now()-interval '20 minutes',last_activity_at=now()-interval '11 minutes',last_manual_activity_at=now()-interval '11 minutes',expires_at=now()+($2::integer*interval '1 minute') where id=$1`,[session,expired ? -1 : 1]);
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table workers(id uuid primary key,role text,is_active boolean);
    create table attendance_events(id uuid primary key default gen_random_uuid(),worker_id uuid not null references workers(id),event_type text not null check(event_type in ('online','offline','heartbeat')),at timestamptz not null default now(),meta jsonb not null default '{}');
    create table attendance_state(worker_id uuid primary key references workers(id),is_online boolean not null default false,status text not null default 'offline',last_event_at timestamptz,updated_at timestamptz not null default now());
    grant select,update on workers to service_role;grant select,insert,update on attendance_events,attendance_state to service_role;`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261028222646_panel_attendance_sessions.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261029123043_tarotista_panel_attendance.sql'),'utf8'));
});
after(async () => { await db.close(); });

test('legacy online state does not unlock a new tracked session',async () => {
  await worker(1);await db.query("insert into attendance_state(worker_id,is_online,status) values($1,true,'working')",[id(1)]);
  const state=await event(1,'status');assert.equal(state.online,false);assert.equal(state.session_id,null);
  assert.equal(await scalar('select count(*)::int v from attendance_panel_sessions'),0);
});
test('explicit connection is idempotent across tabs and keeps one start time',async () => {
  await worker(2);const a=await event(2,'connect');const b=await event(2,'connect');
  assert.equal(a.session_id,b.session_id);assert.equal(a.session_started_at,b.session_started_at);
  assert.equal(await scalar('select count(*)::int v from attendance_panel_sessions where worker_id=$1',[id(2)]),1);
});
test('a background heartbeat cannot prolong the inactivity deadline',async () => {
  await worker(3);const a=await event(3,'connect');const b=await event(3,'heartbeat',a.session_id);
  assert.equal(a.expires_at,b.expires_at);assert.equal(a.last_activity_at,b.last_activity_at);
  const bad=await event(3,'heartbeat',a.session_id,'2099-01-01T00:00:00Z');assert.equal(bad.expires_at,a.expires_at);
});
test('recent activity extends a live session; polling and old activity do not',async () => {
  await worker(4);const a=await event(4,'connect');await age(a.session_id,false);
  const now=await scalar('select now()::text v');const b=await event(4,'heartbeat',a.session_id,now);
  assert.ok(Date.parse(b.expires_at)-Date.parse(now)>=599000);
  const c=await event(4,'status');assert.equal(c.expires_at,b.expires_at);
});
test('expired session closes at its deadline and never reopens through heartbeat',async () => {
  await worker(5);const a=await event(5,'connect');await age(a.session_id);
  const deadline=await scalar('select expires_at::text v from attendance_panel_sessions where id=$1',[a.session_id]);
  const now=await scalar('select now()::text v');const b=await event(5,'heartbeat',a.session_id,now);
  assert.equal(b.online,false);assert.equal(b.session_id,null);assert.equal(b.close_reason,'inactivity');
  const ended=await scalar('select ended_at::text v from attendance_panel_sessions where id=$1',[a.session_id]);
  assert.equal(Date.parse(ended),Date.parse(deadline));
  assert.equal((await event(5,'heartbeat',a.session_id)).online,false);
});
test('old tab cannot disconnect or renew the replacement session',async () => {
  await worker(6);const a=await event(6,'connect');await event(6,'disconnect',a.session_id);const b=await event(6,'connect');
  assert.notEqual(a.session_id,b.session_id);
  assert.equal((await event(6,'heartbeat',a.session_id)).error,'SESSION_CHANGED');
  assert.equal((await event(6,'disconnect',a.session_id)).error,'SESSION_CHANGED');
  assert.equal((await event(6,'status')).session_id,b.session_id);
});
test('break closes paid-work interval; returning opens another non-overlapping interval',async () => {
  await worker(7);const a=await event(7,'connect');const pause=await event(7,'break',a.session_id);
  assert.equal(pause.session_id,null);assert.equal(pause.status,'break');
  assert.equal((await event(7,'heartbeat',a.session_id)).session_id,null);
  const b=await event(7,'connect');assert.notEqual(a.session_id,b.session_id);
  const rows=(await db.query('select * from attendance_panel_sessions where worker_id=$1 order by started_at',[id(7)])).rows;
  assert.equal(rows[0].close_reason,'break');assert.ok(rows[0].ended_at<=rows[1].started_at);
});
test('server-confirmed ongoing call preserves a session and keeps manual activity separate',async () => {
  await worker(8);const a=await event(8,'connect');await age(a.session_id);
  const call=await scalar("select (now()-interval '5 minutes')::text v");
  const b=await event(8,'heartbeat',a.session_id,null,call);
  assert.equal(b.session_id,a.session_id);assert.equal(b.call_active,true);
  assert.ok(Date.parse(b.last_activity_at)>Date.parse(b.last_manual_activity_at));
  assert.ok(b.call_confirmed_at);
});
test('a call starting after the expired deadline cannot retroactively bridge idle time',async () => {
  await worker(9);const a=await event(9,'connect');await age(a.session_id);
  const call=await scalar("select (now()-interval '10 seconds')::text v");
  assert.equal((await event(9,'heartbeat',a.session_id,null,call)).session_id,null);
  assert.equal((await event(9,'status',null,null,call)).session_id,null);
});
test('inactive workers and unrelated roles cannot open panel sessions',async () => {
  await worker(10,'central',false);await worker(11,'cliente',true);
  await assert.rejects(()=>event(10,'connect'),/WORKER_NOT_ALLOWED/);
  await assert.rejects(()=>event(11,'connect'),/WORKER_NOT_ALLOWED/);
});
test('RLS and grants keep sessions and service RPC inaccessible to browsers',async () => {
  assert.equal(await scalar("select relrowsecurity v from pg_class where oid='attendance_panel_sessions'::regclass"),true);
  for(const role of ['anon','authenticated']) {
    assert.equal(await scalar("select has_table_privilege($1,'attendance_panel_sessions','SELECT') v",[role]),false);
    assert.equal(await scalar("select has_function_privilege($1,'tc_panel_attendance_event(uuid,text,uuid,timestamptz,timestamptz)','EXECUTE') v",[role]),false);
  }
  assert.equal(await scalar("select prosecdef v from pg_proc where oid='tc_panel_attendance_event(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure"),false);
});
