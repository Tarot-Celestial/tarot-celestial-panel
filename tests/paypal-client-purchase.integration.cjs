const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261013182658_paypal_client_purchase_checkout.sql'), 'utf8');
const purchaseRpc = fs.readFileSync(path.join(__dirname, 'fixtures/paypal-client-purchase-v3.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const packs = [
  { total: 10, normal: 10, free: 0, price: 12, level: 1, spins: 1, oracle: 0 },
  { total: 20, normal: 20, free: 0, price: 22, level: 1, spins: 1, oracle: 0 },
  { total: 30, normal: 20, free: 10, price: 26, level: 1, spins: 1, oracle: 0 },
  { total: 40, normal: 30, free: 10, price: 29, level: 2, spins: 1, oracle: 0 },
  { total: 50, normal: 30, free: 20, price: 32, level: 2, spins: 1, oracle: 0 },
  { total: 60, normal: 40, free: 20, price: 35, level: 2, spins: 1, oracle: 0 },
  { total: 80, normal: 50, free: 30, price: 49, level: 3, spins: 1, oracle: 1 },
  { total: 120, normal: 80, free: 40, price: 69, level: 3, spins: 1, oracle: 2 },
  { total: 180, normal: 120, free: 60, price: 99, level: 3, spins: 2, oracle: 3 },
];
let db;
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0].v;
const balance = client => scalar('select jsonb_build_array(minutos_normales_pendientes,minutos_free_pendientes,puntos) v from crm_clientes where id=$1', [client]);
async function setup(n, pack = packs[0], extra = {}) {
  const client = extra.client || id(n + 10000);
  const actor = id(n + 20000);
  await db.query('insert into crm_clientes(id,auth_user_id,test_rank,minutos_normales_pendientes,minutos_free_pendientes) values($1,$2,$3,7,3) on conflict(id) do nothing', [client, actor, extra.rank || 'bronce']);
  const payload = { pack_id: `pack_${pack.total}`, pack_name: `${pack.total} minutos`, total_minutes: pack.total, normal: pack.normal, free: pack.free, points: 0, oracle_credits: pack.oracle, roulette_level: pack.level, roulette_spins: pack.spins, ...extra.payload };
  await db.query(`insert into crm_paypal_orders(id,cliente_id,worker_id,environment,order_id,amount,pack_id,pack_name,purchase_payload,create_payload,checkout_kind,purchaser_auth_user_id,status)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}',$10,$11,$12)`,
  [id(n), client, extra.kind === 'crm_collection' ? id(1) : null, extra.environment || 'sandbox', `ORDER${n}`, pack.price, `pack_${pack.total}`, `${pack.total} minutos`, JSON.stringify(payload), extra.kind || 'client_purchase', extra.kind === 'crm_collection' ? null : actor, extra.status || 'pending']);
  return { n, client, actor, pack };
}
const finish = (a, override = {}) => scalar('select tc_complete_paypal_client($1,$2,$3,$4,$5) v', [id(a.n), override.order || `ORDER${a.n}`, override.capture || `CAP${a.n}`, override.amount ?? a.pack.price, override.currency || 'EUR']);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key);
    insert into workers values('${id(1)}');
    create table crm_clientes(id uuid primary key,auth_user_id uuid,test_rank text,minutos_free_pendientes numeric default 0,minutos_normales_pendientes numeric default 0,puntos numeric default 0,updated_at timestamptz);
    create table crm_cliente_pagos(id uuid primary key default gen_random_uuid(),cliente_id uuid,importe numeric,moneda text,metodo text,estado text,referencia_externa text unique,notas text,pack_id text,pack_name text,paid_minutes numeric,bonus_minutes numeric,stripe_session_id text,payment_intent text,created_by_user_id uuid,created_by_role text,benefits_context jsonb,benefits_processed_at timestamptz,paypal_order_id text,paypal_capture_id text);
    create table crm_client_notes(id uuid primary key default gen_random_uuid(),cliente_id text not null,texto text not null,author_user_id uuid,author_name text,event_type text,event_data jsonb,is_pinned boolean);
    create table cliente_notificaciones(id uuid primary key default gen_random_uuid(),cliente_id uuid,tipo text,titulo text,mensaje text,meta jsonb,leida boolean,created_at timestamptz);
    create table tc_client_benefit_events(id uuid primary key default gen_random_uuid(),payment_id uuid,benefit_key text,coins integer,oracle_credits integer,minutes integer);
    create table cliente_ruleta_giros(id uuid primary key default gen_random_uuid(),purchase_id uuid,nivel integer);
    create table test_benefit_calls(payment_id uuid);
    create table test_faults(kind text primary key);
    create table cliente_payment_settings(id text primary key,provider text,web_payments_enabled boolean);
    insert into cliente_payment_settings values('default','mollie',false);
    -- Contract double for the independently tested benefits subsystem. The
    -- canonical purchase RPC below is an exact read-only production snapshot.
    create function tc_apply_purchase_benefits(p_id uuid) returns jsonb language plpgsql as $$
      declare p crm_cliente_pagos; r text; lev integer; native_spins integer; c integer; o integer;
      begin
        select * into p from crm_cliente_pagos where id=p_id;
        if p.benefits_processed_at is not null then return '{}'::jsonb; end if;
        insert into test_benefit_calls values(p_id);
        select test_rank into r from crm_clientes where id=p.cliente_id;
        lev:=case when p.importe<=26 then 1 when p.importe<=35 then 2 else 3 end;
        native_spins:=case when p.importe=99 then 2 else 1 end;
        c:=case when r='diamante' then 500 when lev=1 then 50 when lev=2 then 150 else 300 end;
        o:=coalesce((p.benefits_context->>'oracle_credits')::integer,0)+case when r='diamante' then case when lev=3 then 3 when lev=2 then 1 else 0 end when lev=3 then 2 else 0 end;
        update crm_clientes set puntos=puntos+c,minutos_free_pendientes=minutos_free_pendientes+case when r='diamante' then 15 else 0 end where id=p.cliente_id;
        insert into tc_client_benefit_events(payment_id,benefit_key,coins,oracle_credits) values(p.id,'test_verified_matrix_contract',c,o);
        if r='diamante' then insert into tc_client_benefit_events(payment_id,benefit_key,minutes) values(p.id,'diamond_purchase_minutes',15); end if;
        for i in 1..native_spins+1 loop insert into cliente_ruleta_giros(purchase_id,nivel) values(p.id,lev); end loop;
        if r='diamante' and lev=3 then insert into cliente_ruleta_giros(purchase_id,nivel) values(p.id,4); end if;
        update crm_cliente_pagos set benefits_processed_at=now() where id=p.id;
        if exists(select 1 from test_faults where kind='benefits') then raise exception 'SIMULATED_BENEFITS_FAILURE'; end if;
        return '{}'::jsonb;
      end $$;
    create function test_note_failure() returns trigger language plpgsql as $$ begin
      if exists(select 1 from test_faults where kind='note') then raise exception 'SIMULATED_NOTE_FAILURE'; end if; return new;
    end $$;
    create trigger test_note_failure before insert on crm_client_notes for each row execute function test_note_failure();
  `);
  await db.exec(purchaseRpc);
  await db.exec('create function cliente_confirmar_compra_ruleta_v2(p jsonb) returns jsonb language sql as $$select cliente_confirmar_compra_ruleta_v3(p)$$;');
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261006235223_paypal_crm_checkout.sql'), 'utf8'));
  await db.exec(migration);
});
after(async () => { if (db) await db.close(); });

test('all nine canonical snapshots credit the requested normal/FREE split and one CRM note plus notification', async () => {
  for (let i = 0; i < packs.length; i++) {
    const a = await setup(100 + i, packs[i]);
    assert.deepEqual(await balance(a.client), [7, 3, 0]);
    const result = await finish(a);
    assert.deepEqual(await balance(a.client), [7 + a.pack.normal, 3 + a.pack.free, [50, 150, 300][a.pack.level - 1]]);
    assert.equal(result.credited.normal, a.pack.normal);
    assert.equal(result.credited.free, a.pack.free);
    assert.equal(result.credited.total_minutes, a.pack.total);
    const payment = await scalar('select to_jsonb(p) v from crm_cliente_pagos p where id=$1', [result.payment_id]);
    assert.equal(payment.created_by_user_id, a.actor);
    assert.equal(payment.created_by_role, 'cliente');
    assert.equal(payment.referencia_externa, `paypal-client:ORDER${a.n}`);
    assert.equal(payment.paypal_capture_id, `CAP${a.n}`);
    const note = await scalar('select event_data v from crm_client_notes where event_data->>\'payment_id\'=$1', [result.payment_id]);
    assert.equal(note.credited.balances.normal_after, 7 + a.pack.normal);
    assert.equal(note.credited.balances.free_after, 3 + a.pack.free);
    const notification = await scalar('select meta v from cliente_notificaciones where meta->>\'payment_id\'=$1 and tipo=\'purchase_completed\'', [result.payment_id]);
    assert.equal(notification.total_minutes, a.pack.total);
    assert.equal(notification.roulette_spins, a.pack.spins + 1);
  }
});

test('Diamond keeps actual extra FREE minutes, Coins, oracle and special spins in its receipt', async () => {
  const a = await setup(200, packs[8], { rank: 'diamante' });
  const result = await finish(a);
  assert.deepEqual(await balance(a.client), [127, 78, 500]);
  assert.equal(result.credited.oracle_credits, 6);
  assert.equal(result.credited.rank_free_minutes, 15);
  assert.equal(result.credited.total_minutes, 195);
  assert.deepEqual(result.credited.spins, [{ level: 3, count: 3 }, { level: 4, count: 1 }]);
});

test('concurrent callbacks and retries credit once and create one note/notification', async () => {
  const a = await setup(210, packs[2]);
  const results = await Promise.all(Array.from({ length: 5 }, () => finish(a)));
  assert.equal(results.filter(r => !r.duplicated).length, 1);
  assert.equal(new Set(results.map(r => r.payment_id)).size, 1);
  assert.deepEqual(await balance(a.client), [27, 13, 50]);
  assert.equal(await scalar('select count(*)::integer v from test_benefit_calls where payment_id=$1', [results[0].payment_id]), 1);
  assert.equal(await scalar('select count(*)::integer v from crm_client_notes where event_data->>\'payment_id\'=$1', [results[0].payment_id]), 1);
  assert.equal(await scalar('select count(*)::integer v from cliente_notificaciones where meta->>\'payment_id\'=$1 and tipo=\'purchase_completed\'', [results[0].payment_id]), 1);
  await assert.rejects(finish(a, { capture: 'OTHER' }), /PAYPAL_CAPTURE_MISMATCH/);
});

test('wrong provider identifiers/amount/currency and malformed snapshots never credit', async () => {
  const a = await setup(220);
  for (const override of [{ order: 'WRONG' }, { amount: 13 }, { currency: 'USD' }]) await assert.rejects(finish(a, override), /PAYPAL_CAPTURE_MISMATCH/);
  assert.deepEqual(await balance(a.client), [7, 3, 0]);
  const bad = await setup(221, packs[0], { payload: { free: 5 } });
  await assert.rejects(finish(bad), /PAYPAL_PURCHASE_SNAPSHOT_INVALID/);
  assert.deepEqual(await balance(bad.client), [7, 3, 0]);
});

test('benefit or note failures roll back the complete purchase and a retry succeeds', async () => {
  for (const [i, kind] of ['benefits', 'note'].entries()) {
    const a = await setup(230 + i);
    await db.query('insert into test_faults values($1)', [kind]);
    await assert.rejects(finish(a), /SIMULATED_/);
    await db.query('delete from test_faults where kind=$1', [kind]);
    assert.deepEqual(await balance(a.client), [7, 3, 0]);
    assert.equal(await scalar('select count(*)::integer v from crm_cliente_pagos where cliente_id=$1', [a.client]), 0);
    assert.equal(await scalar('select status v from crm_paypal_orders where id=$1', [id(a.n)]), 'pending');
    await finish(a);
    assert.deepEqual(await balance(a.client), [17, 3, 50]);
  }
});

test('staff collection remains collection-only and completion functions reject the other checkout kind', async () => {
  const staff = await setup(240, packs[0], { kind: 'crm_collection' });
  const client = await setup(241);
  await assert.rejects(finish(staff), /PAYPAL_CHECKOUT_KIND_MISMATCH/);
  await assert.rejects(scalar('select tc_complete_paypal_crm($1,$2,$3,12,\'EUR\') v', [id(241), 'ORDER241', 'CAP241']), /PAYPAL_CHECKOUT_KIND_MISMATCH/);
  const collection = () => scalar('select tc_complete_paypal_crm($1,$2,$3,12,\'EUR\') v', [id(240), 'ORDER240', 'CAP240']);
  assert.equal((await collection()).collection_only, true);
  assert.equal((await collection()).duplicated, true);
  assert.deepEqual(await balance(staff.client), [7, 3, 0]);
  assert.deepEqual(await balance(client.client), [7, 3, 0]);
  assert.equal(await scalar('select count(*)::integer v from crm_cliente_pagos where cliente_id=$1', [staff.client]), 0);
  assert.equal(await scalar('select count(*)::integer v from crm_client_notes where cliente_id=$1 and event_type=\'paypal_collection_confirmed\'', [staff.client]), 1);
});

test('a captured transaction cannot be credited to two attempts or customers', async () => {
  const first = await setup(250), second = await setup(251);
  await finish(first);
  await assert.rejects(finish(second, { capture: 'CAP250' }), /unique/i);
  assert.deepEqual(await balance(second.client), [7, 3, 0]);
  assert.equal(await scalar('select count(*)::integer v from crm_cliente_pagos where cliente_id=$1', [second.client]), 0);
  assert.equal(await scalar('select count(*)::integer v from crm_client_notes where cliente_id=$1', [second.client]), 0);
});

test('one pending client checkout per environment prevents different request IDs from creating parallel orders', async () => {
  const first = await setup(260);
  await assert.rejects(setup(261, packs[1], { client: first.client }), /one_client_pending/);
  await setup(262, packs[0], { client: first.client, environment: 'live' });
  await setup(263, packs[0], { client: first.client, kind: 'crm_collection' });
  await finish(first);
  const next = await setup(264, packs[1], { client: first.client });
  await db.query('update crm_paypal_orders set status=\'cancelled\' where id=$1', [id(next.n)]);
  await setup(265, packs[1], { client: first.client });
});

test('a real late capture still fulfils its original cancelled snapshot', async () => {
  const a = await setup(270, packs[6], { status: 'cancelled' });
  const result = await finish(a);
  assert.equal(result.credited.normal, 50);
  assert.equal(result.credited.free, 30);
  assert.equal(await scalar('select status v from crm_paypal_orders where id=$1', [id(a.n)]), 'completed');
});

test('orders and completion RPCs stay server-only; actor constraints and independent activation remain intact', async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await scalar("select has_table_privilege($1,'crm_paypal_orders','select') v", [role]), false);
    for (const fn of ['tc_complete_paypal_crm', 'tc_complete_paypal_client']) {
      assert.equal(await scalar(`select has_function_privilege($1,'${fn}(uuid,text,text,numeric,text)','execute') v`, [role]), false);
    }
  }
  assert.equal(await scalar("select relrowsecurity v from pg_class where relname='crm_paypal_orders'"), true);
  await assert.rejects(db.query('update crm_paypal_orders set worker_id=$1 where id=$2', [id(1), id(270)]), /checkout_actor_check/);
  assert.deepEqual(await scalar('select to_jsonb(s) v from cliente_payment_settings s where id=\'default\''), { id: 'default', provider: 'mollie', web_payments_enabled: false, paypal_client_enabled: true });
});

test('reapplying the migration preserves historical purchases, balances and collection links', async () => {
  const before = await scalar('select jsonb_agg(to_jsonb(a) order by id) v from crm_paypal_orders a');
  const balances = await scalar('select jsonb_agg(to_jsonb(c) order by id) v from crm_clientes c');
  await db.exec(migration);
  assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(a) order by id) v from crm_paypal_orders a'), before);
  assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(c) order by id) v from crm_clientes c'), balances);
});


test('promotion snapshots settle exact advertised minutes through the existing client card RPC', async () => {
  for (const [i,total,price,level,coins,oracle] of [[0,30,20,1,50,0],[1,60,30,2,150,0],[2,120,59,3,300,2]]) {
    const a=await setup(800+i,{total,normal:total,free:0,price,level,spins:1,oracle},{payload:{points:coins}});
    const promoId='promo:'+id(900+i), name='Halloween '+total;
    await db.query("update crm_paypal_orders set pack_id=$2,pack_name=$3,purchase_payload=purchase_payload || jsonb_build_object('pack_id',$2::text,'pack_name',$3::text) where id=$1",[id(a.n),promoId,name]);
    const result=await finish(a);assert.equal(result.ok,true);assert.deepEqual((await balance(a.client)).slice(0,2),[7+total,3]);
    const payment=await scalar('select to_jsonb(p) v from crm_cliente_pagos p where id=$1',[result.payment_id]);
    assert.equal(payment.pack_id,promoId);assert.equal(Number(payment.importe),price);assert.equal(Number(payment.paid_minutes),total);assert.equal(Number(payment.bonus_minutes),0);
    assert.equal(payment.benefits_context.coins,coins);assert.equal(payment.benefits_context.oracle_credits,oracle);
    assert.equal((await finish(a)).duplicated,true);assert.deepEqual((await balance(a.client)).slice(0,2),[7+total,3]);
  }
});
