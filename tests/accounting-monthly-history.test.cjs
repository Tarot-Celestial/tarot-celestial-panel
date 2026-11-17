const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const { renderToString } = require('react-dom/server');

const cache = new Map();
function load(sourcePath) {
  const file = path.resolve(__dirname, '..', sourcePath);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (name.endsWith('.module.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.resolve(__dirname, '../src', name.slice(2)) : path.resolve(path.dirname(file), name);
      const resolved = ['', '.ts', '.tsx'].map(ext => base + ext).find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!resolved) throw new Error(`Missing source ${name}`);
      return load(resolved);
    }
    return require(name);
  };
  vm.runInNewContext(code, { exports, require: localRequire, Date, Math, Intl, Number, Object, String, Error, Map, Set, JSON, Array, Promise, RegExp, console }, { filename: file });
  return exports;
}

const model = load('src/features/accounting/monthly-model.ts');
const { default: Statistics, MonthlyLineChart } = load('src/features/accounting/MonthlyStatistics.tsx');
const today = '2026-11-17';
const filters = model.EMPTY_MONTHLY_FILTERS;
const row = (id, kind, date, extra = {}) => ({
  id, kind, account: 'celestial', to_account: null, currency: 'EUR', amount_cents: 100,
  occurred_on: date, category_id: 'consultas', method_id: 'paypal', description: 'Movimiento de prueba',
  reference: '', recipient: null, created_at: `${date}T12:00:00Z`, created_by: 'test',
  voided_at: null, void_reason: null, voided_by: null, ...extra,
});
const months = (entries, selection = filters, metric = 'income', currency = 'EUR') =>
  Array.from(model.historyMonthsForMetric(entries, '2026-11', currency, selection, metric, today));

test('a business, method, category or metric without history has no chart points', () => {
  const entries = [row('income', 'income', '2026-09-01')];
  assert.deepEqual(months(entries, { ...filters, account: 'leonaris' }), []);
  assert.deepEqual(months(entries, { ...filters, methodId: 'square' }), []);
  assert.deepEqual(months(entries, { ...filters, categoryId: 'other' }), []);
  assert.deepEqual(months(entries, filters, 'expense'), []);
  assert.deepEqual(months(entries, filters, 'vault'), []);
  assert.deepEqual(months(entries, filters, 'income', 'USD'), []);
});

test('an established series keeps intermediate zero months and excludes unrelated earlier months', () => {
  const entries = [row('other', 'income', '2026-07-01', { account: 'leonaris' }), row('sep', 'income', '2026-09-01'), row('nov', 'income', '2026-11-01', { amount_cents: 300 })];
  const selection = { ...filters, account: 'celestial' };
  const dates = months(entries, selection);
  assert.deepEqual(dates, ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(dates.map(month => model.filteredTotals(model.monthlyRows(entries, month, 'EUR', selection, today)).income), [100, 0, 300]);
});

test('stock history ignores flow filters and includes the destination side of transfers', () => {
  const entries = [row('opening', 'opening_balance', '2026-08-01'), row('transfer', 'transfer', '2026-09-01', { to_account: 'leonaris' }), row('vault', 'vault_deposit', '2026-10-01')];
  const selection = { ...filters, methodId: 'unmatched', categoryId: 'unmatched' };
  assert.deepEqual(months(entries, selection, 'available'), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(months(entries, selection, 'vault'), ['2026-10', '2026-11']);
  assert.deepEqual(months(entries, { ...selection, account: 'leonaris' }, 'available'), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(months(entries, { ...selection, account: 'leonaris' }, 'income'), []);
});

test('voided and future entries do not fabricate history; older history retains twelve quiet months', () => {
  assert.deepEqual(months([row('void', 'income', '2026-09-01', { voided_at: '2026-09-02T00:00:00Z' }), row('future', 'income', '2026-11-18')]), []);
  const dates = months([row('old', 'income', '2024-01-01')]);
  assert.equal(dates.length, 12);
  assert.equal(dates[0], '2025-12');
  assert.equal(dates[11], '2026-11');
});

test('changing the statistics business removes both unrelated income graphs', async () => {
  let tree;
  const snapshot = { entries: [row('income', 'income', '2026-09-01')], categories: [], methods: [] };
  await renderer.act(async () => { tree = renderer.create(React.createElement(Statistics, { snapshot, month: '2026-11', currency: 'EUR', refreshing: false })); });
  assert.equal(tree.root.findAllByType('svg').filter(svg => svg.props.role === 'img').length, 2);
  await renderer.act(async () => { tree.root.findAllByType('select')[0].props.onChange({ target: { value: 'leonaris' } }); });
  assert.equal(tree.root.findAllByType('svg').filter(svg => svg.props.role === 'img').length, 0);
  assert.equal(tree.root.findAllByType('span').filter(span => span.children.join('') === 'Sin histórico disponible').length, 2);
  await renderer.act(async () => { tree.unmount(); });
});

test('SVG point titles render one text node without hydration comment separators', () => {
  const html = renderToString(React.createElement(MonthlyLineChart, { points: [{ label: 'oct', value: 100 }], currency: 'EUR', title: 'Histórico' }));
  const pointTitle = html.match(/<circle[^>]*><title>([\s\S]*?)<\/title>/)?.[1];
  assert.ok(pointTitle);
  assert.ok(pointTitle.startsWith('oct: '));
  assert.ok(!pointTitle.includes('<!--'));
});
