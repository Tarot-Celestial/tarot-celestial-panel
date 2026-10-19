const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const query = async (text, params = []) => (await db.query(text, params)).rows;
const read = async (user = 1, event = null) => (await query('select tc_central_purchase_celebrations($1,$2) v', [id(user), event]))[0].v;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id text,role text,is_active boolean);
    create table crm_cliente_pagos(id uuid primary key,cliente_id uuid,estado text,importe numeric,moneda text,created_by_user_id uuid);
    create table worker_xp_rules(action_key text primary key,integration_key text);
    create table worker_xp_events(id uuid primary key,worker_id uuid references workers(id),reference_id text,origin text,status text,xp_amount integer,action_key text,created_at timestamptz default now());
    insert into workers values('${id(101)}','${id(1)}','central',true),('${id(102)}','${id(2)}','central',true),('${id(103)}','${id(3)}','admin',true),('${id(104)}','${id(4)}','central',false);
    insert into worker_xp_rules values('existing_purchase_rule','assigned_client_purchase'),('client_recovery','recovery');`);
  const dir = path.join(__dirname, '../supabase/migrations');
  const migration = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(file => file.endsWith('_central_purchase_celebrations.sql'))), 'utf8');
  await db.exec(migration); await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(`truncate central_purchase_celebrations,worker_xp_events,crm_cliente_pagos;
    insert into crm_cliente_pagos values('${id(201)}','${id(301)}','completed',20,'EUR','${id(1)}');
    insert into worker_xp_events values('${id(401)}','${id(101)}','payment:${id(201)}','crm_cliente_pagos','applied',2,'existing_purchase_rule',now());`);
});
after(async () => db.close());
test('only a persisted XP award linked to a positive completed purchase is displayed', async () => {
  const data = await read(); assert.equal(data.events.length, 1); assert.equal(data.events[0].xp, 2); assert.equal(data.events[0].payment_id, id(201));
  assert.equal((await query('select count(*)::int n from central_purchase_celebrations'))[0].n, 0, 'GET is read only');
  await query("update crm_cliente_pagos set estado='pending'"); assert.equal((await read()).events.length, 0);
  assert.equal((await read(1, id(401))).event, null);
  await query("update crm_cliente_pagos set estado='completed',importe=0"); assert.equal((await read()).events.length, 0);
});
test('claim once across repeated calls/tabs and never credits any additional XP', async () => {
  const results = await Promise.all([read(1, id(401)), read(1, id(401)), read(1, id(401))]);
  assert.equal(results.filter(result => result.event).length, 1);
  assert.equal((await read()).events.length, 0);
  assert.equal((await query('select count(*)::int n,sum(xp_amount)::int xp from worker_xp_events'))[0].xp, 2);
  assert.equal((await query('select count(*)::int n from central_purchase_celebrations'))[0].n, 1);
});
test('own-central attribution is enforced even when another event or payment ID is supplied', async () => {
  assert.equal((await read(2)).events.length, 0); assert.equal((await read(2, id(401))).event, null);
  await query('update crm_cliente_pagos set created_by_user_id=$1', [id(2)]);
  assert.equal((await read()).events.length, 0); assert.equal((await read(1, id(401))).event, null);
  await query('update crm_cliente_pagos set created_by_user_id=$1', [id(101)]);
  assert.equal((await read()).events.length, 1, 'legacy worker ID attribution is supported');
});
test('reversed XP, unrelated recovery bonuses and old awards cannot trigger a purchase celebration', async () => {
  await query("update worker_xp_events set status='reversed'"); assert.equal((await read()).events.length, 0);
  await query("update worker_xp_events set status='applied',action_key='client_recovery'"); assert.equal((await read()).events.length, 0);
  await query("update worker_xp_events set action_key='existing_purchase_rule',created_at=now()-interval '25 hours'"); assert.equal((await read()).events.length, 0);
});
test('payment uniqueness also prevents a second celebration for another XP event on the same purchase', async () => {
  assert.ok((await read(1, id(401))).event);
  await query("insert into worker_xp_events select $1,worker_id,reference_id,origin,status,xp_amount,action_key,created_at from worker_xp_events where id=$2", [id(402), id(401)]);
  assert.equal((await read(1, id(402))).event, null); assert.equal((await read()).events.length, 0);
});
test('central identity is mandatory, with no anonymous/browser access to receipts or privileged RPC', async () => {
  for (const user of [3,4,9]) await assert.rejects(read(user), /FORBIDDEN/);
  await db.exec('set role authenticated');
  await assert.rejects(read(), /permission denied/);
  await assert.rejects(query('select * from central_purchase_celebrations'), /permission denied/);
  await db.exec('reset role');
  assert.equal((await query("select relrowsecurity from pg_class where oid='central_purchase_celebrations'::regclass"))[0].relrowsecurity, true);
});
