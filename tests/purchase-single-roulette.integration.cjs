const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// All purchases are synthetic and local. The fixture is the production SQL
// snapshot used by payment-source-boundary.integration.cjs, including its
// deferred benefits trigger. Previous non-roulette awards are captured inside
// rolled-back transactions to prove this correction preserves those awards.
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const migrationPath = '../supabase/migrations/20261107165204_purchase_roulette_without_rank_extras.sql';
const promotionMigrationPath = '../supabase/migrations/20261107171110_promo_purchase_no_oracle_extras.sql';
const id = n => `73000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ranks = ['bronce', 'plata', 'oro', 'diamante'];
const channels = ['web', 'central'];
const rankMinutes = { bronce: 0, plata: 3, oro: 5, diamante: 8 };
const packs = [
  { total: 20, normal: 20, free: 0, amount: 22, level: 1, spins: 1, oracle: 0 },
  { total: 60, normal: 40, free: 20, amount: 35, level: 2, spins: 1, oracle: 0 },
  { total: 80, normal: 50, free: 30, amount: 49, level: 3, spins: 1, oracle: 1 },
  { total: 180, normal: 120, free: 60, amount: 99, level: 3, spins: 2, oracle: 3 },
];
let db, historical, historicalState, sequence = 1000;
const baselines = new Map();
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0].v;
const call = (name, ...args) => scalar(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) v`, args);
const key = (rank, channel, pack, mode) => `${rank}/${channel}/${pack.total}/${mode}`;
const balance = client => scalar(`select jsonb_build_object('coins',puntos,'free',minutos_free_pendientes,'normal',minutos_normales_pendientes,
  'oracle',public.get_cliente_oracle_balance(id)) v from crm_clientes where id=$1`, [client]);
const spins = payment => scalar("select coalesce(jsonb_agg(nivel order by nivel),'[]'::jsonb) v from cliente_ruleta_giros where purchase_id=$1", [payment]);
const historicalSnapshot = async () => ({
  wallet: await balance(historical.client),
  payment: await scalar('select to_jsonb(p) v from crm_cliente_pagos p where id=$1', [historical.paymentId]),
  spins: await scalar('select jsonb_agg(to_jsonb(s) order by id) v from cliente_ruleta_giros s where purchase_id=$1', [historical.paymentId]),
  events: await scalar('select jsonb_agg(to_jsonb(e) order by id) v from tc_client_benefit_events e where payment_id=$1', [historical.paymentId]),
});

async function customer(rank) {
  const client = id(sequence++), actor = id(sequence++);
  await db.query("insert into crm_clientes(id,nombre,telefono,telefono_normalizado,puntos,minutos_free_pendientes,minutos_normales_pendientes,auth_user_id) values($1,'Synthetic roulette customer','000','000',700,4,6,$2)", [client, actor]);
  await db.query("insert into client_rank_overrides(client_id,assigned_rank,intervention_type,reason,created_by,starts_at,active) values($1,$2,'temporary','Synthetic roulette regression',$3,now()-interval '1 day',true)", [client, rank, id(11)]);
  return { client, actor };
}

async function prepare(rank, channel, pack, mode = 'nada', extra = {}) {
  const c = await customer(rank), orderId = id(sequence++), operationId = id(sequence++);
  const remoteOrder = `SYNTHETIC-ROULETTE-${orderId}`, capture = `SYNTHETIC-CAPTURE-${orderId}`;
  const pricing = mode === 'promo' ? 'promotion' : mode === 'super_promo_ruleta' ? 'super_promo' : 'regular';
  const packId = `pack_${pack.total}`;
  await db.query(`insert into crm_paypal_orders(id,cliente_id,worker_id,environment,order_id,amount,pack_id,pack_name,purchase_payload,create_payload,checkout_kind,purchaser_auth_user_id)
    values($1,$2,$3,'sandbox',$4,$5,$6,$7,$8,'{}',$9,$10)`,
  [orderId, c.client, channel === 'central' ? id(1) : null, remoteOrder, pack.amount, packId, `Synthetic ${pack.total} minute pack`, JSON.stringify({
    pack_id: packId, pack_name: `Synthetic ${pack.total} minute pack`, normal: pack.normal, free: pack.free, total_minutes: pack.total,
    points: 0, oracle_credits: pack.oracle, roulette_level: pack.level, roulette_spins: pack.spins,
    pricing_mode: pricing, purchase_classification: mode, paypal_account: 'client_business_v1', ...extra,
  }), channel === 'web' ? 'client_purchase' : 'crm_collection', channel === 'web' ? c.actor : null]);
  const finish = () => call(channel === 'web' ? 'tc_complete_paypal_client' : 'tc_complete_paypal_crm', orderId, remoteOrder, capture, pack.amount, 'EUR');
  const registration = {
    operation_id: operationId, cliente_id: c.client, telefonista_worker_id: id(1), tarotista_worker_id: id(2),
    cliente_compra_minutos: true, tipo_registro: 'compra', codigo_1: 'CLIENTE', minutos_1: 5, minutos_2: 0,
    guarda_minutos: true, minutos_guardados_free: pack.free, minutos_guardados_normales: pack.normal - 5,
    importe: pack.amount, forma_pago: 'paypal_manual', promo: mode === 'promo', captado: false, recuperado: false,
    super_promo_ruleta: mode === 'super_promo_ruleta', purchase_classification: mode, pricing_mode: pricing,
    points_to_add: 0, purchase_benefits: { oracle_credits: pack.oracle, roulette_level: pack.level, roulette_spins: pack.spins },
    expected_paypal_environment: 'sandbox', paypal_collection_source: 'crm_collection', paypal_collection_order_id: orderId,
    note_text: 'Synthetic roulette purchase', ...extra,
  };
  const register = () => call('tc_register_call_minutes', JSON.stringify(registration));
  if (channel === 'central') {
    await finish();
    assert.deepEqual(await balance(c.client), { coins: 700, free: 4, normal: 6, oracle: 0 });
  }
  return { ...c, orderId, finish, execute: channel === 'web' ? finish : register };
}

async function execute(rank, channel, pack, mode = 'nada') {
  const p = await prepare(rank, channel, pack, mode), result = await p.execute();
  const paymentId = result.payment_id || result.payment.id;
  return { ...p, paymentId, result };
}

const scenarios = [];
for (const rank of ranks) for (const channel of channels) for (const pack of packs) {
  scenarios.push({ rank, channel, pack, mode: 'nada' }, { rank, channel, pack, mode: 'promo' });
}
for (const rank of ranks) scenarios.push({ rank, channel: 'central', pack: packs[1], mode: 'super_promo_ruleta' });
for (const channel of channels) for (const pack of packs) scenarios.push({ rank: 'diamante', channel, pack, mode: 'ruleta_diamante' });

before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(read('fixtures/benefits-nov-schema.sql'));
  await db.exec(read('fixtures/benefits-nov-schema-extra.sql'));
  // Supabase request-claims contract and the columns needed by the production
  // admin guards; permission checks themselves use the captured real functions.
  await db.exec(`create schema auth; create schema private;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create table worker_admin_access(worker_id uuid,user_id uuid,is_active boolean,revoked_at timestamptz);
    create table tc_client_promotions(id uuid primary key,name text,description text,status text,starts_at timestamptz,ends_at timestamptz,
      active_until_disabled boolean,promotion_kind text,authorized_rank text,image_url text,benefit jsonb,max_uses_per_client integer,
      benefit_revision integer,created_by uuid,updated_at timestamptz);
    select set_config('request.jwt.claims','{"role":"service_role"}',false);`);
  await db.exec("create sequence fixture_call_number; alter table rendimiento_llamadas alter column id_unico set default nextval('fixture_call_number');");
  for (const [table, rows] of Object.entries(JSON.parse(read('fixtures/benefits-nov-config.json')))) for (const row of rows) {
    const columns = Object.keys(row);
    await db.query(`insert into ${table}(${columns.map(k => `"${k}"`).join(',')}) values(${columns.map((_, i) => `$${i + 1}`).join(',')})`, columns.map(k => typeof row[k] === 'object' && row[k] !== null && !Array.isArray(row[k]) ? JSON.stringify(row[k]) : row[k]));
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
  for (const file of ['20261102025228_customer_benefits_november_2026.sql', '20261102153603_customer_coins_catalog_sync.sql', '20261103010836_customer_diamond_roulette_choice.sql']) await db.exec(read(`../supabase/migrations/${file}`));
  for (const row of JSON.parse(read('fixtures/payment-source-live-functions.json'))) await db.exec(row.definition);
  await db.exec('set check_function_bodies=off');
  for (const row of JSON.parse(read('fixtures/purchase-single-roulette-live-functions.json'))) await db.exec(row.definition);
  for (const row of JSON.parse(read('fixtures/purchase-single-roulette-private-functions.json'))) await db.exec(row.definition);
  for (const row of JSON.parse(read('fixtures/purchase-single-roulette-admin-functions.json'))) await db.exec(row.definition);
  await db.exec('set check_function_bodies=on');
  await db.exec(`create constraint trigger tc_purchase_benefits after insert or update on public.crm_cliente_pagos
    deferrable initially deferred for each row when (new.estado='completed' and new.benefits_processed_at is null)
    execute function tc_purchase_benefits_trigger();`);
  await db.exec(read('../supabase/migrations/20261107162640_payment_source_boundary_rank_summary.sql'));
  await db.query("insert into workers(id,user_id,role,display_name,is_active) values($1,$2,'central','Synthetic Central',true),($3,$4,'tarotista','Synthetic Reader',true)", [id(1), id(11), id(2), id(12)]);
  await db.query("insert into workers(id,user_id,role,display_name,is_active) values($1,$2,'admin','Synthetic Admin',true)", [id(3), id(13)]);
  for (const { rank, channel, pack, mode } of scenarios) {
    await db.exec('begin');
    try {
      const result = await execute(rank, channel, pack, mode);
      await db.exec('set constraints all immediate');
      baselines.set(key(rank, channel, pack, mode), await balance(result.client));
    } finally { await db.exec('rollback'); }
  }
  historical = await execute('plata', 'web', packs[0]);
  assert.deepEqual(await spins(historical.paymentId), [1, 1], 'the previous implementation reproduces the reported duplicate');
  historicalState = await historicalSnapshot();
  await db.exec(read(migrationPath));
  await db.exec(read(promotionMigrationPath));
  // Reuse exact captured grant helpers from the separate Oracle payment suite.
  // No mock of Oracle settlement: the real finalizer runs with the deferred trigger.
  const oracleSource = read('paypal-oracle-fulfillment.integration.cjs');
  const oracleStart = oracleSource.indexOf('const liveFunctions=') + 'const liveFunctions='.length;
  const oracleDefinitions = JSON.parse(oracleSource.slice(oracleStart, oracleSource.indexOf('\n};', oracleStart) + 2));
  await db.exec(`create table cliente_oracle_question_movements(id uuid primary key default gen_random_uuid(),cliente_id uuid not null,
    amount integer not null,movement_type text not null,reference text,notes text,meta jsonb default '{}',created_at timestamptz default now());
    create unique index fixture_question_reference on cliente_oracle_question_movements(reference) where reference is not null;`);
  await db.exec(oracleDefinitions.get_cliente_oracle_question_balance);
  await db.exec(oracleDefinitions.grant_cliente_oracle_questions);
  await db.exec(read('../supabase/migrations/20261029005516_paypal_oracle_fulfillment.sql'));
});
after(async () => { await db?.close(); });

for (const rank of ranks) for (const channel of channels) {
  test(`normal ${rank}/${channel}: purchase-level wheels only; Coins, minutes and Oracle preserved`, async () => {
    for (const pack of packs) {
      const p = await execute(rank, channel, pack);
      const expected = baselines.get(key(rank, channel, pack, 'nada'));
      assert.deepEqual(await balance(p.client), expected);
      assert.equal(expected.coins, 700 + (rank === 'diamante' ? 300 : [50, 150, 300][pack.level - 1]));
      assert.equal(expected.free, 4 + pack.free + rankMinutes[rank]);
      assert.equal(expected.normal, 6 + pack.normal - (channel === 'central' ? 5 : 0));
      assert.deepEqual(await spins(p.paymentId), Array(pack.spins).fill(pack.level));
      assert.equal(await scalar("select count(*)::int v from cliente_ruleta_giros where purchase_id=$1 and source='rank_package_matrix'", [p.paymentId]), 0);
      if (channel === 'web') {
        assert.deepEqual(p.result.credited.spins, [{ level: pack.level, count: pack.spins }]);
        assert.equal(p.result.credited.rank_free_minutes, rankMinutes[rank]);
      }
      await p.execute();
      await call('tc_apply_purchase_benefits', p.paymentId);
      assert.deepEqual(await balance(p.client), expected);
      assert.deepEqual(await spins(p.paymentId), Array(pack.spins).fill(pack.level));
    }
  });
}

for (const channel of channels) {
  test(`Promo/${channel}: no Coins, Oracle, rank minutes or wheels at any rank/level`, async () => {
    assert.ok([...baselines.entries()].some(([key, value]) => key.endsWith('/promo') && value.oracle > 0), 'the previous engine reproduces the Oracle benefit leak');
    for (const rank of ranks) for (const pack of packs) {
      const p = await execute(rank, channel, pack, 'promo');
      assert.deepEqual(await spins(p.paymentId), []);
      const actual = await balance(p.client);
      assert.deepEqual(actual, { ...baselines.get(key(rank, channel, pack, 'promo')), oracle: 0 });
      assert.equal(await scalar('select coalesce(sum(oracle_credits),0)::int v from tc_client_benefit_events where payment_id=$1', [p.paymentId]), 0);
      assert.equal(await scalar('select count(*)::int v from cliente_oracle_credit_movements where cliente_id=$1', [p.client]), 0);
      assert.equal(actual.coins, 700);
      assert.equal(actual.free, 4 + pack.free);
      assert.equal(actual.normal, 6 + pack.normal - (channel === 'central' ? 5 : 0));
      await p.execute();
      assert.deepEqual(await balance(p.client), actual);
      assert.deepEqual(await spins(p.paymentId), []);
    }
  });

  test(`Diamond choice/${channel}: exactly one Diamond wheel replaces all level wheels`, async () => {
    for (const pack of packs) {
      const p = await execute('diamante', channel, pack, 'ruleta_diamante');
      assert.deepEqual(await spins(p.paymentId), [5]);
      const actual = await balance(p.client);
      assert.deepEqual(actual, baselines.get(key('diamante', channel, pack, 'ruleta_diamante')));
      assert.equal(actual.coins, 1000);
      assert.equal(actual.free, 4 + pack.free + 8);
      await p.execute();
      await call('tc_apply_purchase_benefits', p.paymentId);
      assert.deepEqual(await balance(p.client), actual);
      assert.deepEqual(await spins(p.paymentId), [5]);
    }
  });

  test(`concurrent retries/${channel}: one payment, one level-one spin and one 50-Coin award`, async () => {
    const p = await prepare('plata', channel, packs[0]);
    const results = await Promise.all(Array.from({ length: 5 }, () => p.execute()));
    const paymentIds = new Set(results.map(r => r.payment_id || r.payment.id));
    assert.equal(paymentIds.size, 1);
    assert.equal(results.filter(r => !r.duplicated && !r.duplicate_prevented).length, 1);
    assert.deepEqual(await spins([...paymentIds][0]), [1]);
    assert.deepEqual(await balance(p.client), baselines.get(key('plata', channel, packs[0], 'nada')));
    assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1', [p.client]), 1);
  });
}

test('Super Promo retains one exclusive Special wheel with no normal wheel or Coins', async () => {
  for (const rank of ranks) {
    const p = await execute(rank, 'central', packs[1], 'super_promo_ruleta');
    assert.deepEqual(await spins(p.paymentId), [4]);
    const actual = await balance(p.client);
    assert.deepEqual(actual, baselines.get(key(rank, 'central', packs[1], 'super_promo_ruleta')));
    assert.equal(actual.coins, 700);
    assert.equal(actual.free, 4 + packs[1].free);
    await p.execute();
    assert.deepEqual(await balance(p.client), actual);
    assert.deepEqual(await spins(p.paymentId), [4]);
  }
});

test('promotion preview excludes Oracle even when its configured rank matrix includes it', async () => {
  await db.query("insert into tc_purchase_package_levels(package_source,package_key,package_label,package_level) values('promotion','synthetic-oracle-promo','Synthetic promotion',3)");
  for (const rank of ranks) {
    const c = await customer(rank);
    const standard = await call('tc_resolve_rank_package_benefit', c.client, null, 'standard', 'pack_80', null);
    assert.ok(standard.rank_benefits.oracle_credits > 0, 'the regular rank/package retains Oracle');
    const promo = await call('tc_resolve_rank_package_benefit', c.client, null, 'promotion', 'synthetic-oracle-promo', null);
    assert.equal(promo.rank_benefits.oracle_credits, 0);
    assert.equal(promo.rank_benefits.coins, 0);
  }
});

test('direct paid Oracle credits and questions settle once, without minute-purchase benefits', async () => {
  for (const pack of [
    { id: 'oracle_2', name: 'Pack Oráculo', amount: 1, credits: 2, questions: 0 },
    { id: 'destino_3', name: 'Pack Destino', amount: 2, credits: 3, questions: 0 },
    { id: 'oracle_questions_3', name: 'Preguntas al Oráculo', amount: 2, credits: 0, questions: 3 },
  ]) {
    const c = await customer('diamante'), order = id(sequence++);
    const remote = `SYNTHETIC-ORACLE-${order}`, capture = `SYNTHETIC-ORACLE-CAPTURE-${order}`;
    const snapshot = { purchase_kind: 'oracle', pack_id: pack.id, pack_name: pack.name, normal: 0, free: 0, total_minutes: 0,
      points: 0, oracle_credits: pack.credits, oracle_questions: pack.questions, roulette_level: null, roulette_spins: 0,
      package_level: null, reward_policy_version: 1, pricing_mode: 'oracle', purchase_classification: 'nada', rewards_eligible: false, created_by_role: 'cliente' };
    await db.query(`insert into crm_paypal_orders(id,cliente_id,environment,order_id,amount,pack_id,pack_name,purchase_payload,create_payload,checkout_kind,purchaser_auth_user_id)
      values($1,$2,'sandbox',$3,$4,$5,$6,$7,'{}','client_purchase',$8)`, [order,c.client,remote,pack.amount,pack.id,pack.name,JSON.stringify(snapshot),c.actor]);
    const finish = () => call('tc_complete_paypal_oracle', order, remote, capture, pack.amount, 'EUR');
    const results = await Promise.all(Array.from({ length: 5 }, finish));
    assert.equal(new Set(results.map(r => r.payment_id)).size, 1);
    assert.equal(results.filter(r => !r.duplicated).length, 1);
    assert.deepEqual(await balance(c.client), { coins: 700, free: 4, normal: 6, oracle: pack.credits });
    assert.equal(await call('get_cliente_oracle_question_balance', c.client), pack.questions);
    assert.deepEqual(await spins(results[0].payment_id), []);
    assert.equal(await scalar('select count(*)::int v from tc_client_benefit_events where payment_id=$1', [results[0].payment_id]), 0);
    assert.equal(await scalar('select count(*)::int v from crm_client_notes where cliente_id=$1', [c.client]), 1);
    await call('tc_apply_purchase_benefits', results[0].payment_id);
    assert.deepEqual(await balance(c.client), { coins: 700, free: 4, normal: 6, oracle: pack.credits });
    assert.equal(await call('get_cliente_oracle_question_balance', c.client), pack.questions);
  }
});

test('non-Diamond customers cannot choose a Diamond wheel', async () => {
  for (const rank of ['bronce', 'plata', 'oro']) {
    const p = await prepare(rank, 'web', packs[0], 'ruleta_diamante');
    await assert.rejects(p.execute(), /DIAMOND_ROULETTE_REQUIRES_DIAMOND/);
    assert.deepEqual(await balance(p.client), { coins: 700, free: 4, normal: 6, oracle: 0 });
    assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1', [p.client]), 0);
  }
});

test('resolver, preview and customer configuration advertise no additional rank wheels', async () => {
  const fields = ['roulette_level_1_spins', 'roulette_level_2_spins', 'roulette_level_3_spins', 'roulette_special_spins'];
  for (const rank of ranks) for (const pack of packs.slice(0, 3)) {
    const c = await customer(rank);
    const resolution = await call('tc_resolve_rank_package_benefit', c.client, null, 'standard', `pack_${pack.total}`, null);
    const preview = await scalar('select tc_preview_rank_package_benefit($1,$2::smallint) v', [rank, pack.level]);
    for (const field of fields) {
      assert.equal(resolution.rank_benefits[field], 0, `resolver ${rank}/${pack.level}/${field}`);
      assert.equal(preview[field], 0, `preview ${rank}/${pack.level}/${field}`);
    }
    assert.doesNotMatch(preview.summary || '', /giro|ruleta/i);
  }
  const configuration = await call('tc_customer_benefits_config');
  for (const row of configuration.package_benefits) for (const field of [...fields, 'roulette_diamond_spins']) assert.equal(row[field], 0);
});

test('admin save guards reject reintroducing rank wheel extras without changing configuration', async () => {
  const before = await scalar('select jsonb_agg(to_jsonb(c) order by rank_key,package_level) v from tc_rank_package_benefits c');
  for (const field of ['roulette_level_1_spins', 'roulette_level_2_spins', 'roulette_level_3_spins', 'roulette_special_spins', 'roulette_diamond_spins']) {
    await assert.rejects(call('tc_save_rank_package_benefit', id(13), JSON.stringify({ rank_key: 'plata', package_level: 1, [field]: 1 })), /RANK_PURCHASE_ROULETTE_DISABLED/);
  }
  await assert.rejects(call('tc_save_rank_benefit_config', id(13), 'rank', JSON.stringify({ rank_key: 'plata', roulette_enabled: true })), /RANK_PURCHASE_ROULETTE_DISABLED/);
  assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(c) order by rank_key,package_level) v from tc_rank_package_benefits c'), before);
});

test('already processed historical payments and their existing rewards are unchanged', async () => {
  assert.deepEqual(await historicalSnapshot(), historicalState);
  await historical.execute();
  await call('tc_apply_purchase_benefits', historical.paymentId);
  assert.deepEqual(await historicalSnapshot(), historicalState);
});

test('reapplying the roulette migration does not change already processed purchases or balances', async () => {
  const tables = ['crm_clientes', 'crm_cliente_pagos', 'cliente_ruleta_giros', 'tc_client_benefit_events', 'cliente_oracle_credit_movements'];
  const before = {};
  for (const table of tables) before[table] = await scalar(`select jsonb_agg(to_jsonb(r) order by id) v from ${table} r`);
  await db.exec(read(migrationPath));
  await db.exec(read(promotionMigrationPath));
  for (const table of tables) assert.deepEqual(await scalar(`select jsonb_agg(to_jsonb(r) order by id) v from ${table} r`), before[table]);
});

test('reconciliation revokes only evidenced pending November rank extras and preserves every other reward', async () => {
  const reconciliationPath = '../supabase/migrations/20261107165524_reconcile_pending_rank_roulette_extras.sql';
  const correctionKey = 'rank_roulette_extras_20261107_v1';
  const spinRow = spin => scalar('select to_jsonb(s) v from cliente_ruleta_giros s where id=$1', [spin]);
  async function fixture(options = {}) {
    const c = await customer('plata'), payment = id(sequence++), base = id(sequence++), extra = id(sequence++);
    const createdAt = options.october ? '2026-10-31T12:00:00Z' : options.expired ? '2026-11-02T12:00:00Z' : null;
    const context = options.missingPricing ? {} : { pricing_mode: options.promo ? 'promotion' : 'regular' };
    if (!options.noPayment) {
      await db.query(`insert into crm_cliente_pagos(id,cliente_id,importe,moneda,metodo,estado,referencia_externa,pack_id,benefits_context,benefits_processed_at,created_at)
        values($1,$2,22,'EUR','fixture',$3,$4,'pack_20',$5,case when $6 then null else now() end,coalesce($7::timestamptz,now()))`,
      [payment, c.client, options.cancelled ? 'cancelled' : 'completed', `fixture-reconciliation:${payment}`, JSON.stringify(context), Boolean(options.unprocessed), createdAt]);
    }
    if (!options.noProcessedEvent) {
      await db.query("insert into tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,snapshot) values($1,$2,'plata','purchase_processed','processed','{}')", [c.client, payment]);
    }
    if (!options.noBase) {
      const state = options.revokedBase ? 'revoked' : options.pendingBase ? 'pending' : 'used';
      await db.query(`insert into cliente_ruleta_giros(id,cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,created_at,used_at,reward_type,reward_value,result_status,reward_meta)
        values($1,$2,$3,'rank_benefits',1,$4,22,'EUR',$5,coalesce($6::timestamptz,now()),case when $5='used' then now() end,
          case when $5='used' then 'coins' end,case when $5='used' then 7 end,case when $5='used' then 'credited' end,'{"fixture":"native"}')`,
      [base, c.client, `benefit:${payment}:purchase_roulette:1`, payment, state, createdAt]);
      await db.query("insert into tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,spin_id) values($1,$2,'plata','purchase_roulette:1','roulette',$3)", [c.client, payment, base]);
      if (state === 'used') {
        await db.query("insert into tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,spin_id,coins,snapshot) values($1,$2,'plata',$3,'roulette_result',$4,7,'{\"result\":\"native reward retained\"}')", [c.client, payment, `roulette_result:${base}`, base]);
        await db.query('update crm_clientes set puntos=puntos+7 where id=$1', [c.client]);
      }
    }
    const source = options.legacy ? 'rank_benefits' : 'rank_package_matrix';
    const paymentKey = options.legacy ? `benefit:${payment}:rank_roulette:1` : `rank-package:${payment}:l1:1`;
    const hasResult = Boolean(options.usedExtra || options.rewardPresent);
    await db.query(`insert into cliente_ruleta_giros(id,cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,created_at,used_at,reward_type,reward_value,result_status,reward_meta)
      values($1,$2,$3,$4,1,$5,22,'EUR',$6,coalesce($7::timestamptz,now()),case when $8 then now() end,
        case when $9 then 'minutes' end,case when $9 then 2 end,case when $9 then 'credited' end,'{"fixture":"extra metadata retained"}')`,
    [extra, c.client, paymentKey, source, payment, options.usedExtra ? 'used' : 'pending', createdAt, Boolean(options.usedExtra || options.usedAtPending), hasResult]);
    if (!options.noEvidence) {
      if (options.legacy) {
        await db.query("insert into tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,spin_id) values($1,$2,'plata','rank_roulette:1','roulette',$3)", [c.client, payment, extra]);
      } else {
        await db.query("insert into tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,delivery_key,snapshot) values($1,$2,'plata','rank_package:1','rank_package',$3,$4)",
        [c.client, payment, `rank-package:${payment}`, JSON.stringify({ delivered: { spin_ids: [extra] } })]);
      }
    }
    if (options.resultEvent) await db.query("insert into tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,spin_id) values($1,$2,'plata',$3,'roulette_result',$4)", [c.client, payment, `roulette_result:${extra}`, extra]);
    if (options.unprocessed) {
      // This is deliberately unfinished legacy data, not a purchase operation;
      // the deferred production trigger must not complete our exclusion fixture.
      await db.query("update crm_cliente_pagos set estado='pending' where id=$1", [payment]);
    }
    return { ...c, payment, base: options.noBase ? null : base, extra, beforeExtra: await spinRow(extra), beforeBase: options.noBase ? null : await spinRow(base) };
  }

  const eligible = [await fixture(), await fixture({ legacy: true, pendingBase: true }), await fixture({ expired: true })];
  const excluded = [];
  for (const options of [
    { october: true }, { usedExtra: true }, { revokedBase: true }, { noBase: true }, { noPayment: true },
    { cancelled: true }, { noProcessedEvent: true }, { missingPricing: true }, { promo: true },
    { noEvidence: true }, { rewardPresent: true }, { resultEvent: true }, { usedAtPending: true },
  ]) excluded.push(await fixture(options));
  const protectedTables = ['crm_clientes', 'crm_cliente_pagos', 'tc_client_benefit_events', 'cliente_puntos_historial', 'cliente_oracle_credit_movements', 'cliente_notificaciones'];
  const protectedBefore = {};
  for (const table of protectedTables) protectedBefore[table] = await scalar(`select jsonb_agg(to_jsonb(r) order by id) v from ${table} r`);
  await db.exec(read(reconciliationPath));
  for (const table of protectedTables) assert.deepEqual(await scalar(`select jsonb_agg(to_jsonb(r) order by id) v from ${table} r`), protectedBefore[table], `${table} must remain untouched`);
  for (const entry of eligible) {
    const afterExtra = await spinRow(entry.extra), metadata = afterExtra.reward_meta[correctionKey];
    assert.equal(afterExtra.estado, 'revoked');
    assert.equal(afterExtra.reward_meta.fixture, 'extra metadata retained');
    assert.equal(metadata.previous_state, 'pending');
    assert.equal(metadata.payment_id, entry.payment);
    assert.equal(metadata.coins_changed, 0);
    assert.equal(metadata.minutes_changed, 0);
    assert.deepEqual(await spinRow(entry.base), entry.beforeBase, 'the original purchase spin and its result stay identical');
    const audits = (await db.query('select before_data,after_data from tc_client_benefit_audit where action=$1 and entity_id=$2', [correctionKey, entry.extra])).rows;
    assert.equal(audits.length, 1);
    assert.deepEqual(audits[0].before_data, entry.beforeExtra);
    assert.deepEqual(audits[0].after_data, afterExtra);
    const notes = (await db.query("select texto,event_data from crm_client_notes where cliente_id=$1 and event_type='roulette_rank_extras_reconciled'", [entry.client])).rows;
    assert.equal(notes.length, 1);
    assert.deepEqual(notes[0].event_data.spin_ids, [entry.extra]);
    assert.equal(notes[0].event_data.revoked_count, 1);
    assert.equal(notes[0].event_data.coins_changed, 0);
    assert.equal(notes[0].event_data.minutes_changed, 0);
    assert.match(notes[0].texto, /No se han cambiado Coins ni minutos/);
  }
  for (const entry of excluded) {
    assert.deepEqual(await spinRow(entry.extra), entry.beforeExtra);
    if (entry.base) assert.deepEqual(await spinRow(entry.base), entry.beforeBase);
    assert.equal(await scalar('select count(*)::int v from tc_client_benefit_audit where action=$1 and entity_id=$2', [correctionKey, entry.extra]), 0);
    assert.equal(await scalar("select count(*)::int v from crm_client_notes where cliente_id=$1 and event_type='roulette_rank_extras_reconciled'", [entry.client]), 0);
  }
  const rerunTables = ['cliente_ruleta_giros', 'tc_client_benefit_audit', 'crm_client_notes'];
  const rerunBefore = {};
  for (const table of rerunTables) rerunBefore[table] = await scalar(`select jsonb_agg(to_jsonb(r) order by id) v from ${table} r`);
  await db.exec(read(reconciliationPath));
  for (const table of rerunTables) assert.deepEqual(await scalar(`select jsonb_agg(to_jsonb(r) order by id) v from ${table} r`), rerunBefore[table]);
});

