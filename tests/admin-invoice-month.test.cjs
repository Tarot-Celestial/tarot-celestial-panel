// Execute the real selector, storage effects and handlers with isolated state.
// No invoice generation, authentication or database calls leave this fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/app/admin/page.tsx'), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all = [];
(function visit(node) { all.push(node); ts.forEachChild(node, visit); })(ast);
const functions = ['changeInvoiceMonth', 'generateInvoices', 'listInvoices', 'loadAdminStats'];
const handlers = functions.map(name => all.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)).join('\n');
const input = all.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'input' && node.getText(ast).includes('Mes de facturación')).getText(ast);
const effect = method => all.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes(`localStorage.${method}("tc_month_admin"`)).arguments[0].getText(ast);
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const normalizer = {};
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/lib/month-key.ts'), 'utf8')), { exports: normalizer });

function fixture({ month = '2026-10', saved = null, hold = false } = {}) {
  const requests = [], storage = new Map(saved === null ? [] : [['tc_month_admin', saved]]);
  const state = {
    month, monthError: '', genLoading: false, genMsg: '', listLoading: false, listMsg: '', invoices: [],
    statsFetchInFlightRef: { current: false }, statsRefreshQueuedRef: { current: false }, statsSelectedMonthRef: { current: month }, statsViewActiveRef: { current: false }, invoiceListRequestRef: { current: 0 },
  };
  const context = {
    ...state, exports: {}, normalizeMonthKey: normalizer.normalizeMonthKey, Date, console, encodeURIComponent,
    window: { setTimeout() {} },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    getTokenOrLogin: async () => 'fixture-token', getActiveBrand: () => 'celestial',
    safeJson: async response => ({ ...(await response.json()), _ok: response.ok, _status: response.status }),
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      throw new Error(`Unexpected import ${name}`);
    },
    fetch: async (url, options) => {
      const request = { url, options }; requests.push(request);
      if (hold) return new Promise(resolve => { request.resolve = payload => resolve({ ok: true, status: 200, json: async () => payload }); });
      return { ok: true, status: 200, json: async () => ({ ok: true, invoices: [] }) };
    },
  };
  for (const name of ['month', 'monthError', 'genLoading', 'genMsg', 'listLoading', 'listMsg', 'invoices', 'tab', 'statsLoading', 'statsMsg', 'statsLiveStatus', 'statsTotals', 'statsRows', 'statsPreviousTotals', 'statsPreviousRows', 'statsPreviousInvoiceSummary', 'statsComparisonPeriod', 'statsTop', 'statsTeams']) {
    context[`set${name[0].toUpperCase()}${name.slice(1)}`] = value => {
      context[name] = value;
      if (name === 'month') context.statsSelectedMonthRef.current = value;
    };
  }
  vm.runInNewContext(compile(`${handlers}\nexports.handlers = { ${functions.join(',')} }; exports.input = () => (${input}); exports.restore = ${effect('getItem')}; exports.persist = ${effect('setItem')};`), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { state: context, requests, storage, ...context.exports, settle, change(value) { context.exports.input().props.onChange({ target: { value } }); } };
}

test('the native month selector and legacy storage produce a canonical September key', async () => {
  const f = fixture({ saved: '2026-9' }); f.restore(); f.persist();
  assert.equal(f.state.month, '2026-09'); assert.equal(f.storage.get('tc_month_admin'), '2026-09');
  const input = f.input().props;
  assert.equal(input.type, 'month'); assert.equal(input.required, true); assert.equal(input['aria-label'], 'Mes de facturación');
  await f.handlers.generateInvoices();
  assert.equal(JSON.parse(f.requests[0].options.body).month, input.value);
  assert.match(f.requests[1].url, /month=2026-09&/);
});

test('invalid saved months retain the visible current selection and explain the restoration', () => {
  for (const saved of ['2026-13', '2026-00', 'garbage', '   ']) {
    const f = fixture({ saved }); f.restore(); f.persist();
    assert.equal(f.input().props.value, '2026-10'); assert.match(f.state.monthError, /Se mantiene 2026-10/);
    assert.equal(f.storage.get('tc_month_admin'), '2026-10');
  }
});

test('clearing or entering an invalid month cannot generate invoices for a different invisible month', async () => {
  const f = fixture(); f.change('2026-9'); assert.equal(f.input().props.value, '2026-09');
  for (const value of ['', '2026-00', '2026-13', '2026-']) {
    f.change(value); assert.equal(f.input().props.value, '2026-09'); assert.match(f.state.monthError, /Se mantiene 2026-09/);
  }
  await f.handlers.generateInvoices();
  assert.equal(JSON.parse(f.requests[0].options.body).month, f.input().props.value);
  f.change('2026-10'); assert.equal(f.state.monthError, '');
});

test('generation, listing and statistics reject corrupted empty state before any request', async () => {
  for (const month of ['', '2026-13', 'bad']) {
    const f = fixture({ month });
    await f.handlers.generateInvoices(); await f.handlers.listInvoices(); await f.handlers.loadAdminStats();
    assert.equal(f.requests.length, 0);
    for (const message of [f.state.genMsg, f.state.listMsg, f.state.statsMsg]) assert.match(message, /Selecciona un mes válido/);
    assert.equal(f.state.genLoading, false); assert.equal(f.state.listLoading, false); assert.equal(f.state.statsFetchInFlightRef.current, false);
  }
});

test('the month remains locked while invoice generation is in progress', async () => {
  const f = fixture({ month: '2026-09', hold: true });
  const pending = f.handlers.generateInvoices(); await f.settle();
  assert.equal(f.input().props.disabled, true); f.change('2026-10'); assert.equal(f.state.month, '2026-09');
  f.requests[0].resolve({ ok: true, created: 1 }); await f.settle();
  f.requests[1].resolve({ ok: true, invoices: [] }); await pending;
  assert.equal(f.input().props.disabled, false);
});

test('late invoice rows from a previous month cannot replace the currently selected month', async () => {
  const f = fixture({ month: '2026-09', hold: true });
  const previous = f.handlers.listInvoices(); await f.settle();
  f.change('2026-10'); const current = f.handlers.listInvoices(); await f.settle();
  f.requests[0].resolve({ ok: true, invoices: [{ invoice_id: 'september' }] }); await previous;
  assert.equal(f.state.invoices.length, 0); assert.equal(f.state.listLoading, true);
  f.requests[1].resolve({ ok: true, invoices: [{ invoice_id: 'october' }] }); await current;
  assert.equal(f.state.invoices[0].invoice_id, 'october'); assert.equal(f.state.listLoading, false);
});

test('a newer silent refresh owns the final list and releases loading after overlapping requests', async () => {
  const f = fixture({ hold: true }); const previous = f.handlers.listInvoices(); await f.settle();
  const current = f.handlers.listInvoices(true); await f.settle();
  f.requests[1].resolve({ ok: true, invoices: [{ invoice_id: 'fresh' }] }); await current;
  f.requests[0].resolve({ ok: true, invoices: [{ invoice_id: 'stale' }] }); await previous;
  assert.equal(f.state.invoices[0].invoice_id, 'fresh'); assert.equal(f.state.listLoading, false);
});
