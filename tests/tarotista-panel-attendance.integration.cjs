const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0].v;
const event = (n,action,session=null,activity=null,call=null) => scalar('select public.tc_panel_attendance_event($1,$2,$3,$4,$5) v',[id(n),action,session,activity,call]);
async function worker(n,role='tarotista',active=true) { await db.query('insert into workers values($1,$2,$3)',[id(n),role,active]); }
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table workers(id uuid primary key,role text,is_active boolean);
    create table attendance_events(id uuid primary key default gen_random_uuid(),worker_id uuid not null references workers(id),event_type text not null check(event_type in ('online','offline','heartbeat')),at timestamptz not null default now(),meta jsonb not null default '{}');
    create table attendance_state(worker_id uuid primary key references workers(id),is_online boolean not null default false,status text not null default 'offline',last_event_at timestamptz,updated_at timestamptz not null default now());
    grant select,update on workers to service_role;grant select,insert,update on attendance_events,attendance_state to service_role;`);
  for(const file of ['20261028222646_panel_attendance_sessions.sql','20261029123043_tarotista_panel_attendance.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
  }
});
after(async()=>{await db.close();});

test('tarotista uses explicit service-only connection; legacy state cannot unlock and inactive workers fail',async()=>{
  await worker(1);await worker(2,'tarotista',false);
  await db.query("insert into attendance_state(worker_id,is_online,status) values($1,true,'working')",[id(1)]);
  assert.equal((await event(1,'status')).session_id,null);
  await db.exec('set role service_role');
  try { assert.ok((await event(1,'connect')).session_id); }
  finally { await db.exec('reset role'); }
  await assert.rejects(()=>event(2,'connect'),/WORKER_NOT_ALLOWED/);
});

test('manual consultation lasts exactly 60 server minutes and is never represented as a verified PBX call',async()=>{
  await worker(3);const connected=await event(3,'connect');const mode=await event(3,'consultation_start',connected.session_id);
  assert.equal(mode.status,'working');assert.equal(mode.session_id,connected.session_id);
  assert.equal(Date.parse(mode.consultation_until)-Date.parse(mode.consultation_started_at),3600000);
  assert.equal(mode.expires_at,mode.consultation_until);
  assert.equal(mode.consultation_source,'self_reported_external_call');
  assert.equal(mode.call_active,false);assert.equal(mode.call_confirmed_at,null);
  const audit=await scalar("select meta v from attendance_events where worker_id=$1 and meta->>'action'='consultation_start'",[id(3)]);
  assert.equal(audit.consultation_source,'self_reported_external_call');assert.equal(audit.call_confirmed,false);
  await assert.rejects(()=>db.query("update attendance_panel_sessions set consultation_until=consultation_started_at+interval '61 minutes' where id=$1",[mode.session_id]),/attendance_panel_consultation_bound/);
});

test('reload, polling and heartbeat preserve the same declared deadline without renewing it',async()=>{
  await worker(4);const connected=await event(4,'connect');const mode=await event(4,'consultation_start',connected.session_id);
  for(const [action,session] of [['status',null],['heartbeat',mode.session_id],['connect',mode.session_id]]) {
    const state=await event(4,action,session);
    assert.equal(state.consultation_until,mode.consultation_until);assert.equal(state.expires_at,mode.expires_at);
  }
  const recent=await scalar('select clock_timestamp()::text v');
  const state=await event(4,'heartbeat',mode.session_id,recent);
  assert.equal(state.consultation_until,mode.consultation_until);
  assert.equal(state.expires_at,mode.expires_at);
});

test('explicit extension renews 60 minutes from now; ending returns to ten idle minutes',async()=>{
  await worker(5);const connected=await event(5,'connect');const mode=await event(5,'consultation_start',connected.session_id);
  await db.query("update attendance_panel_sessions set consultation_started_at=now()-interval '59 minutes',consultation_until=now()+interval '1 minute',expires_at=now()+interval '1 minute' where id=$1",[mode.session_id]);
  const renewed=await event(5,'consultation_start',mode.session_id);
  assert.equal(Date.parse(renewed.consultation_until)-Date.parse(renewed.server_now),3600000);
  assert.ok(Date.parse(renewed.consultation_started_at)>=Date.parse(mode.consultation_started_at));
  const ended=await event(5,'consultation_end',mode.session_id);
  assert.equal(ended.consultation_until,null);assert.equal(ended.consultation_source,null);
  assert.equal(Date.parse(ended.expires_at)-Date.parse(ended.server_now),600000);
  assert.equal(ended.last_manual_activity_at,ended.server_now);assert.equal(ended.session_id,mode.session_id);
});

test('sleep past the manual deadline closes at that deadline; neither extend nor heartbeat can reopen it',async()=>{
  await worker(6);const connected=await event(6,'connect');const mode=await event(6,'consultation_start',connected.session_id);
  await db.query(`update attendance_panel_sessions set started_at=now()-interval '70 minutes',
    last_activity_at=now()-interval '61 minutes',last_manual_activity_at=now()-interval '61 minutes',
    consultation_started_at=now()-interval '61 minutes',consultation_until=now()-interval '1 minute',expires_at=now()-interval '1 minute' where id=$1`,[mode.session_id]);
  const deadline=await scalar('select expires_at::text v from attendance_panel_sessions where id=$1',[mode.session_id]);
  const result=await event(6,'consultation_start',mode.session_id);
  assert.equal(result.error,'PANEL_CONNECTION_REQUIRED');
  const stored=(await db.query('select ended_at::text,close_reason from attendance_panel_sessions where id=$1',[mode.session_id])).rows[0];
  assert.equal(Date.parse(stored.ended_at),Date.parse(deadline));assert.equal(stored.close_reason,'consultation_timeout');
  assert.equal((await event(6,'heartbeat',mode.session_id,new Date().toISOString())).session_id,null);
  const next=await event(6,'connect');assert.notEqual(next.session_id,mode.session_id);assert.equal(next.consultation_until,null);
});

test('stale or missing session identity cannot start, end, or extend another tab session',async()=>{
  await worker(7);const old=await event(7,'connect');await event(7,'disconnect',old.session_id);const next=await event(7,'connect');
  for(const action of ['consultation_start','consultation_end','heartbeat','disconnect','break','bathroom']) {
    assert.equal((await event(7,action,old.session_id)).error,'SESSION_CHANGED');
    assert.equal((await event(7,action)).error,'SESSION_CHANGED');
  }
  assert.equal((await event(7,'status')).session_id,next.session_id);
  assert.equal((await event(7,'status')).consultation_until,null);
});

test('pause and disconnect close work; reconnect clears consultation and preserves legacy pause metadata',async()=>{
  await worker(8);let state=await event(8,'connect');
  for(const action of ['break','bathroom','disconnect']) {
    state=await event(8,'consultation_start',state.session_id);
    const stopped=await event(8,action,state.session_id);
    assert.equal(stopped.session_id,null);assert.equal(stopped.consultation_until,null);
    const audit=(await db.query('select event_type,meta from attendance_events where worker_id=$1 order by at desc limit 1',[id(8)])).rows[0];
    assert.equal(audit.event_type,action==='disconnect'?'offline':'online');
    if(action!=='disconnect') { assert.equal(audit.meta.action,action);assert.equal(audit.meta.phase,'start'); }
    state=await event(8,'connect');assert.equal(state.consultation_until,null);
  }
});

test('admin and central cannot use manual consultation and retain existing pause semantics',async()=>{
  for(const [n,role] of [[9,'admin'],[10,'central']]) {
    await worker(n,role);const state=await event(n,'connect');
    await assert.rejects(()=>event(n,'consultation_start',state.session_id),/WORKER_NOT_ALLOWED/);
    await event(n,'break',state.session_id);
    assert.equal(await scalar('select event_type v from attendance_events where worker_id=$1 order by at desc limit 1',[id(n)]),'offline');
  }
});

test('no manual-mode schema or RPC access is granted to browser roles',async()=>{
  for(const role of ['anon','authenticated']) {
    assert.equal(await scalar("select has_column_privilege($1,'attendance_panel_sessions','consultation_until','UPDATE') v",[role]),false);
    assert.equal(await scalar("select has_function_privilege($1,'tc_panel_attendance_event(uuid,text,uuid,timestamptz,timestamptz)','EXECUTE') v",[role]),false);
  }
  assert.equal(await scalar("select prosecdef v from pg_proc where oid='tc_panel_attendance_event(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure"),false);
});
