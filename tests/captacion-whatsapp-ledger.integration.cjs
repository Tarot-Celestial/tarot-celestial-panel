const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot = { telefono_normalizado: null, telefono: '+17875550205', pais: 'PR', nombre: 'María', apellido: 'Fixture' };
let db;
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const claim = async (delivery = 100, request = 200, worker = 1, lead = 10, key = 'meta:111') => (await query('select tc_captacion_whatsapp_claim($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value', [id(delivery), id(request), id(lead), id(worker), id(worker + 1000), key, 'HX' + 'b'.repeat(32), 'whatsapp:+17875551234', 'whatsapp:+17875550205', id(delivery + 500), id(lead === 12 ? 21 : 20), JSON.stringify(snapshot)]))[0].value;
const record = async (status, sid = 'SM' + 'c'.repeat(32), source = 'provider_callback', delivery = 100, token = 600) => (await query('select tc_captacion_whatsapp_record($1,$2,$3,$4,$5,$6) value', [id(delivery), id(token), sid, status, null, source]))[0].value;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id uuid,auth_user_id uuid,role text,is_active boolean);
    create table crm_clientes(id uuid primary key,origen text,telefono_normalizado text,telefono text,pais text,nombre text,apellido text);
    create table captacion_leads(id uuid primary key,cliente_id uuid,assigned_worker_id uuid,origen text,closed_at timestamptz);
    create table meta_lead_events(leadgen_id text primary key,captacion_lead_id uuid,status text,meta_created_at timestamptz);
    insert into workers values ('${id(1)}','${id(1001)}',null,'central',true),('${id(2)}','${id(1002)}',null,'central',true),('${id(3)}','${id(1003)}',null,'central',false),('${id(4)}','${id(1004)}',null,'tarotista',true);
    insert into crm_clientes values ('${id(20)}','Facebook',null,'+17875550205','PR','María','Fixture'),('${id(21)}','Orion Facebook',null,'+17875550205','PR','María','Fixture');
    insert into captacion_leads values ('${id(10)}','${id(20)}',null,'facebook_ads',null),('${id(11)}','${id(20)}','${id(2)}','facebook_ads',null),('${id(12)}','${id(21)}',null,'facebook_ads',null);
    insert into meta_lead_events values ('111','${id(10)}','processed',now()-interval '1 hour');`);
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261022195347_captacion_whatsapp_delivery_ledger.sql'), 'utf8');
  await db.exec(migration); await db.exec(migration);
});
beforeEach(async () => { await db.exec(`truncate captacion_whatsapp_delivery_events,captacion_whatsapp_deliveries;update captacion_leads set closed_at=null,cliente_id='${id(20)}' where id='${id(10)}';update crm_clientes set telefono_normalizado=null,telefono='+17875550205',pais='PR',nombre='María',apellido='Fixture';delete from meta_lead_events where leadgen_id <> '111';`); });
after(async () => db.close());
test('RLS, grants and RPC deny direct browser roles; migration is repeatable', async () => {
  const rows = await query("select relrowsecurity,has_table_privilege('anon',oid,'SELECT') a,has_table_privilege('authenticated',oid,'UPDATE') u from pg_class where relname in ('captacion_whatsapp_deliveries','captacion_whatsapp_delivery_events')");
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.relrowsecurity && !row.a && !row.u));
  assert.equal((await query("select has_function_privilege('authenticated','tc_captacion_whatsapp_claim(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,jsonb)','EXECUTE') allowed"))[0].allowed, false);
});
test('different centrals and request UUIDs claim a submission once, including requests racing together', async () => {
  const results = await Promise.all([claim(), claim(101,201,2)]); assert.equal(results.filter(result => result.claimed).length, 1);
  assert.equal((await query('select count(*) total from captacion_whatsapp_deliveries'))[0].total, 1);
  assert.equal((await claim()).claimed, false);
});
test('inactive worker, wrong role, assignment, brand and stale submission are denied', async () => {
  await assert.rejects(claim(100,200,3), /FORBIDDEN/); await assert.rejects(claim(100,200,4), /FORBIDDEN/);
  await assert.rejects(claim(100,200,1,11,'initial'), /FORBIDDEN/); await assert.rejects(claim(100,200,1,12,'initial'), /LEAD_NOT_FOUND/);
  await assert.rejects(claim(100,200,1,10,'meta:stale'), /SUBMISSION_CHANGED/);
});
test('ambiguous and failed states block duplicate sends; new Meta submission permits a distinct delivery', async () => {
  await claim(); await record('unknown',null,'send_response'); assert.equal((await claim(101,201,2)).claimed,false);
  await record('failed',null,'send_response'); assert.equal((await claim(102,202,2)).claimed,false);
  await db.exec(`insert into meta_lead_events values ('112','${id(10)}','processed',now());`);
  assert.equal((await claim(103,203,2,10,'meta:112')).claimed,true);
  assert.equal((await claim(104,200,2,10,'meta:112')).delivery.id,id(100));
});
test('signed delivery callbacks cannot be regressed by late acceptance or duplicates', async () => {
  await claim(); await record('delivered'); await record('accepted','SM'+'c'.repeat(32),'send_response'); await record('delivered');
  assert.equal((await query('select status from captacion_whatsapp_deliveries'))[0].status,'delivered');
  assert.equal((await query('select count(*) total from captacion_whatsapp_delivery_events'))[0].total,2);
  await record('read'); await record('undelivered'); assert.equal((await query('select status from captacion_whatsapp_deliveries'))[0].status,'read');
});
test('wrong callback token or provider SID cannot replace the receipt', async () => {
  await claim(); await record('accepted'); await assert.rejects(record('delivered','SM'+'c'.repeat(32),'provider_callback',100,999),/INVALID_DELIVERY/);
  await assert.rejects(record('delivered','SM'+'d'.repeat(32)),/MESSAGE_CONFLICT/);
});
test('a closure after submission blocks a new send while an older closure preserves a genuine reentry', async () => {
  await db.exec(`update captacion_leads set closed_at=now() where id='${id(10)}'`); await assert.rejects(claim(),/LEAD_CLOSED/);
  await db.exec(`update captacion_leads set closed_at=now()-interval '2 days' where id='${id(10)}'`); assert.equal((await claim()).claimed,true);
});
test('claim rejects changed CRM snapshot fields or a merged customer before creating any delivery', async () => {
  for (const field of ['telefono_normalizado','telefono','pais','nombre','apellido']) {
    await db.query(`update crm_clientes set ${field}=$1 where id=$2`, ['changed',id(20)]);
    await assert.rejects(claim(),/CLIENT_CHANGED/);
    await db.query(`update crm_clientes set ${field}=$1 where id=$2`, [snapshot[field],id(20)]);
  }
  await db.query('update captacion_leads set cliente_id=$1 where id=$2',[id(21),id(10)]);
  await assert.rejects(claim(),/CLIENT_CHANGED/);
  assert.equal((await query('select count(*) total from captacion_whatsapp_deliveries'))[0].total,0);
});
