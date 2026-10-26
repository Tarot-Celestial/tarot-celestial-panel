const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].v;
const get = (actor = 101) => scalar('select public.tc_admin_whatsapp_draft_get($1) v', [id(actor)]);
const save = (doc, request = 201, version = 0, actor = 101) => scalar('select public.tc_admin_whatsapp_draft_save($1,$2,$3,$4) v', [id(actor), id(request), version, doc]);
const resolve = (phones, actor = 101) => scalar('select public.tc_admin_whatsapp_draft_resolve($1,$2) v', [id(actor), phones]);
const contact = (n = 1, overrides = {}) => ({ id: id(n), name: 'Ada', phone: '+34600000001', consent_status: 'pending', consent_note: '', ...overrides });
const document = () => ({ slots: [1, 2].map(slot => ({ slot, label: `WhatsApp ${slot}`, sender_phone: '', message: 'Hola {{nombre}}', image_url: '', contacts: [] })) });
const stored = () => scalar(`select jsonb_build_object('drafts',(select count(*) from tc_admin_whatsapp_drafts),'requests',(select count(*) from tc_admin_whatsapp_draft_requests),'crm',(select jsonb_agg(to_jsonb(c) order by c.id) from crm_clientes c),'queue',(select count(*) from whatsapp_bridge_commands),'deliveries',(select count(*) from captacion_whatsapp_deliveries)) v`);

before(async () => {
  db = new PGlite();
  // Relevant production column types, unique/index contracts and runtime grants were read live.
  // No production SQL dependency is mocked: all five new functions run from the migration verbatim.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.workers(id uuid primary key,user_id uuid unique,role text not null,is_active boolean not null);
    create table public.crm_clientes(id uuid primary key,nombre text not null,apellido text,telefono_normalizado text not null,puntos integer default 50,minutos_free_pendientes integer default 4,minutos_normales_pendientes integer default 10);
    create index crm_clientes_telefono_normalizado_idx on public.crm_clientes(telefono_normalizado);
    create table public.whatsapp_bridge_commands(id uuid primary key,payload jsonb);
    create table public.captacion_whatsapp_deliveries(id uuid primary key,status text);
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text not null references storage.buckets(id),name text not null);
    alter table storage.objects enable row level security;
    grant usage on schema public,storage to anon,authenticated,service_role;
    grant select,update on workers to service_role;
    grant select on crm_clientes to service_role;
    grant all on storage.objects to anon,authenticated,service_role;
    insert into workers values('${id(1)}','${id(101)}','admin',true),('${id(2)}','${id(102)}','admin',true),('${id(3)}','${id(103)}','central',true),('${id(4)}','${id(104)}','admin',false);
    insert into crm_clientes(id,nombre,apellido,telefono_normalizado) values('${id(501)}','Ada','Lovelace','34600000001'),('${id(502)}','Grace','Hopper','0034600000002'),('${id(503)}','Unique',null,'+34600000003'),('${id(504)}','Duplicate A',null,'34600000004'),('${id(505)}','Duplicate B',null,'+34600000004');
    insert into whatsapp_bridge_commands values('${id(901)}','{"test":"existing"}');
    insert into captacion_whatsapp_deliveries values('${id(902)}','confirmed');
    insert into storage.buckets(id,name) values('existing-images','existing-images');
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261026045914_admin_whatsapp_drafts.sql'), 'utf8'));
});
beforeEach(async () => {
  await db.exec('reset role; truncate tc_admin_whatsapp_draft_requests,tc_admin_whatsapp_drafts; update workers set is_active=true where user_id in (\'' + id(101) + '\',\'' + id(102) + '\');');
});
after(async () => { await db?.close(); });

test('empty GET is private preparation and does not insert a draft', async () => {
  const before = await stored(); const result = await get();
  assert.equal(result.version, 0); assert.equal(result.updated_at, null);
  assert.deepEqual(result.slots.map(s => [s.slot, s.contacts.length]), [[1, 0], [2, 0]]);
  assert.deepEqual(await stored(), before);
});

test('saves both slots atomically, normalizes phones and preserves existing operational data', async () => {
  const doc = document(); doc.slots[0].contacts = [contact(1, { name: '  Ada  ', phone: '00 34 (600) 000-001' })];
  doc.slots[1].contacts = [contact(2, { phone: '34600000002', consent_status: 'withdrawn' })];
  doc.slots[1].sender_phone = '00 34 600 000 010';
  const before = await stored(); const result = await save(doc);
  assert.equal(result.version, 1); assert.equal(result.replayed, false);
  assert.equal(result.slots[0].contacts[0].phone, '+34600000001'); assert.equal(result.slots[0].contacts[0].name, 'Ada');
  assert.equal(result.slots[1].contacts[0].consent_status, 'withdrawn'); assert.equal(result.slots[1].sender_phone, '+34600000010');
  const after = await stored(); assert.equal(after.drafts, 1); assert.equal(after.requests, 1);
  assert.deepEqual(after.crm, before.crm); assert.equal(after.queue, before.queue); assert.equal(after.deliveries, before.deliveries);
});

test('retry returns original response even after a later edit and never overwrites it', async () => {
  const first = document(); first.slots[0].message = 'Primera versión';
  const original = await save(first);
  const newer = document(); newer.slots[1].message = 'Segunda versión'; await save(newer, 202, 1);
  const retry = await save(first); assert.deepEqual({ ...retry, replayed: false }, original);
  assert.equal(retry.replayed, true); assert.equal((await get()).version, 2);
  assert.equal((await get()).slots[1].message, 'Segunda versión');
  assert.equal((await stored()).requests, 2);
});

test('reusing a request with another document or version rejects without a write', async () => {
  const doc = document(); await save(doc); const before = await stored();
  doc.slots[0].label = 'Otro'; await assert.rejects(save(doc), /OPERATION_CONFLICT/);
  await assert.rejects(save(document(), 201, 1), /OPERATION_CONFLICT/);
  assert.deepEqual(await stored(), before);
});

test('stale concurrent-editor version cannot replace a saved document', async () => {
  const a = document(); a.slots[0].label = 'Editor A'; await save(a);
  const b = document(); b.slots[0].label = 'Editor B'; await assert.rejects(save(b, 202, 0), /VERSION_CONFLICT/);
  assert.equal((await get()).slots[0].label, 'Editor A'); assert.equal((await stored()).requests, 1);
  await save(b, 203, 1); assert.equal((await get()).version, 2);
});

test('missing operation and invalid version cannot create a draft', async () => {
  await assert.rejects(scalar('select tc_admin_whatsapp_draft_save($1,null,0,$2) v', [id(101), document()]), /INVALID_REQUEST_ID/);
  for (const version of [null, -1, '9007199254740991']) await assert.rejects(save(document(), 201, version), /INVALID_VERSION/);
  assert.equal((await stored()).drafts, 0); assert.equal((await stored()).requests, 0);
});

test('different administrators have isolated documents and request namespaces', async () => {
  const a = document(); a.slots[0].message = 'Admin A'; const b = document(); b.slots[0].message = 'Admin B';
  await save(a, 201, 0, 101); await save(b, 201, 0, 102);
  assert.equal((await get(101)).slots[0].message, 'Admin A'); assert.equal((await get(102)).slots[0].message, 'Admin B');
});

test('non-admin, inactive and missing actors cannot read, save or resolve', async () => {
  for (const actor of [103, 104, 999]) {
    await assert.rejects(get(actor), /FORBIDDEN/); await assert.rejects(save(document(), 201, 0, actor), /FORBIDDEN/);
    await assert.rejects(resolve(['+34600000001'], actor), /FORBIDDEN/);
  }
  assert.equal((await stored()).drafts, 0);
});

test('revoked administrator cannot replay an old successful request', async () => {
  const doc = document(); await save(doc); await db.query('update workers set is_active=false where user_id=$1', [id(101)]);
  await assert.rejects(save(doc), /FORBIDDEN/); await assert.rejects(get(), /FORBIDDEN/);
});

test('allows 300 per slot but rejects 301 and unknown document keys', async () => {
  const doc = document();
  for (let slot = 0; slot < 2; slot++) doc.slots[slot].contacts = Array.from({ length: 300 }, (_, i) => contact(1000 + slot * 300 + i, { phone: '+34' + (600000000 + slot * 300 + i) }));
  assert.equal((await save(doc)).slots[1].contacts.length, 300);
  doc.slots[0].contacts.push(contact(9999, { phone: '+34600999999' })); await assert.rejects(save(doc, 202, 1), /TOO_MANY_CONTACTS/);
  await assert.rejects(save({ ...document(), send_now: true }, 203, 1), /INVALID_DOCUMENT/);
});

test('phone normalization rejects malformed values without guessing a country', async () => {
  for (const phone of ['+012345678', '+34abc600000001', '12345', '+1234567890123456', '+34 600000001 ext1', '']) {
    const doc = document(); doc.slots[0].contacts = [contact(1, { phone })]; await assert.rejects(save(doc), /INVALID_PHONE/);
  }
  const doc = document(); doc.slots[0].contacts = [contact(1, { phone: '34600000001' })]; assert.equal((await save(doc)).slots[0].contacts[0].phone, '+34600000001');
});

test('rejects normalized duplicates across slots and duplicate contact identities/senders', async () => {
  const doc = document(); doc.slots[0].contacts = [contact(1)]; doc.slots[1].contacts = [contact(2, { phone: '0034 600 000 001' })];
  await assert.rejects(save(doc), /DUPLICATE_PHONE/);
  doc.slots[1].contacts = [contact(1, { phone: '+34600000002' })]; await assert.rejects(save(doc), /DUPLICATE_CONTACT/);
  doc.slots[1].contacts = []; doc.slots[0].sender_phone = '+34600000010'; doc.slots[1].sender_phone = '0034600000010'; await assert.rejects(save(doc), /DUPLICATE_SENDER/);
});

test('strict document types prevent accidental or injected workflow fields', async () => {
  for (const doc of [null, [], {}, { slots: [] }, { slots: [document().slots[0]] }, { slots: [document().slots[0], document().slots[0]] }]) await assert.rejects(save(doc), /INVALID_DOCUMENT/);
  for (const mutate of [d => { d.slots[0].contacts = null; }, d => { d.slots[0].slot = '1'; }, d => { d.slots[0].send_now = true; }, d => { delete d.slots[0].image_url; }, d => { d.slots[0].contacts = [contact(1, { id: 'bad' })]; }]) {
    const doc = document(); mutate(doc); await assert.rejects(save(doc), /INVALID_DOCUMENT/);
  }
});

test('confirmed consent requires a note; pending and withdrawn are retained as declarations', async () => {
  const doc = document(); doc.slots[0].contacts = [contact(1, { consent_status: 'confirmed' })];
  await assert.rejects(save(doc), /CONSENT_NOTE_REQUIRED/);
  doc.slots[0].contacts[0].consent_note = 'Me autorizó'; assert.equal((await save(doc)).slots[0].contacts[0].consent_status, 'confirmed');
  doc.slots[0].contacts[0].consent_status = 'sending'; await assert.rejects(save(doc, 202, 1), /INVALID_CONSENT/);
});

test('text limits, image schemes and placeholders are checked before persistence', async () => {
  for (const [field, max] of [['label', 80], ['message', 1500], ['image_url', 2000]]) {
    const doc = document(); doc.slots[0][field] = 'x'.repeat(max + 1); await assert.rejects(save(doc), /INVALID_DOCUMENT/);
  }
  for (const [field, max] of [['name', 160], ['consent_note', 500]]) {
    const doc = document(); doc.slots[0].contacts = [contact(1, { [field]: 'x'.repeat(max + 1) })]; await assert.rejects(save(doc), /INVALID_DOCUMENT/);
  }
  const doc = document(); doc.slots[0].message = 'Hola {{saldo}}'; await assert.rejects(save(doc), /INVALID_PLACEHOLDER/);
  doc.slots[0].message = 'Hola {{nombre}}'; doc.slots[0].image_url = 'javascript:alert(1)'; await assert.rejects(save(doc), /INVALID_IMAGE_URL/);
  doc.slots[0].image_url = 'https://clientestarotcelestial.es/images/promo.webp'; assert.equal((await save(doc)).version, 1);
});

test('resolver returns names only for exact unique matches and never writes', async () => {
  const before = await stored();
  const result = await resolve(['+34600000001', '0034600000002', '+34600000003', '+34600000004', '+34699999999', '+34600000001']);
  assert.deepEqual(result, [
    { phone: '+34600000001', match: 'unique', name: 'Ada Lovelace' }, { phone: '+34600000002', match: 'unique', name: 'Grace Hopper' },
    { phone: '+34600000003', match: 'unique', name: 'Unique' }, { phone: '+34600000004', match: 'ambiguous', name: '' },
    { phone: '+34699999999', match: 'none', name: '' }
  ]);
  assert.deepEqual(await stored(), before); assert.deepEqual(await resolve([]), []);
  await assert.rejects(resolve(Array(601).fill('+34600000001')), /TOO_MANY_CONTACTS/);
});

test('request receipts and draft update roll back together if persistence fails', async () => {
  const doc = document(); await save(doc); const before = await get();
  await db.exec(`create function public.test_draft_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'TEST_RECEIPT_FAILURE'; end $$; create trigger test_draft_failure before insert on tc_admin_whatsapp_draft_requests for each row execute function public.test_draft_receipt_failure();`);
  try { doc.slots[0].label = 'Must roll back'; await assert.rejects(save(doc, 202, 1), /TEST_RECEIPT_FAILURE/); }
  finally { await db.exec('drop trigger test_draft_failure on tc_admin_whatsapp_draft_requests; drop function test_draft_receipt_failure();'); }
  assert.deepEqual(await get(), before); assert.equal((await stored()).requests, 1);
});

test('runtime service privileges work while browser roles cannot read or execute drafts', async () => {
  const privileges = await scalar(`select jsonb_build_object('anon_read',has_table_privilege('anon','tc_admin_whatsapp_drafts','SELECT'),'authenticated_read',has_table_privilege('authenticated','tc_admin_whatsapp_drafts','SELECT'),'anon_rpc',has_function_privilege('anon','tc_admin_whatsapp_draft_get(uuid)','EXECUTE'),'authenticated_rpc',has_function_privilege('authenticated','tc_admin_whatsapp_draft_save(uuid,uuid,bigint,jsonb)','EXECUTE'),'service_delete',has_table_privilege('service_role','tc_admin_whatsapp_drafts','DELETE'),'service_rpc',has_function_privilege('service_role','tc_admin_whatsapp_draft_get(uuid)','EXECUTE')) v`);
  assert.deepEqual(privileges, { anon_read: false, authenticated_read: false, anon_rpc: false, authenticated_rpc: false, service_delete: false, service_rpc: true });
  await db.exec('set role service_role'); try { assert.equal((await save(document())).version, 1); assert.equal((await get()).version, 1); assert.equal((await resolve(['+34600000001']))[0].match, 'unique'); } finally { await db.exec('reset role'); }
  await db.exec('set role authenticated'); try { await assert.rejects(get(), /permission denied/); await assert.rejects(db.query('select * from tc_admin_whatsapp_drafts'), /permission denied/); } finally { await db.exec('reset role'); }
});

test('image bucket has exact limits and denies browser writes even with a broad permissive policy', async () => {
  const bucket = (await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='admin-whatsapp-campaign-images'")).rows[0];
  assert.equal(bucket.public, true); assert.equal(Number(bucket.file_size_limit), 3145728); assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
  await db.exec('create policy test_storage_broad on storage.objects for all to authenticated using(true) with check(true)');
  await db.exec(`insert into storage.objects values('${id(800)}','admin-whatsapp-campaign-images','existing.png'); set role authenticated;`);
  try {
    await assert.rejects(db.query("insert into storage.objects values($1,'admin-whatsapp-campaign-images','new.png')", [id(801)]), /row-level security/);
    assert.equal((await db.query("update storage.objects set name='overwritten.png' where id=$1 returning id", [id(800)])).rows.length, 0);
    assert.equal((await db.query('delete from storage.objects where id=$1 returning id', [id(800)])).rows.length, 0);
    await db.query("insert into storage.objects values($1,'existing-images','allowed.png')", [id(802)]);
    await assert.rejects(db.query("update storage.objects set bucket_id='admin-whatsapp-campaign-images' where id=$1", [id(802)]), /row-level security/);
  } finally { await db.exec('reset role; drop policy test_storage_broad on storage.objects'); }
  assert.equal((await db.query('select name from storage.objects where id=$1', [id(800)])).rows[0].name, 'existing.png');
});
