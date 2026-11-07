const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Production function definitions, schema and policy configuration, with only
// synthetic customers/orders. No remote PayPal or Supabase calls are made.
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const migrationPath = '../supabase/migrations/20261107162640_payment_source_boundary_rank_summary.sql';
const id = n => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountKeys = ['legacy', 'client_business_v1'];
let db, sequence = 1000;
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0].v;
const call = (name, ...args) => scalar(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) v`, args);
const wallet = client => scalar("select jsonb_build_object('coins',puntos,'free',minutos_free_pendientes,'normal',minutos_normales_pendientes) v from crm_clientes where id=$1", [client]);
const count = (table, client) => scalar(`select count(*)::int v from ${table} where cliente_id=$1`, [client]);

async function makeClient(rank = 'diamante') {
  const client = id(sequence++), actor = id(sequence++);
  await db.query("insert into crm_clientes(id,nombre,telefono,telefono_normalizado,puntos,minutos_free_pendientes,minutos_normales_pendientes,auth_user_id) values($1,'Synthetic payment customer','000','000',700,4,6,$2)", [client, actor]);
  await db.query("insert into client_rank_overrides(client_id,assigned_rank,intervention_type,reason,created_by,starts_at,active) values($1,$2,'temporary','Local payment boundary fixture',$3,now()-interval '1 day',true)", [client, rank, id(11)]);
  return { client, actor };
}

async function order(customer, options = {}) {
  const n = sequence++, kind = options.kind || 'client_purchase';
  const packId = options.promo ? 'promo:fixture-payment-boundary' : 'pack_20';
  const payload = {
    pack_id: packId, pack_name: 'Synthetic 20 minute pack', total_minutes: 20,
    normal: 20, free: 0, points: 0, oracle_credits: 0,
    roulette_level: options.promo ? null : 1, roulette_spins: options.promo ? 0 : 1,
    pricing_mode: options.promo ? 'promotion' : 'regular',
    purchase_classification: options.promo ? 'promo' : 'nada',
    paypal_account: options.account || 'client_business_v1',
    ...options.payload,
  };
  await db.query(`insert into crm_paypal_orders(id,cliente_id,worker_id,environment,order_id,amount,pack_id,pack_name,purchase_payload,create_payload,checkout_kind,purchaser_auth_user_id)
    values($1,$2,$3,'sandbox',$4,22,$5,$6,$7,'{}',$8,$9)`,
  [id(n), customer.client, kind === 'crm_collection' ? id(1) : null, `SYNTHETIC-ORDER-${n}`, packId, payload.pack_name, JSON.stringify(payload), kind, kind === 'client_purchase' ? customer.actor : null]);
  return { ...customer, n, kind, orderId: id(n), remoteOrder: `SYNTHETIC-ORDER-${n}`, capture: `SYNTHETIC-CAPTURE-${n}` };
}
const finish = a => call(a.kind === 'crm_collection' ? 'tc_complete_paypal_crm' : 'tc_complete_paypal_client', a.orderId, a.remoteOrder, a.capture, 22, 'EUR');

function newPurchase(customer, extra = {}) {
  return {
    operation_id: id(sequence++), cliente_id: customer.client,
    telefonista_worker_id: id(1), tarotista_worker_id: id(2),
    cliente_compra_minutos: true, tipo_registro: 'compra',
    codigo_1: 'CLIENTE', minutos_1: 5, minutos_2: 0,
    guarda_minutos: true, minutos_guardados_free: 0, minutos_guardados_normales: 15,
    importe: 22, forma_pago: 'paypal_manual', promo: false, captado: false, recuperado: false,
    super_promo_ruleta: false, purchase_classification: 'nada', pricing_mode: 'regular',
    points_to_add: 0, purchase_benefits: { oracle_credits: 0, roulette_level: 1, roulette_spins: 1 },
    expected_paypal_environment: 'sandbox', note_text: 'Synthetic operational purchase',
    ...extra,
  };
}
const register = payload => call('tc_register_call_minutes', JSON.stringify(payload));

before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(read('fixtures/benefits-nov-schema.sql'));
  await db.exec(read('fixtures/benefits-nov-schema-extra.sql'));
  await db.exec("create sequence fixture_call_number; alter table rendimiento_llamadas alter column id_unico set default nextval('fixture_call_number');");
  const configuration = JSON.parse(read('fixtures/benefits-nov-config.json'));
  for (const [table, rows] of Object.entries(configuration)) {
    for (const row of rows) {
      const keys = Object.keys(row);
      await db.query(`insert into ${table}(${keys.map(k => `"${k}"`).join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map(k => typeof row[k] === 'object' && row[k] !== null && !Array.isArray(row[k]) ? JSON.stringify(row[k]) : row[k]));
    }
  }
  await db.exec('set check_function_bodies=off');
  await db.exec(read('fixtures/benefits-nov-functions.sql'));
  await db.exec(read('fixtures/benefits-nov-call-functions.sql'));
  await db.exec(read('fixtures/benefits-nov-spin-trigger.sql'));
  for (const block of read('fixtures/benefits-nov-dependencies.sql').split(/(?=CREATE OR REPLACE FUNCTION public\.)/)) {
    if (/FUNCTION public\.(get_cliente_oracle_balance|grant_cliente_oracle_credits|tc_ruleta_level_for_amount|tc_touch_roulette_signal|tc_evaluate_benefits|tc_ruleta_catalogo_v3|tc_ruleta_catalogo_v4|tc_register_call_with_payment)\(/.test(block)) await db.exec(block);
  }
  await db.exec('set check_function_bodies=on');
  await db.exec('create unique index fixture_delivery_key on tc_client_benefit_events(delivery_key) where delivery_key is not null;');
  for (const filename of ['20261102025228_customer_benefits_november_2026.sql', '20261102153603_customer_coins_catalog_sync.sql', '20261103010836_customer_diamond_roulette_choice.sql']) await db.exec(read(`../supabase/migrations/${filename}`));
  for (const row of JSON.parse(read('fixtures/payment-source-live-functions.json'))) await db.exec(row.definition);
  await db.exec(`create constraint trigger tc_purchase_benefits after insert or update on public.crm_cliente_pagos
    deferrable initially deferred for each row when (new.estado='completed' and new.benefits_processed_at is null)
    execute function tc_purchase_benefits_trigger();`);
  await db.exec(read(migrationPath));
  await db.query("insert into workers(id,user_id,role,display_name,is_active) values($1,$2,'central','Synthetic Central',true),($3,$4,'tarotista','Synthetic Reader',true)", [id(1), id(11), id(2), id(12)]);
});
after(async () => { await db?.close(); });

test('both Central PayPal accounts record one collection note and credit nothing on completion/retry', async () => {
  for (const account of accountKeys) {
    const customer = await makeClient(), a = await order(customer, { kind: 'crm_collection', account });
    const before = await wallet(customer.client);
    const result = await finish(a);
    assert.equal(result.collection_only, true);
    assert.equal((await finish(a)).duplicated, true);
    assert.deepEqual(await wallet(customer.client), before);
    for (const table of ['crm_cliente_pagos', 'tc_client_benefit_events', 'cliente_ruleta_giros']) assert.equal(await count(table, customer.client), 0);
    const notes = (await db.query("select texto,event_data from crm_client_notes where cliente_id=$1 and event_type='paypal_collection_confirmed'", [customer.client])).rows;
    assert.equal(notes.length, 1);
    assert.equal(notes[0].event_data.amount, 22);
    assert.equal(notes[0].event_data.collection_only, true);
    assert.match(notes[0].texto, /Cobro recibido; no registra una compra ni concede beneficios/);
    assert.equal(await scalar('select payment_id v from crm_paypal_orders where id=$1', [a.orderId]), null);
  }
});

test('registering each collected Central purchase grants one base balance and one rank award', async () => {
  for (const account of accountKeys) {
    const customer = await makeClient(), a = await order(customer, { kind: 'crm_collection', account });
    await finish(a);
    const payload = newPurchase(customer, { paypal_collection_source: 'crm_collection', paypal_collection_order_id: a.orderId });
    const result = await register(payload);
    assert.equal(result.collection_linked, true);
    assert.deepEqual(await wallet(customer.client), { coins: 1000, free: 12, normal: 21 });
    assert.equal(await count('crm_cliente_pagos', customer.client), 1);
    assert.equal(await count('cliente_ruleta_giros', customer.client), 1);
    assert.equal(await scalar('select payment_id v from crm_paypal_orders where id=$1', [a.orderId]), result.payment.id);
    assert.equal((await register(payload)).duplicate_prevented, true);
    assert.deepEqual(await wallet(customer.client), { coins: 1000, free: 12, normal: 21 });
    await assert.rejects(register({ ...payload, operation_id: id(sequence++) }), /PAYPAL_COLLECTION_ALREADY_REGISTERED/);
  }
});

test('web purchases credit base and rank minutes once, with matching receipt and notification totals', async () => {
  for (const [rank, bonus, coins] of [['bronce', 0, 50], ['plata', 3, 50], ['oro', 5, 50], ['diamante', 8, 300]]) {
    const customer = await makeClient(rank), a = await order(customer);
    const result = await finish(a);
    const expected = { coins: 700 + coins, free: 4 + bonus, normal: 26 };
    assert.deepEqual(await wallet(customer.client), expected);
    assert.equal(result.credited.rank_free_minutes, bonus);
    assert.equal(result.credited.total_minutes, 20 + bonus);
    assert.equal(result.credited.coins, coins);
    const actualSpins = await scalar("select coalesce(jsonb_agg(jsonb_build_object('level',nivel,'count',quantity) order by nivel),'[]'::jsonb) v from (select nivel,count(*)::int quantity from cliente_ruleta_giros where cliente_id=$1 group by nivel) s", [customer.client]);
    assert.deepEqual(result.credited.spins, actualSpins);
    const note = await scalar("select event_data v from crm_client_notes where cliente_id=$1 and event_type='client_paypal_purchase'", [customer.client]);
    assert.deepEqual(note.credited, result.credited);
    assert.equal(note.credited.balances.free_after - note.credited.balances.free_before, bonus);
    const notification = await scalar("select meta v from cliente_notificaciones where cliente_id=$1 and tipo='purchase_completed'", [customer.client]);
    assert.equal(notification.total_minutes, 20 + bonus);
    assert.equal((await finish(a)).duplicated, true);
    await call('tc_apply_purchase_benefits', result.payment_id);
    assert.deepEqual(await wallet(customer.client), expected);
    assert.equal(await count('crm_cliente_pagos', customer.client), 1);
    assert.equal(await scalar("select count(*)::int v from crm_client_notes where cliente_id=$1 and event_type='client_paypal_purchase'", [customer.client]), 1);
    assert.equal(await scalar("select count(*)::int v from tc_client_benefit_events where payment_id=$1 and benefit_key='regular_purchase_minutes'", [result.payment_id]), bonus ? 1 : 0);
  }
});

test('Promo preserves purchased minutes but never adds Coins, wheels or rank minutes in either channel', async () => {
  for (const kind of ['client_purchase', 'crm_collection']) {
    const customer = await makeClient(), a = await order(customer, { kind, promo: true });
    const completed = await finish(a);
    if (kind === 'client_purchase') {
      assert.deepEqual(await wallet(customer.client), { coins: 700, free: 4, normal: 26 });
      assert.equal(completed.credited.rank_free_minutes, 0);
      assert.equal(completed.credited.coins, 0);
    } else {
      assert.deepEqual(await wallet(customer.client), { coins: 700, free: 4, normal: 6 });
      await register(newPurchase(customer, { paypal_collection_source: 'crm_collection', paypal_collection_order_id: a.orderId, promo: true, purchase_classification: 'promo', pricing_mode: 'promotion' }));
      assert.deepEqual(await wallet(customer.client), { coins: 700, free: 4, normal: 21 });
    }
    assert.equal(await count('cliente_ruleta_giros', customer.client), 0);
    assert.equal(await scalar('select coalesce(sum(coins),0)::int v from tc_client_benefit_events where cliente_id=$1', [customer.client]), 0);
  }
});

test('choosing external PayPal cannot silently register a credited web purchase again', async () => {
  const customer = await makeClient(), web = await order(customer);
  await finish(web);
  const payload = newPurchase(customer, { paypal_collection_source: 'external' });
  const before = await wallet(customer.client);
  await assert.rejects(register(payload), /PAYPAL_WEB_PURCHASE_CONFIRMATION_REQUIRED/);
  await assert.rejects(register({ ...payload, separate_payment_confirmed: true }), /PAYPAL_WEB_PURCHASE_CONFIRMATION_REQUIRED/);
  await assert.rejects(register({ ...payload, separate_payment_confirmed: true, confirmed_web_payment_ids: [id(sequence++)] }), /PAYPAL_WEB_PURCHASE_CONFIRMATION_CHANGED/);
  for (const invalid of ['not-an-array', [null], ['not-a-uuid']]) {
    await assert.rejects(register({ ...payload, confirmed_web_payment_ids: invalid }), /PAYPAL_WEB_PURCHASE_CONFIRMATION_INVALID/);
  }
  await assert.rejects(register(newPurchase(customer)), /PAYPAL_PAYMENT_ALREADY_CONFIRMED/);
  assert.deepEqual(await wallet(customer.client), before);
  assert.equal(await count('crm_cliente_pagos', customer.client), 1);
});

test('a deliberately separate PayPal purchase requires the exact current web-payment set and replays once', async () => {
  const customer = await makeClient(), first = await order(customer);
  const firstPayment = (await finish(first)).payment_id;
  const payload = newPurchase(customer, { paypal_collection_source: 'external', separate_payment_confirmed: true, confirmed_web_payment_ids: [firstPayment] });
  const second = await order(customer), secondPayment = (await finish(second)).payment_id;
  await assert.rejects(register(payload), /PAYPAL_WEB_PURCHASE_CONFIRMATION_CHANGED/);
  const confirmed = { ...payload, confirmed_web_payment_ids: [secondPayment, firstPayment] };
  const result = await register(confirmed);
  assert.ok(result.payment.id);
  assert.deepEqual(await scalar("select benefits_context->'confirmed_web_payment_ids' v from crm_cliente_pagos where id=$1", [result.payment.id]), [firstPayment, secondPayment].sort());
  assert.deepEqual(await wallet(customer.client), { coins: 1600, free: 28, normal: 61 });
  assert.equal(await count('crm_cliente_pagos', customer.client), 3);
  assert.equal((await register(confirmed)).duplicate_prevented, true);
  assert.deepEqual(await wallet(customer.client), { coins: 1600, free: 28, normal: 61 });
  const later = await order(customer);
  await finish(later);
  assert.equal((await register(confirmed)).duplicate_prevented, true);
  assert.deepEqual(await wallet(customer.client), { coins: 1900, free: 36, normal: 81 });
  assert.equal(await count('crm_cliente_pagos', customer.client), 4);
});

test('a Central collection with its own capture remains usable alongside a same-price web purchase', async () => {
  const customer = await makeClient();
  const web = await order(customer), collection = await order(customer, { kind: 'crm_collection' });
  await finish(web);
  await finish(collection);
  await register(newPurchase(customer, { paypal_collection_source: 'crm_collection', paypal_collection_order_id: collection.orderId }));
  assert.deepEqual(await wallet(customer.client), { coins: 1300, free: 20, normal: 41 });
  assert.equal(await count('crm_cliente_pagos', customer.client), 2);
});

test('completion cannot use the other payment channel or replay with a different capture', async () => {
  const customer = await makeClient(), web = await order(customer), collection = await order(customer, { kind: 'crm_collection' });
  await assert.rejects(call('tc_complete_paypal_client', collection.orderId, collection.remoteOrder, collection.capture, 22, 'EUR'), /PAYPAL_CHECKOUT_KIND_MISMATCH/);
  await assert.rejects(call('tc_complete_paypal_crm', web.orderId, web.remoteOrder, web.capture, 22, 'EUR'), /PAYPAL_CHECKOUT_KIND_MISMATCH/);
  assert.deepEqual(await wallet(customer.client), { coins: 700, free: 4, normal: 6 });
  await finish(web);
  await assert.rejects(call('tc_complete_paypal_client', web.orderId, web.remoteOrder, 'SYNTHETIC-DIFFERENT-CAPTURE', 22, 'EUR'), /PAYPAL_CAPTURE_MISMATCH/);
  assert.deepEqual(await wallet(customer.client), { coins: 1000, free: 12, normal: 26 });
});

test('using the balance of an already credited web payment consumes minutes without another benefit', async () => {
  const customer = await makeClient(), a = await order(customer);
  const payment = (await finish(a)).payment_id;
  const payload = newPurchase(customer, {
    existing_payment_id: payment, cliente_compra_minutos: false, tipo_registro: 'minutos',
    importe: 0, forma_pago: null, guarda_minutos: false, minutos_guardados_normales: 0,
    codigo_1: 'FREE', minutos_1: 5,
  });
  assert.equal((await register(payload)).payment_linked, true);
  assert.deepEqual(await wallet(customer.client), { coins: 1000, free: 7, normal: 26 });
  assert.equal((await register(payload)).duplicate_prevented, true);
  assert.deepEqual(await wallet(customer.client), { coins: 1000, free: 7, normal: 26 });
  assert.equal(await count('crm_cliente_pagos', customer.client), 1);
  assert.equal(await count('cliente_ruleta_giros', customer.client), 1);
});

test('reapplying the boundary migration preserves customers, orders, credited benefits and histories', async () => {
  const tables = ['crm_clientes', 'crm_paypal_orders', 'crm_cliente_pagos', 'tc_client_benefit_events', 'crm_client_notes'];
  const before = {};
  for (const table of tables) before[table] = await scalar(`select jsonb_agg(to_jsonb(r) order by id) v from ${table} r`);
  await db.exec(read(migrationPath));
  for (const table of tables) assert.deepEqual(await scalar(`select jsonb_agg(to_jsonb(r) order by id) v from ${table} r`), before[table]);
});
