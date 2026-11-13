const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db, incomeCategory, expenseCategory, method, legacyBefore, sequence = 100;
const actor = id(1);
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0].v;
const call = (name, ...args) => scalar(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) v`, args);
const snapshot = (user = actor) => call('accounting_snapshot', user);
const post = (entry, user = actor) => call('accounting_post_entry', user, JSON.stringify(entry));
const voidEntry = (entryId, reason = 'Rectificación del movimiento', user = actor) => call('accounting_void_entry', user, entryId, reason);
const option = (payload, user = actor) => call('accounting_upsert_option', user, JSON.stringify(payload));
const payload = (kind, amount = 10000, rest = {}) => ({
  id: id(sequence++), kind, account: 'celestial', to_account: kind === 'transfer' ? 'leonaris' : null,
  currency: 'EUR', amount_cents: amount, occurred_on: '2026-11-12',
  category_id: kind === 'income' ? incomeCategory : kind === 'expense' ? expenseCategory : null,
  method_id: method, description: 'Movimiento sintético de prueba', reference: '', recipient: null, ...rest,
});
const activeCount = () => scalar('select count(*)::int v from public.tc_accounting_ledger_entries where voided_at is null');
const legacyState = () => scalar(`select jsonb_build_object(
  'columns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) order by ordinal_position)
    from information_schema.columns where table_schema='public' and table_name='accounting_entries'),
  'rows',(select jsonb_agg(to_jsonb(e) order by id) from public.accounting_entries e),
  'tables',(select jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'acl',relacl::text) order by relname) from pg_class
    where oid in ('public.accounting_entries'::regclass,'public.accounting_movement_options'::regclass,'public.accounting_receivables'::regclass,'public.accounting_settlements'::regclass,'public.accounting_audit_log'::regclass)),
  'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(oid,true),'enabled',tgenabled) order by tgname)
    from pg_trigger where tgrelid='public.accounting_entries'::regclass and not tgisinternal),
  'policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='accounting_entries'),
  'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename='accounting_entries'),
  'trigger_function',pg_get_functiondef('public.legacy_accounting_trigger()'::regprocedure),
  'trigger_hits',(select count(*) from public.accounting_audit_log),
  'options',(select jsonb_agg(to_jsonb(o) order by id) from public.accounting_movement_options o),
  'receivables',(select jsonb_agg(to_jsonb(r) order by id) from public.accounting_receivables r),
  'settlements',(select jsonb_agg(to_jsonb(s) order by id) from public.accounting_settlements s)
) v`);

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.test_admins(id uuid primary key,active boolean not null);
    insert into public.test_admins values('${actor}',true),('${id(2)}',false),('${id(3)}',true);
    create function public.tc_has_admin_access(p_user_id uuid) returns boolean language sql security invoker set search_path='' as $$
      select exists(select 1 from public.test_admins where id=p_user_id and active)
    $$;
    grant usage on schema public to service_role,anon,authenticated;
    grant select on public.test_admins to service_role;
    -- Unrelated accounting/customer data must never be touched by the feature.
    create table public.crm_cliente_pagos(id int primary key,importe numeric);
    insert into public.crm_cliente_pagos values(1,42.15);
    -- Existing FinanceControlCenter schema is incompatible by design. A new
    -- feature must not adopt its table, read its rows, rewrite grants or triggers.
    create table public.accounting_entries(id uuid primary key,entry_date date not null,month_key text,entry_type text,amount_eur numeric(12,2),kind text,amount numeric,business text);
    create table public.accounting_movement_options(id int primary key,name text);
    create table public.accounting_receivables(id int primary key,amount_eur numeric);
    create table public.accounting_settlements(id int primary key,amount_eur numeric);
    create table public.accounting_audit_log(id bigint generated always as identity primary key,operation text);
    insert into public.accounting_movement_options values(1,'Legacy option');
    insert into public.accounting_receivables values(1,20.15);
    insert into public.accounting_settlements values(1,10.20);
    create function public.legacy_accounting_trigger() returns trigger language plpgsql security invoker set search_path='' as $$begin
      insert into public.accounting_audit_log(operation) values(tg_op);
      return case when tg_op='DELETE' then old else new end;
    end$$;
    create trigger legacy_accounting_audit after insert or update or delete on public.accounting_entries
      for each row execute function public.legacy_accounting_trigger();
    insert into public.accounting_entries values('${id(900000)}','2026-10-31','2026-10','income',432.15,'legacy',432.15,'legacy-business');
    grant select on public.accounting_entries to anon,authenticated;
    grant select,insert,update,delete on public.accounting_entries to service_role;
    grant select on public.accounting_movement_options,public.accounting_receivables,public.accounting_settlements,public.accounting_audit_log to authenticated,service_role;
    alter table public.accounting_entries enable row level security;
    create policy legacy_accounting_read on public.accounting_entries for select to authenticated using(true);
  `);
  legacyBefore = await legacyState();
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/accounting-ledger.sql'), 'utf8'));
  incomeCategory = await scalar("select id v from public.tc_accounting_categories where kind='income' and name='Venta de minutos'");
  expenseCategory = await scalar("select id v from public.tc_accounting_categories where kind='expense' and name='Centrales'");
  method = await scalar("select id v from public.tc_accounting_methods where name='PayPal'");
});
beforeEach(async () => {
  await db.exec('truncate public.tc_accounting_ledger_entries,public.tc_accounting_option_audit; update public.test_admins set active=true where id in (\'' + actor + '\',\'' + id(3) + '\'); update public.tc_accounting_categories set active=true; update public.tc_accounting_methods set active=true;');
});
after(async () => {
  if (db) {
    try { assert.deepEqual(await legacyState(), legacyBefore, 'Every new-ledger operation must leave the legacy ledger unchanged'); }
    finally { await db.close(); }
  }
});

test('new private ledger coexists with incompatible legacy accounting without changing its schema, money, permissions or triggers', async () => {
  assert.deepEqual(await legacyState(), legacyBefore);
  assert.deepEqual((await snapshot()).entries, []);
  const p = payload('income', 1000);
  await post(p);
  const s = await snapshot();
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].id, p.id);
  assert(!s.entries.some(e => e.id === id(900000)));
  await voidEntry(p.id);
  await option({ kind: 'method', name: 'Independent ledger method' });
  assert.deepEqual(await legacyState(), legacyBefore);
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/accounting-ledger.sql'), 'utf8').replace(/--[^\n]*/g, '');
  assert(!/\b(?:public\.)?accounting_(?:entries|movement_options|receivables|settlements|audit_log)\b/.test(sql), 'new SQL must not even query legacy tables');
});

test('schema starts with real empty ledger, requested categories/methods, and no imported or invented money', async () => {
  const s = await snapshot();
  assert.deepEqual(s.entries, []);
  for (const name of ['PayPal', 'Bizum', 'Transferencia externa']) assert(s.methods.some(x => x.name === name));
  for (const name of ['Centrales', 'Tarotistas', 'Recargas', 'Premium numbers', 'WellDone']) assert(s.categories.some(x => x.name === name && x.kind === 'expense'));
  assert.equal(await scalar('select importe v from public.crm_cliente_pagos where id=1'), '42.15');
});

test('income/expense and one-row transfer persist exactly, with no touching customer payments', async () => {
  const income = payload('income', 12000), expense = payload('expense', 2000), transfer = payload('transfer', 5000);
  for (const v of [income, expense, transfer]) {
    const r = await post(v); assert.equal(r.replayed, false); assert.equal(r.entry.id, v.id); assert.equal(r.entry.created_by, actor);
  }
  const s = await snapshot(); assert.equal(s.entries.length, 3); assert.equal(s.entries.filter(x => x.kind === 'transfer').length, 1);
  assert.equal(s.entries.find(x => x.id === transfer.id).to_account, 'leonaris');
  assert.equal(await scalar('select importe v from public.crm_cliente_pagos where id=1'), '42.15');
});

test('idempotency replays the same normalized payload and refuses changed amount, account, date or actor', async () => {
  const p = payload('income', 12000, { description: '  Compra registrada  ', reference: ' Ref  ' });
  const first = await post(p), normalized = { ...p, description: 'Compra registrada', reference: 'Ref' };
  const replay = await post(normalized); assert.equal(replay.replayed, true); assert.deepEqual(replay.entry, first.entry);
  for (const extra of [{ amount_cents: 12001 }, { account: 'leonaris' }, { occurred_on: '2026-11-11' }, { reference: 'Otra' }]) {
    await assert.rejects(post({ ...normalized, ...extra }), /ACCOUNTING_IDEMPOTENCY_CONFLICT/);
  }
  await assert.rejects(post(normalized, id(3)), /ACCOUNTING_IDEMPOTENCY_CONFLICT/);
  assert.equal(await activeCount(), 1);
});

test('invalid amounts and structured inputs fail before recording any financial movement', async () => {
  for (const amount of [0, -1, 0.5, '100', null, 100000000001, 1e15]) await assert.rejects(post(payload('income', amount)), /ACCOUNTING_INVALID_AMOUNT/);
  for (const extra of [{ kind: 'hack' }, { account: 'unknown' }, { currency: 'COP' }, { occurred_on: '2026-02-30' }, { occurred_on: '1999-01-01' },
    { id: null }, { description: ' ' }, { description: 1234 }, { reference: {} }, { category_id: null }, { method_id: null }]) await assert.rejects(post(payload('income', 100, extra)), /ACCOUNTING_INVALID_/);
  assert.equal(await activeCount(), 0);
});

test('transfers need distinct valid accounts and non-income movements cannot smuggle expense categories or recipients', async () => {
  for (const to of [null, 'celestial', 'other']) await assert.rejects(post(payload('transfer', 100, { to_account: to })), /ACCOUNTING_INVALID_TRANSFER/);
  await assert.rejects(post(payload('income', 100, { to_account: 'leonaris' })), /ACCOUNTING_INVALID_TRANSFER/);
  await assert.rejects(post(payload('transfer', 100, { category_id: expenseCategory })), /ACCOUNTING_INVALID_CATEGORY/);
  await assert.rejects(post(payload('income', 100, { recipient: 'Alex' })), /ACCOUNTING_INVALID_RECIPIENT/);
  await assert.rejects(post(payload('vault_payout', 100)), /ACCOUNTING_INVALID_RECIPIENT/);
});

test('future-dated income and opening balances cannot be represented as available cash', async () => {
  for (const kind of ['income', 'expense', 'opening_balance', 'transfer']) {
    await assert.rejects(post(payload(kind, 100, { occurred_on: '2099-12-31' })), /ACCOUNTING_FUTURE_DATE/);
  }
  assert.equal(await activeCount(), 0);
});

test('vault deposits need funds in that account/currency today and on the supplied historical date', async () => {
  await assert.rejects(post(payload('vault_deposit', 100)), /ACCOUNTING_INSUFFICIENT_AVAILABLE/);
  await post(payload('income', 20000));
  await assert.rejects(post(payload('vault_deposit', 100, { occurred_on: '2026-11-11' })), /ACCOUNTING_INSUFFICIENT_AVAILABLE/);
  await assert.rejects(post(payload('vault_deposit', 100, { account: 'leonaris' })), /ACCOUNTING_INSUFFICIENT_AVAILABLE/);
  await assert.rejects(post(payload('vault_deposit', 100, { currency: 'USD' })), /ACCOUNTING_INSUFFICIENT_AVAILABLE/);
  await post(payload('vault_deposit', 15000));
  await assert.rejects(post(payload('vault_deposit', 5001)), /ACCOUNTING_INSUFFICIENT_AVAILABLE/);
  assert.equal(await activeCount(), 2);
});

test('withdrawal/payout are atomic, recipient is explicit, and combined vault cannot overdraw', async () => {
  await post(payload('income', 20000)); await post(payload('vault_deposit', 15000));
  await post(payload('vault_withdrawal', 4000)); const r = await post(payload('vault_payout', 6000, { recipient: 'Ricky' }));
  assert.equal(r.entry.recipient, 'Ricky');
  const count = await activeCount();
  await assert.rejects(post(payload('vault_payout', 5001, { recipient: 'Alex' })), /ACCOUNTING_INSUFFICIENT_VAULT/);
  assert.equal(await activeCount(), count);
  await post(payload('vault_payout', 5000, { recipient: 'Alex' }));
  await assert.rejects(post(payload('vault_withdrawal', 1)), /ACCOUNTING_INSUFFICIENT_VAULT/);
});

test('positive final vault total cannot hide a backdated negative vault balance', async () => {
  await post(payload('income', 20000, { occurred_on: '2026-11-01' }));
  await post(payload('vault_deposit', 15000, { occurred_on: '2026-11-10' }));
  await assert.rejects(post(payload('vault_withdrawal', 1000, { occurred_on: '2026-11-09' })), /ACCOUNTING_INSUFFICIENT_VAULT/);
  assert.equal(await activeCount(), 2);
});

test('voiding a used vault deposit rolls back both void and history; voiding dependent withdrawals first works', async () => {
  await post(payload('income', 20000));
  const deposit = await post(payload('vault_deposit', 10000));
  const withdrawal = await post(payload('vault_withdrawal', 3000));
  await assert.rejects(voidEntry(deposit.entry.id), /ACCOUNTING_INSUFFICIENT_VAULT/);
  assert.equal((await snapshot()).entries.find(x => x.id === deposit.entry.id).voided_at, null);
  await voidEntry(withdrawal.entry.id);
  const result = await voidEntry(deposit.entry.id, 'Reasignación revisada');
  assert.equal(result.entry.void_reason, 'Reasignación revisada'); assert.equal(result.entry.voided_by, actor); assert(result.entry.voided_at);
  assert.equal((await snapshot()).entries.length, 3); assert.equal(await activeCount(), 1);
  const replay = await voidEntry(deposit.entry.id, 'No sobrescribe motivo original'); assert.equal(replay.replayed, true); assert.deepEqual(replay.entry, result.entry);
});

test('void preserves immutable original payload and identity for complete audit, never deletes', async () => {
  const p = payload('expense', 1000), result = await post(p);
  await assert.rejects(voidEntry(p.id, '  '), /ACCOUNTING_INVALID_VOID/);
  await assert.rejects(voidEntry(id(99999)), /ACCOUNTING_ENTRY_NOT_FOUND/);
  const voided = await voidEntry(p.id);
  assert.equal(voided.entry.amount_cents, result.entry.amount_cents); assert.equal(voided.entry.created_at, result.entry.created_at); assert.equal(voided.entry.created_by, result.entry.created_by);
  await assert.rejects(db.query('update public.tc_accounting_ledger_entries set amount_cents=50 where id=$1', [p.id]), /ACCOUNTING_IMMUTABLE_ENTRY/);
  await assert.rejects(db.query('delete from public.tc_accounting_ledger_entries where id=$1', [p.id]), /ACCOUNTING_IMMUTABLE_ENTRY/);
});

test('expense can capture incomplete historical bookkeeping, but a vault allocation cannot use deficit money', async () => {
  await post(payload('expense', 1000));
  await assert.rejects(post(payload('vault_deposit', 1)), /ACCOUNTING_INSUFFICIENT_AVAILABLE/);
  assert.equal(await activeCount(), 1);
});

test('opening balance is unique per account/currency and must not start after existing movements', async () => {
  const opening = await post(payload('opening_balance', 10000, { occurred_on: '2026-11-01' }));
  await assert.rejects(post(payload('opening_balance', 1000)), /ACCOUNTING_OPENING_EXISTS/);
  await post(payload('opening_balance', 2000, { account: 'leonaris', occurred_on: '2026-11-01' }));
  await post(payload('opening_balance', 3000, { currency: 'USD', occurred_on: '2026-11-01' }));
  await voidEntry(opening.entry.id); await post(payload('income', 5000, { occurred_on: '2026-11-05' }));
  await assert.rejects(post(payload('opening_balance', 1000, { occurred_on: '2026-11-06' })), /ACCOUNTING_OPENING_DATE/);
  await post(payload('opening_balance', 1000, { occurred_on: '2026-11-01' }));
});

test('categories/methods are customizable with preserved IDs, archive instead of delete, and audit records', async () => {
  const added = await option({ kind: 'expense', name: '  Oficina  ' });
  assert.equal(added.option.name, 'Oficina'); assert.equal(added.option.active, true);
  const replay = await option({ kind: 'expense', name: 'oficina' }); assert.equal(replay.option.id, added.option.id); assert.equal(replay.replayed, true);
  const changed = await option({ id: added.option.id, kind: 'expense', name: 'Alquiler oficina', active: false });
  assert.equal(changed.option.id, added.option.id); assert.equal(changed.option.active, false);
  await assert.rejects(option({ id: added.option.id, kind: 'income', name: 'Cambio incompatible' }), /ACCOUNTING_OPTION_NOT_FOUND/);
  const bank = await option({ kind: 'method', name: 'Transferencia interna' });
  await option({ id: bank.option.id, kind: 'method', name: 'Banco empresa', active: false });
  await assert.rejects(option({ kind: 'method', name: 'Banco empresa', active: true }), /ACCOUNTING_OPTION_EXISTS/);
  assert.equal(await scalar('select count(*)::int v from public.tc_accounting_option_audit'), 4);
});

test('new movements reject inactive or wrong-kind categories/methods; existing entry retries still work after archive', async () => {
  await assert.rejects(post(payload('income', 100, { category_id: expenseCategory })), /ACCOUNTING_INVALID_CATEGORY/);
  const p = payload('income', 100); const original = await post(p);
  await option({ id: incomeCategory, kind: 'income', name: 'Venta de minutos', active: false });
  await assert.rejects(post(payload('income', 100)), /ACCOUNTING_INVALID_CATEGORY/);
  assert.equal((await post(p)).entry.id, original.entry.id);
  await option({ id: method, kind: 'method', name: 'PayPal', active: false });
  await assert.rejects(post(payload('expense', 100)), /ACCOUNTING_INVALID_METHOD/);
});

test('fresh authorization applies to reads, writes, voids, options and replay, including revoked admins', async () => {
  const p = payload('income', 100); await post(p);
  await db.query('update public.test_admins set active=false where id=$1', [actor]);
  for (const run of [() => snapshot(), () => post(p), () => voidEntry(p.id), () => option({ kind: 'expense', name: 'Bloqueado' })]) await assert.rejects(run(), /ACCOUNTING_FORBIDDEN/);
  await assert.rejects(snapshot(id(2)), /ACCOUNTING_FORBIDDEN/); await assert.rejects(snapshot(null), /ACCOUNTING_FORBIDDEN/);
  assert.equal(await activeCount(), 1);
});

test('all tables have RLS; anon/authenticated cannot read or invoke; functions remain SECURITY INVOKER', async () => {
  for (const table of ['tc_accounting_ledger_entries', 'tc_accounting_categories', 'tc_accounting_methods', 'tc_accounting_option_audit']) {
    const security = await scalar(`select jsonb_build_object('rls',c.relrowsecurity,'anon',has_table_privilege('anon',c.oid,'SELECT'),'auth',has_table_privilege('authenticated',c.oid,'SELECT'),'service_delete',has_table_privilege('service_role',c.oid,'DELETE')) v from pg_class c where c.oid=$1::regclass`, [`public.${table}`]);
    assert.deepEqual(security, { rls: true, anon: false, auth: false, service_delete: false });
  }
  const functions = (await db.query("select proname,prosecdef,has_function_privilege('anon',oid,'EXECUTE') a,has_function_privilege('authenticated',oid,'EXECUTE') u,has_function_privilege('service_role',oid,'EXECUTE') s from pg_proc where proname like 'accounting_%' or proname like 'tc_accounting_%'")).rows;
  for (const f of functions) { assert.equal(f.prosecdef, false, f.proname); assert.equal(f.a, false, f.proname); assert.equal(f.u, false, f.proname); assert.equal(f.s, true, f.proname); }
  await db.exec('set role authenticated');
  try { await assert.rejects(snapshot(), /permission denied/); await assert.rejects(db.query('select * from public.tc_accounting_ledger_entries'), /permission denied/); }
  finally { await db.exec('reset role'); }
});

test('service role can post/read/void but cannot rewrite amounts or delete the ledger', async () => {
  await db.exec('set role service_role');
  try {
    const p = payload('income', 100), result = await post(p); assert.equal((await snapshot()).entries.length, 1);
    await assert.rejects(db.query('update public.tc_accounting_ledger_entries set amount_cents=10 where id=$1', [p.id]), /permission denied/);
    await assert.rejects(db.query('delete from public.tc_accounting_ledger_entries where id=$1', [p.id]), /permission denied/);
    assert.equal((await voidEntry(result.entry.id)).entry.voided_by, actor);
  } finally { await db.exec('reset role'); }
});

test('concurrent retries are serialized and independent credits accumulate instead of overwriting balances', async () => {
  const p = payload('income', 1000);
  const results = await Promise.all([post(p), post(p), post(payload('income', 500))]);
  assert.equal(results.filter(x => x.replayed).length, 1); assert.equal(await activeCount(), 2);
  assert.equal(await scalar('select sum(amount_cents)::int v from public.tc_accounting_ledger_entries where voided_at is null'), 1500);
  // PGlite uses one connection. Production concurrency is guarded by the same
  // transaction-scoped advisory lock in post, void and option RPCs.
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/accounting-ledger.sql'), 'utf8');
  assert.equal((sql.match(/pg_advisory_xact_lock\(hashtextextended\('tc-accounting-ledger-v1',0\)\)/g) || []).length, 3);
});
