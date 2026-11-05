const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: name => { if (name in deps) return deps[name]; throw Error(name); } });
  return exports;
}
const pure = load('src/lib/purchase-benefit-summary.ts');
const server = load('src/lib/server/purchase-benefit-summary.ts', { '@/lib/purchase-benefit-summary': pure });
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const payment = { id: id(1), source_rendimiento_id: id(2), benefits_processed_at: '2026-11-05T14:00:00Z', benefits_context: { purchase_classification: 'nada', coins: 9999 } };
const processed = { benefit_key: 'purchase_processed' };
const earned = { id: id(4), tipo: 'ganado', puntos: 300, saldo_despues: 930, created_at: '2026-11-05T14:00:00', meta: { payment_id: id(1) } };
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const plain = value => JSON.parse(JSON.stringify(value));

test('normal Diamond receipt shows actual credited Coins and its earned wheel, ignoring quoted Coins and current balance', () => {
  const result = pure.summarizePurchaseBenefits(payment, { ledger: [earned], events: [processed, { coins: 300 }], spins: [{ nivel: 2, estado: 'used' }] });
  assert.equal(result.coins, 300);
  assert.equal(result.coins_balance_after, 930);
  assert.equal(result.coins_status, 'confirmed');
  assert.deepEqual(plain(result.spins), [{ level: 2, count: 1 }]);
  assert.match(pure.purchaseBenefitText(result), /\+300 Coins.*1 giro.*Ruleta nivel 2/);
});

test('Promo zero, Special wheel, and Diamond replacement remain distinct with no invented grants', () => {
  const promo = pure.summarizePurchaseBenefits({ ...payment, benefits_context: { purchase_classification: 'promo' } }, { ledger: [], events: [processed], spins: [] });
  assert.equal(pure.purchaseBenefitText(promo), '0 Coins · 0 giros');
  assert.equal(pure.purchaseClassificationLabel(promo.classification), 'Promo');
  const special = pure.summarizePurchaseBenefits({ ...payment, benefits_context: { purchase_classification: 'super_promo_ruleta' } }, { ledger: [], events: [processed], spins: [{ nivel: 4, estado: 'expired' }] });
  assert.equal(pure.purchaseBenefitText(special), '0 Coins · 1 giro · Ruleta Especial');
  const diamond = pure.summarizePurchaseBenefits({ ...payment, benefits_context: { purchase_classification: 'ruleta_diamante' } }, { ledger: [earned], events: [processed], spins: [{ nivel: 5, estado: 'pending' }, { nivel: 2, estado: 'revoked' }] });
  assert.equal(pure.purchaseBenefitText(diamond), '+300 Coins · 1 giro · Ruleta Diamante · 1 giro(s) retirado(s)');
});

test('missing ledger, unprocessed purchase and failed reads are not represented as zero Coins', () => {
  for (const evidence of [
    { ledger: [], events: [processed, { coins: 300 }], spins: [] },
    { ledger: null, events: [processed, { coins: 300 }], spins: null },
    { ledger: [], events: null, spins: [] },
  ]) {
    const result = pure.summarizePurchaseBenefits(payment, evidence);
    assert.equal(result.coins, null);
    assert.match(pure.purchaseBenefitText(result), /Coins pendientes de comprobar/);
  }
  const unprocessed = pure.summarizePurchaseBenefits({ id: id(1), source_rendimiento_id: id(2) }, { ledger: [], events: [], spins: [] });
  assert.equal(unprocessed.coins, null);
  assert.equal(unprocessed.spins, null);
  const collection = pure.summarizePurchaseBenefits({ id: id(1), benefits_processed_at: payment.benefits_processed_at }, { ledger: [], events: [], spins: [] });
  assert.equal(collection.is_purchase, false, 'a processed receipt alone does not prove a registered purchase');
});

function database({ fail, rows = {} } = {}) {
  const calls = [];
  const db = { from(table) {
    const filters = [], read = { table, filters, from: 0, to: 499 };
    calls.push(read);
    const value = (row, key) => key === 'meta->>payment_id' ? row.meta?.payment_id : row[key];
    const q = {
      select: () => q, order: () => q,
      eq: (key, expected) => { filters.push({ key, values: [expected] }); return q; },
      in: (key, values) => { filters.push({ key, values }); return q; },
      range: (from, to) => { read.from = from; read.to = to; return q; },
      then: (resolve, reject) => Promise.resolve({ error: fail === table ? { message: 'temporary failure' } : null,
        data: (rows[table] || []).filter(row => filters.every(filter => filter.values.includes(value(row, filter.key)))).slice(read.from, read.to + 1) }).then(resolve, reject),
    };
    return q;
  } };
  return { db, calls };
}

test('server summary scopes every source to client and payment; pagination does not omit earned movements', async () => {
  const h = database({ rows: {
    cliente_puntos_historial: Array.from({ length: 501 }, (_, n) => ({ ...earned, id: id(n + 10), puntos: 1, cliente_id: id(3) })),
    tc_client_benefit_events: [{ ...processed, id: id(6), payment_id: id(1), cliente_id: id(3) }],
    cliente_ruleta_giros: [{ id: id(7), nivel: 2, estado: 'used', purchase_id: id(1), cliente_id: id(3) }],
  } });
  const result = await server.loadPurchaseBenefitSummaries(h.db, id(3), [payment, payment]);
  assert.equal(result.size, 1);
  assert.equal(result.get(id(1)).coins, 501);
  assert.equal(h.calls.filter(call => call.table === 'cliente_puntos_historial').length, 2);
  for (const call of h.calls) assert.ok(call.filters.some(filter => filter.key === 'cliente_id' && filter.values[0] === id(3)));
});

test('note enrichment preserves editable text and collection notes; evidence errors preserve notes and known wheels', async () => {
  const notes = [{ id: id(30), event_type: 'purchase_registered', texto: 'Compra registrada por 35 vía paypal_manual.', event_data: { payment_id: id(1) } },
    { id: id(31), event_type: 'paypal_collection_confirmed', texto: 'Cobro recibido.', event_data: { payment_id: id(1) } }];
  const h = database({ fail: 'cliente_puntos_historial', rows: {
    crm_cliente_pagos: [{ ...payment, cliente_id: id(3) }],
    tc_client_benefit_events: [{ ...processed, id: id(6), payment_id: id(1), cliente_id: id(3) }],
    cliente_ruleta_giros: [{ id: id(7), nivel: 2, estado: 'pending', purchase_id: id(1), cliente_id: id(3) }],
  } });
  const result = await server.enrichPurchaseNotes(h.db, id(3), notes);
  assert.equal(result[0].texto, notes[0].texto);
  assert.equal(result[0].purchase_benefits_summary.coins_status, 'unavailable');
  assert.deepEqual(plain(result[0].purchase_benefits_summary.spins), [{ level: 2, count: 1 }]);
  assert.equal(result[1], notes[1]);
  assert.equal(notes[0].purchase_benefits_summary, undefined);
});

test('receipt component renders earned benefits separately from editable text with honest unknown state', () => {
  const { default: Receipt } = load('src/components/crm/PurchaseBenefitReceipt.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), '@/lib/purchase-benefit-summary': pure,
  });
  const summary = pure.summarizePurchaseBenefits(payment, { ledger: [earned], events: [processed], spins: [{ nivel: 2, estado: 'used' }] });
  const tree = renderer.create(React.createElement(Receipt, { summary }));
  assert.match(text(tree.toJSON()), /\+300 Coins.*Ruleta nivel 2.*Normal · Nada/);
  tree.update(React.createElement(Receipt, { summary: { ...summary, coins: null } }));
  assert.match(text(tree.toJSON()), /Coins pendientes de comprobar.*Actualiza la ficha/);
  assert.doesNotMatch(text(tree.toJSON()), /0 Coins/);
  tree.unmount();
});
