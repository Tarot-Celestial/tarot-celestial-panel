const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/accounting.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const accounting = {};
vm.runInNewContext(code, { exports: accounting, Date, Math, Intl, Number, Object, String, Error });
const plain = value => JSON.parse(JSON.stringify(value));
const id = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function entry(n, kind, amount, rest = {}) {
  return { id: id(n), kind, account: 'celestial', to_account: null, currency: 'EUR', amount_cents: amount,
    occurred_on: '2026-11-12', category_id: null, method_id: null, description: 'Movimiento de prueba', reference: '',
    recipient: null, created_at: `2026-11-12T12:00:${String(n).padStart(2, '0')}.000Z`, created_by: id(999),
    voided_at: null, void_reason: null, voided_by: null, ...rest };
}
const eur = { currency: 'EUR', account: 'all' };

test('amount parsing uses exact cents, accepts Spanish decimal comma, and rejects ambiguous/unsafe inputs', () => {
  for (const [input, cents] of [['0.01', 1], ['12,34', 1234], [' 45.5 ', 4550], [100, 10000], ['1000000000', 100000000000]]) assert.equal(accounting.parseAmountToCents(input), cents);
  for (const input of ['', '0', '-1', '1.234', '1,234.56', '1e3', 'NaN', 'Infinity', '1000000000.01', '1.', '.50', '   ']) assert.throws(() => accounting.parseAmountToCents(input), Error);
});

test('entry validation rejects forged semantics and normalizes only safe fields', () => {
  const raw = entry(1, 'income', 100, { category_id: id(10), method_id: id(20), description: '  Pago consulta  ', reference: ' Ref. 123 ' });
  const clean = accounting.validateEntryInput({ ...raw, created_by: id(2), unexpected: 'cannot forward to RPC' });
  assert.equal(clean.description, 'Pago consulta'); assert.equal(clean.reference, 'Ref. 123'); assert.equal(clean.created_by, undefined); assert.equal(clean.unexpected, undefined);
  for (const mutation of [ { amount_cents: 1.5 }, { amount_cents: '100' }, { amount_cents: 0 }, { currency: 'COP' }, { account: 'other' },
    { occurred_on: '2026-02-30' }, { occurred_on: '2024-2-03' }, { occurred_on: '1999-12-31' }, { kind: 'toString' }, { description: 123 },
    { reference: 123 }, { method_id: null }, { category_id: null }, { recipient: 'Alex' }, { to_account: 'leonaris' }, { id: 'invalid' }]) {
    assert.throws(() => accounting.validateEntryInput({ ...raw, ...mutation }));
  }
  assert.equal(accounting.isAccountingDate('2024-02-29'), true);
  assert.equal(accounting.isAccountingDate('2026-02-29'), false);
});

test('transfer and vault payout validation require distinct accounts or an explicit recipient', () => {
  const transfer = entry(2, 'transfer', 100, { to_account: 'leonaris' });
  assert.equal(accounting.validateEntryInput(transfer).to_account, 'leonaris');
  assert.throws(() => accounting.validateEntryInput({ ...transfer, to_account: 'celestial' }));
  assert.throws(() => accounting.validateEntryInput({ ...transfer, category_id: id(10) }));
  assert.equal(accounting.validateEntryInput(entry(3, 'vault_payout', 100, { recipient: 'Ricky' })).recipient, 'Ricky');
  assert.throws(() => accounting.validateEntryInput(entry(3, 'vault_payout', 100)));
});

test('custom options have typed kinds, trimmed names and explicit boolean states', () => {
  assert.deepEqual(plain(accounting.validateOptionInput({ kind: 'expense', name: '  Alquiler  ' })), { kind: 'expense', name: 'Alquiler', active: true });
  assert.equal(accounting.validateOptionInput({ id: id(1), kind: 'method', name: 'Tarjeta', active: false }).active, false);
  for (const v of [null, [], {}, { kind: 'gift', name: 'Algo' }, { kind: 'income', name: 'x' }, { kind: 'method', name: 'Banco', active: 'false' }]) assert.throws(() => accounting.validateOptionInput(v));
});

test('consolidated transfers cancel; each account sees its own side without changing P&L', () => {
  const rows = [entry(1, 'income', 10000), entry(2, 'expense', 2500), entry(3, 'transfer', 3000, { to_account: 'leonaris' })];
  const all = accounting.summarize(rows, eur);
  assert.equal(all.income_cents, 10000); assert.equal(all.expense_cents, 2500); assert.equal(all.net_cents, 7500); assert.equal(all.available_cents, 7500);
  assert.equal(all.accounts.celestial.available_cents, 4500); assert.equal(all.accounts.leonaris.available_cents, 3000);
  assert.equal(accounting.summarize(rows, { ...eur, account: 'leonaris' }).net_cents, 0);
  assert.equal(accounting.filterEntries(rows, { ...eur, account: 'leonaris' }).length, 1);
});

test('vault allocations and withdrawals do not inflate profits; payouts reduce assets not operating expenses', () => {
  const rows = [entry(1, 'opening_balance', 50000), entry(2, 'income', 10000), entry(3, 'expense', 2500),
    entry(4, 'vault_deposit', 20000), entry(5, 'vault_withdrawal', 3000), entry(6, 'vault_payout', 5000, { recipient: 'Alex' })];
  const s = accounting.summarize(rows, eur);
  assert.equal(s.net_cents, 7500); assert.equal(s.income_cents, 10000); assert.equal(s.expense_cents, 2500);
  assert.equal(s.available_cents, 40500); assert.equal(s.vault_cents, 12000); assert.equal(s.total_cents, 52500);
});

test('currencies never mix and voids remain audit-only even when visible in table', () => {
  const rows = [entry(1, 'income', 10000), entry(2, 'income', 60000, { currency: 'USD' }),
    entry(3, 'expense', 9999, { voided_at: '2026-11-12T13:00:00.000Z' })];
  assert.equal(accounting.summarize(rows, eur).available_cents, 10000);
  assert.equal(accounting.summarize(rows, { currency: 'USD' }).available_cents, 60000);
  assert.equal(accounting.filterEntries(rows, eur).length, 1);
  assert.equal(accounting.filterEntries(rows, { ...eur, includeVoided: true }).length, 2);
  assert.equal(accounting.buildCandles(rows, eur).at(-1).close, 10000);
});

test('period KPIs are distinct from all-history cash balances', () => {
  const rows = [entry(1, 'income', 10000, { occurred_on: '2026-10-31' }), entry(2, 'expense', 3000)];
  const s = accounting.summarize(rows, { ...eur, dateFrom: '2026-11-01', dateTo: '2026-11-30' });
  assert.equal(s.income_cents, 0); assert.equal(s.expense_cents, 3000); assert.equal(s.net_cents, -3000); assert.equal(s.available_cents, 7000);
});

test('OHLC measures actual within-day high/low and carries pre-period opening balance', () => {
  const rows = [entry(1, 'income', 10000, { occurred_on: '2026-10-31' }), entry(2, 'income', 5000), entry(3, 'expense', 9000), entry(4, 'income', 2000),
    entry(5, 'expense', 100, { occurred_on: '2026-11-13' })];
  const candles = accounting.buildCandles(rows, { ...eur, dateFrom: '2026-11-01', dateTo: '2026-11-12' });
  assert.deepEqual(plain(candles), [{ date: '2026-11-12', open: 10000, high: 15000, low: 6000, close: 8000, volume_cents: 16000 }]);
});

test('same-day ordering is deterministic despite network order; transfers use correct account in candles', () => {
  const rows = [entry(1, 'income', 10000), entry(2, 'transfer', 3000, { to_account: 'leonaris' }), entry(3, 'expense', 1000, { account: 'leonaris' })];
  assert.deepEqual(plain(accounting.buildCandles([...rows].reverse(), eur)), plain(accounting.buildCandles(rows, eur)));
  assert.equal(accounting.buildCandles(rows, { ...eur, account: 'leonaris' })[0].close, 2000);
  assert.equal(accounting.buildCandles(rows, eur)[0].close, 9000);
});

test('same-day opening balances establish OHLC baseline even when recorded after operating movements', () => {
  const rows = [entry(1, 'expense', 10000), entry(2, 'opening_balance', 100000),
    entry(3, 'opening_balance', 50000, { account: 'leonaris' })];
  const candles = accounting.buildCandles(rows, eur);
  assert.deepEqual(plain(candles), [{ date: '2026-11-12', open: 150000, high: 150000, low: 140000, close: 140000, volume_cents: 10000 }]);
  assert.deepEqual(plain(accounting.buildCandles([rows[1]], eur)), [{ date: '2026-11-12', open: 100000, high: 100000, low: 100000, close: 100000, volume_cents: 0 }]);
  assert.equal(accounting.summarize(rows, eur).net_cents, -10000);
});

test('Madrid business date handles UTC midnight boundaries and future cash cannot inflate available balances', () => {
  assert.equal(accounting.accountingToday(new Date('2026-11-11T23:30:00Z')), '2026-11-12');
  assert.equal(accounting.accountingToday(new Date('2026-07-11T22:30:00Z')), '2026-07-12');
  const future = entry(1, 'income', 10000, { occurred_on: '2099-12-31', category_id: id(10), method_id: id(20) });
  assert.throws(() => accounting.validateEntryInput(future), /futuros/);
  assert.equal(accounting.summarize([future], eur).available_cents, 0);
  assert.deepEqual(plain(accounting.buildCandles([future], eur)), []);
});

test('all movement table filters apply together, including incoming transfers, text, method and period', () => {
  const rows = [entry(1, 'income', 1000, { category_id: id(10), method_id: id(20), description: 'Cobro por Bizum', reference: 'Alex-123' }),
    entry(2, 'expense', 800), entry(3, 'income', 500, { occurred_on: '2026-10-31' })];
  const filtered = accounting.filterEntries(rows, { ...eur, dateFrom: '2026-11-01', dateTo: '2026-11-30', kind: 'income', categoryId: id(10), methodId: id(20), search: 'BIZUM' });
  assert.deepEqual(plain(filtered.map(x => x.id)), [id(1)]);
  assert.equal(accounting.filterEntries(rows, { ...eur, search: 'Alex-123' }).length, 1);
});

test('empty ledger is truly zero and accounting overflow fails loudly instead of rounding', () => {
  assert.equal(accounting.summarize([], eur).total_cents, 0); assert.deepEqual(plain(accounting.buildCandles([], eur)), []);
  assert.throws(() => accounting.summarize([entry(1, 'income', Number.MAX_SAFE_INTEGER), entry(2, 'income', 1)], eur), /límite seguro/);
});
