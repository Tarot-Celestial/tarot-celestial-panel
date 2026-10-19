const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const sql = async (query, params = []) => (await db.query(query, params)).rows;
const rpc = async (query, params) => (await sql(`select ${query} result`, params))[0].result;
const payload = (kind = 'capture', clients = [10], worker = 2) => ({ kind, title: 'Encargo de prueba', description: 'Revisar fichas', due_at: '2026-10-19T20:00:00Z', items: clients.map(n => ({ worker_id: id(worker), client_id: id(n), ...(kind === 'capture' ? { lead_id: id(n + 100) } : {}) })) });
const dispatch = (p = payload(), op = 1000, user = 1) => rpc('tc_atlas_dispatch($1,$2,$3)', [id(user), p, id(op)]);
const candidates = (kind = 'capture', worker = null, user = 1) => rpc('tc_atlas_candidates($1,$2,100,$3)', [id(user), kind, worker && id(worker)]);
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text);
    create table test_clock(instant timestamptz); insert into test_clock values('2026-10-19T16:00:00Z');
    create table crm_clientes(id uuid primary key,nombre text,apellido text,telefono text,origen text,estado text);
    create table captacion_leads(id uuid primary key,cliente_id uuid references crm_clientes(id),assigned_worker_id uuid,assigned_role text,estado text,closed_at timestamptz,next_contact_at timestamptz,last_contact_at timestamptz,contacted_at timestamptz,intento_actual int default 1,max_intentos int default 3,created_at timestamptz default now(),updated_at timestamptz);
    create table crm_client_capture_assignments(client_id uuid primary key,status text,business text,captured_at timestamptz);
    create table crm_cliente_pagos(id uuid primary key,cliente_id uuid,estado text,importe numeric,created_at timestamptz);
    create table rendimiento_llamadas(id uuid primary key,cliente_id text,cliente_compra_minutos bool,importe numeric);
    create table crm_client_recovery(client_id uuid primary key,responsible_id uuid,status text default 'pending',contacted_at timestamptz,version int default 0);
    create table crm_client_recovery_history(id uuid primary key,client_id uuid,status text,created_at timestamptz);
    create table crm_recovery_mission_schedules(worker_id uuid primary key,enabled bool default true,followup_days int default 7,end_time time default '23:00');
    create table crm_recovery_mission_assignments(mission_day date,worker_id uuid,client_id uuid,primary key(mission_day,client_id));
    create table crm_recovery_contact_events(id uuid primary key,worker_id uuid,client_id uuid,mission_day date,counted bool);
    create view tc_recovery_candidates as select id,trim(concat_ws(' ',nombre,apellido)) nombre,telefono,true eligible from crm_clientes where origen='celestial';
    insert into workers values('${id(1)}','${id(1)}','admin',true,'Admin'),('${id(2)}','${id(2)}','central',true,'Isa'),('${id(3)}','${id(3)}','central',true,'Maria'),('${id(4)}','${id(4)}','central',false,'Inactive');
    insert into crm_recovery_mission_schedules(worker_id) values('${id(2)}'),('${id(3)}');`);
  const dir = path.join(__dirname, '../supabase/migrations');
  const migration = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(p => p.endsWith('_atlas_admin_operations.sql'))), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const followups = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(p => p.endsWith('_atlas_followup_eligibility.sql'))), 'utf8');
  await db.exec(followups);
  await db.exec(followups);
  await db.exec('create or replace function tc_atlas_now() returns timestamptz language sql stable security invoker set search_path=public,pg_temp as $$select instant from test_clock$$');
});
beforeEach(async () => {
  await db.exec('truncate atlas_admin_job_outcomes,atlas_admin_jobs,atlas_admin_dispatches,atlas_admin_audit,atlas_admin_messages,atlas_admin_memories,atlas_admin_proposals,captacion_leads,crm_client_capture_assignments,crm_cliente_pagos,rendimiento_llamadas,crm_client_recovery_history,crm_client_recovery,crm_recovery_mission_assignments,crm_recovery_contact_events,crm_clientes cascade');
  await db.exec(`update test_clock set instant='2026-10-19T16:00:00Z'; insert into crm_clientes select ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'Client '||g,'Test','34600123456','celestial','activo' from generate_series(10,60)g;
    insert into captacion_leads(id,cliente_id,estado,next_contact_at) select ('00000000-0000-4000-8000-'||lpad((g+100)::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'nuevo','2026-10-18T10:00:00Z' from generate_series(10,60)g;`);
});
after(async () => db.close());

test('migration is repeatable; all Atlas tables and functions deny browser roles', async () => {
  const tables = await sql("select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT') can_read from pg_class c where c.relnamespace='public'::regnamespace and c.relname like 'atlas_admin_%' and c.relkind='r'");
  assert.equal(tables.length, 8);
  assert.ok(tables.every(t => t.relrowsecurity && !t.can_read));
  assert.equal((await sql("select has_function_privilege('anon','tc_atlas_dispatch(uuid,jsonb,uuid)','EXECUTE') x"))[0].x, false);
  assert.equal((await sql("select count(*)::int n from atlas_admin_settings"))[0].n, 1);
  await assert.rejects(candidates('capture', null, 2), /FORBIDDEN/);
  await assert.rejects(dispatch(payload(), 1000, 4), /FORBIDDEN/);
});

test('capture ranking excludes paid, closed, future, other assigned, inactive and other business contacts', async () => {
  await db.exec(`update captacion_leads set estado='no_interesado' where cliente_id='${id(10)}';
    update captacion_leads set next_contact_at='2026-10-25T10:00:00Z' where cliente_id='${id(11)}';
    update captacion_leads set assigned_worker_id='${id(3)}' where cliente_id='${id(12)}';
    update captacion_leads set assigned_worker_id='${id(4)}' where cliente_id='${id(13)}';
    update crm_clientes set origen='orion' where id='${id(14)}';
    insert into crm_cliente_pagos values('${id(501)}','${id(15)}','completed',20,'2026-10-01T10:00:00Z');
    insert into rendimiento_llamadas values('${id(502)}','${id(16)}',true,20);
    insert into crm_client_capture_assignments values('${id(17)}','confirmed','celestial',now());
    update crm_clientes set estado='baja' where id='${id(18)}';
    update captacion_leads set estado='pend_cap' where cliente_id='${id(19)}';`);
  const result = await candidates('capture', 2);
  assert.ok(!result.candidates.some(c => Array.from({ length: 9 }, (_, n) => id(n + 10)).includes(c.client_id)));
  assert.equal(result.candidates[0].client_id, id(19));
  assert.ok(!JSON.stringify(result).includes('probability'));
  assert.equal((await sql('select count(*)::int n from atlas_admin_jobs'))[0].n, 0);
});

test('dispatch assigns real leads atomically; retries return the same job and audit once', async () => {
  const first = await dispatch(payload('capture', [10, 11]));
  assert.equal(first.assigned, 2); assert.equal(first.jobs.length, 1);
  assert.equal((await sql('select assigned_worker_id from captacion_leads where id=$1', [id(110)]))[0].assigned_worker_id, id(2));
  assert.equal((await dispatch(payload('capture', [10, 11]))).duplicate_prevented, true);
  assert.equal((await sql('select count(*)::int n from atlas_admin_jobs'))[0].n, 1);
  assert.equal((await sql("select count(*)::int n from atlas_admin_audit where action='dispatch'"))[0].n, 1);
  await assert.rejects(dispatch(payload('capture', [10])), /OPERATION_CONFLICT/);
  assert.ok(!(await candidates()).candidates.some(c => c.client_id === id(10)));
});

test('changed eligibility or responsibility rolls back every assignment and job', async () => {
  await sql('update captacion_leads set assigned_worker_id=$1 where cliente_id=$2', [id(3), id(11)]);
  await assert.rejects(dispatch(payload('capture', [10, 11])), /CANDIDATE_CHANGED/);
  assert.equal((await sql('select assigned_worker_id from captacion_leads where cliente_id=$1', [id(10)]))[0].assigned_worker_id, null);
  assert.equal((await sql('select count(*)::int n from atlas_admin_jobs'))[0].n, 0);
});

test('recovery dispatch uses mission assignments, keeps quota, cooldown, ownership and weekends', async () => {
  const result = await dispatch(payload('recovery', [10, 11]), 1002);
  assert.equal(result.assigned, 2);
  assert.equal((await sql('select count(*)::int n from crm_recovery_mission_assignments'))[0].n, 2);
  await assert.rejects(dispatch(payload('recovery', [10], 3), 1003), /CANDIDATE_CHANGED/);
  await db.exec(`insert into crm_client_recovery values('${id(12)}','${id(2)}','contacted','2026-10-18T10:00:00Z',0);`);
  assert.ok(!(await candidates('recovery', 2)).candidates.some(c => c.client_id === id(12)));
  await db.exec("update test_clock set instant='2026-10-24T16:00:00Z'");
  assert.deepEqual((await candidates('recovery')).candidates, []);
  const weekend = { ...payload('recovery', [13]), due_at: '2026-10-26T20:00:00Z' };
  await assert.rejects(dispatch(weekend, 1004), /RECOVERY_WEEKDAYS_ONLY/);
});

test('recovery does not silently expand an existing thirty-client mission', async () => {
  await db.exec(`insert into crm_client_recovery(client_id,responsible_id) select id,'${id(2)}' from crm_clientes where id<'${id(40)}';
    insert into crm_recovery_mission_assignments select '2026-10-19','${id(2)}',client_id from crm_client_recovery;`);
  await assert.rejects(dispatch(payload('recovery', [40]), 1100), /MISSION_FULL/);
  assert.equal((await dispatch(payload('recovery', [10]), 1101)).assigned, 1);
  assert.equal((await sql('select count(*)::int n from crm_recovery_mission_assignments'))[0].n, 30);
});

test('proposal claiming checks admin ownership, expiry and execution retries', async () => {
  await db.exec(`insert into atlas_admin_proposals(id,worker_id,kind,title,payload,expires_at) values('${id(300)}','${id(1)}','test','Test','{}','2026-10-19T17:00:00Z'),('${id(301)}','${id(1)}','test','Expired','{}','2026-10-19T15:00:00Z');`);
  const claim = () => rpc('tc_atlas_claim($1,$2)', [id(1), id(300)]);
  assert.equal((await claim()).claimed, true); assert.equal((await claim()).claimed, false);
  await assert.rejects(rpc('tc_atlas_claim($1,$2)', [id(2), id(300)]), /FORBIDDEN/);
  await assert.rejects(rpc('tc_atlas_claim($1,$2)', [id(1), id(301)]), /PROPOSAL_EXPIRED/);
  assert.equal((await rpc('tc_atlas_finish($1,$2,$3,null)', [id(1), id(300), { done: true }])).status, 'completed');
  assert.equal((await claim()).proposal.status, 'completed');
});

test('central job completion is private, requires a result, and retains terminal state', async () => {
  const job = (await dispatch()).jobs[0];
  const update = (user, status, result) => rpc('tc_atlas_update_job($1,$2,$3,$4)', [id(user), job.id, status, result]);
  await assert.rejects(update(3, 'completed', 'Listo'), /FORBIDDEN/);
  await assert.rejects(update(2, 'completed', ''), /RESULT_REQUIRED/);
  assert.equal((await update(2, 'blocked', 'Necesito revisar la ficha')).status, 'blocked');
  assert.equal((await update(2, 'in_progress', '')).status, 'in_progress');
  assert.equal((await update(2, 'completed', 'Registré el resultado')).status, 'completed');
  assert.equal((await update(2, 'completed', 'Registré el resultado')).duplicate_prevented, true);
  await assert.rejects(update(2, 'in_progress', ''), /JOB_CLOSED/);
});

test('contact outcomes are authenticated, assigned, repeat safe and cannot invent purchases', async () => {
  const job = (await dispatch()).jobs[0];
  const outcome = (user = 2, client = 10, value = 'interested', request = 900) => rpc('tc_atlas_record_outcome($1,$2,$3,$4,$5,$6,$7,$8)', [id(user), job.id, id(client), 'phone', value, 'Pidió información', null, id(request)]);
  await assert.rejects(outcome(3), /FORBIDDEN/);
  await assert.rejects(outcome(2, 11), /CLIENT_NOT_ASSIGNED/);
  await assert.rejects(outcome(2, 10, 'purchased'), /INVALID_OUTCOME/);
  assert.equal((await outcome()).outcome, 'interested');
  assert.equal((await outcome()).duplicate_prevented, true);
  await assert.rejects(outcome(2, 10, 'no_answer'), /OPERATION_CONFLICT/);
  await assert.rejects(outcome(2, 10, 'followup', 901), /FOLLOWUP_DATE_REQUIRED/);
  await rpc('tc_atlas_update_job($1,$2,$3,$4)', [id(2), job.id, 'completed', 'Hecho']);
  assert.equal((await outcome()).duplicate_prevented, true);
  await assert.rejects(outcome(2, 10, 'responded', 902), /JOB_CLOSED/);
});

test('generic tasks fan out per central without altering contacts, history or XP', async () => {
  const task = { kind: 'task', title: 'Plan semanal', description: 'Revisar seguimientos y registrar bloqueos', due_at: '2026-10-24T04:00:00Z', due_by_worker: { [id(2)]: '2026-10-23T20:00:00Z', [id(3)]: '2026-10-24T04:00:00Z' }, worker_ids: [id(2), id(3)], items: [] };
  const result = await dispatch(task);
  assert.equal(result.jobs.length, 2); assert.equal(result.assigned, 0);
  assert.ok(result.jobs.every(j => j.client_ids.length === 0));
  assert.notEqual(result.jobs[0].due_at, result.jobs[1].due_at);
  assert.equal((await sql('select count(*)::int n from captacion_leads where assigned_worker_id is not null'))[0].n, 0);
});

test('an agreed Atlas follow-up survives a completed job and prevents early reassignment', async () => {
  const job = (await dispatch()).jobs[0];
  await rpc('tc_atlas_record_outcome($1,$2,$3,$4,$5,$6,$7,$8)', [id(2),job.id,id(10),'phone','followup','Contactar mañana','2026-10-20T16:00:00Z',id(950)]);
  await sql('update atlas_admin_job_outcomes set created_at=$1 where request_id=$2',['2026-10-19T16:00:00Z',id(950)]);
  await rpc('tc_atlas_update_job($1,$2,$3,$4)',[id(2),job.id,'completed','Seguimiento acordado y registrado']);
  assert.equal((await sql('select count(*)::int n from atlas_current_followups'))[0].n,1);
  for (const kind of ['capture','recovery']) assert.ok(!(await candidates(kind,2)).candidates.some(c=>c.client_id===id(10)));
  await db.exec("update test_clock set instant='2026-10-20T16:01:00Z'");
  const due=(await candidates('capture',2)).candidates.find(c=>c.client_id===id(10));
  assert.ok(due);assert.equal(due.priority,-1);assert.match(due.reasons[0],/Atlas/);
  assert.ok(!(await candidates('capture',3)).candidates.some(c=>c.client_id===id(10)));
  assert.equal((await sql("select has_table_privilege('authenticated','atlas_current_followups','SELECT') allowed"))[0].allowed,false);
});

test('new outcomes supersede a promise and a later completed purchase resolves it without deleting history', async () => {
  const job=(await dispatch()).jobs[0];
  const outcome=async(n,value,next,created)=>{await rpc('tc_atlas_record_outcome($1,$2,$3,$4,$5,$6,$7,$8)',[id(2),job.id,id(10),'phone',value,'Resultado',next,id(n)]);await sql('update atlas_admin_job_outcomes set created_at=$1 where request_id=$2',[created,id(n)]);};
  await outcome(951,'followup','2026-10-20T16:00:00Z','2026-10-19T14:00:00Z');
  await outcome(952,'responded',null,'2026-10-19T15:00:00Z');
  assert.equal((await sql('select count(*)::int n from atlas_current_followups'))[0].n,0);
  await outcome(953,'followup','2026-10-21T16:00:00Z','2026-10-19T16:00:00Z');
  await sql('insert into crm_cliente_pagos values($1,$2,$3,$4,$5)',[id(960),id(10),'pending',20,'2026-10-19T17:00:00Z']);
  assert.equal((await sql('select count(*)::int n from atlas_current_followups'))[0].n,1);
  await sql("update crm_cliente_pagos set estado='completed' where id=$1",[id(960)]);
  assert.equal((await sql('select count(*)::int n from atlas_current_followups'))[0].n,0);
  assert.equal((await sql('select count(*)::int n from atlas_admin_job_outcomes'))[0].n,3);
});
