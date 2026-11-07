const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const { act } = renderer;

function load(file, mocks = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (name in mocks) return mocks[name];
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts', mocks, globals);
    return require(name);
  }, console, Request, Response, URL, setTimeout, clearTimeout, ...globals });
  return exports;
}
const config = load('src/lib/rank-benefit-config.ts');
const spinFields = ['roulette_level_1_spins', 'roulette_level_2_spins', 'roulette_level_3_spins', 'roulette_special_spins', 'roulette_diamond_spins'];
const matrix = { rank_key: 'plata', package_level: 1, enabled: true, coins: 75, oracle_credits: 2,
  roulette_level_1_spins: 1, roulette_level_2_spins: 0, roulette_level_3_spins: 0, roulette_special_spins: 0, revision: 3 };
const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } };
const json = (body, options) => new Response(JSON.stringify(body), { ...options, headers: { ...options?.headers, 'Content-Type': 'application/json' } });

test('purchase policy rejects additional spins but preserves Coins, Oracle and independent daily bonuses', () => {
  for (const key of spinFields) assert.throws(() => config.validateRankPackageBenefitEdit({ ...config.withoutPurchaseRankSpins(matrix), [key]: 1 }), /PURCHASE_RANK_SPINS_DISABLED/);
  const valid = config.validateRankPackageBenefitEdit(config.withoutPurchaseRankSpins(matrix));
  assert.equal(valid.coins, 75); assert.equal(valid.oracle_credits, 2);
  assert.doesNotMatch(config.purchaseRankBenefitLabels(matrix).join(' '), /giro/);
  assert.throws(() => config.assertNoPurchaseRankSpins({ roulette_enabled: true }), /PURCHASE_RANK_SPINS_DISABLED/);
  assert.doesNotThrow(() => config.assertNoPurchaseRankSpins({ roulette_enabled: false, roulette_spins: 1 }));
  const daily = config.validateDiamondDailyBonus({ ...matrix, id: '11111111-1111-4111-8111-111111111111', name: 'Bono diario', description: '', roulette_level_1_spins: 2 });
  assert.equal(daily.roulette_level_1_spins, 2);
  assert.match(config.matrixBenefitLabels(daily).join(' '), /2 giro N1/);
});

test('legacy admin API rejects an old form enabling automatic rank spins before calling Supabase', async () => {
  let calls = 0;
  const route = load('src/app/api/admin/rank-benefits/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/rank-benefit-config': config,
    '@/lib/admin/require-admin': { requireAdmin: async () => ({ ok: true, me: { user_id: 'admin' }, admin: { rpc: async () => { calls++; return { data: {}, error: null }; } } }) },
  });
  const submit = data => route.POST(new Request('https://fixture.invalid', { method: 'POST', body: JSON.stringify({ action: 'rank', data }) }));
  const denied = await submit({ roulette_enabled: true, roulette_spins: 1 });
  assert.equal(denied.status, 409); assert.match((await denied.json()).error, /rango no añade giros/); assert.equal(calls, 0);
  const accepted = await submit({ roulette_enabled: false, roulette_spins: 1, purchase_coins: 75 });
  assert.equal(accepted.status, 200); assert.equal(calls, 1);
});

test('matrix editor does not offer spin controls and saves zero extras even from old nonzero settings', async () => {
  const posted = [];
  const data = { ranks: [{ rank_key: 'plata', label: 'Plata', ritual_access: false, revision: 0 }], matrix: [matrix], assignments: [], packages: [], deliveries: [], audit: [], diamond_bonus: null, business_timezone: 'Europe/Madrid' };
  const Panel = load('src/components/admin/RankBenefitsPhaseOne.tsx', {
    '@/lib/rank-benefit-config': config,
    '@/lib/customer-benefits': { customerBenefitLabels: () => [] },
    '@/lib/client-free-passes': { freePassPolicyLabel: () => 'pase', rankHasFreePasses: () => true },
    '@/lib/supabase-browser': { supabaseBrowser: () => sb },
    '@/components/benefits/CrystalEmblem': () => null,
  }, { window: { setTimeout: () => 0 }, fetch: async (_, options) => {
    if (options.method === 'POST') posted.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true, ...data }) };
  } }).default;
  let view;
  await act(async () => { view = renderer.create(React.createElement(Panel)); });
  try {
    assert.match(JSON.stringify(view.toJSON()), /rango no añade giros/);
    const inputs = view.root.findAllByType('input').filter(input => input.props.type === 'number');
    assert.equal(inputs.length, 2);
    const coins = inputs.find(input => input.props.value === 75);
    await act(async () => coins.props.onChange({ target: { value: '90' } }));
    const button = view.root.findAllByType('button').find(button => button.children.includes('Guardar cambios'));
    await act(async () => button.props.onClick());
    assert.equal(posted[0].action, 'save_matrix');
    assert.equal(posted[0].data.coins, 90); assert.equal(posted[0].data.oracle_credits, 2);
    for (const field of spinFields) assert.equal(posted[0].data[field], 0);
  } finally { act(() => view.unmount()); }
});

test('client rank guide suppresses historical automatic extras but retains the independent daily bonus', async () => {
  const ranks = ['bronce', 'plata', 'oro', 'diamante'].map((rank_key, index) => ({ rank_key, label: rank_key, min_spend: index * 100, roulette_enabled: true, roulette_spins: 3, roulette_level: 1 }));
  const daily = { rank_key: 'diamante', enabled: true, roulette_level_1_spins: 2 };
  const tables = { tc_client_rank_benefits: ranks, tc_rank_package_benefits: [matrix], tc_rank_daily_bonus_config: daily };
  const admin = { rpc: async () => ({ data: { total: 150, effective: 'plata', automatic: 'plata' }, error: null }), from: table => {
    const query = { select() { return this; }, in() { return this; }, order() { return this; }, eq() { return this; }, maybeSingle() { return this; }, then(resolve, reject) { return Promise.resolve({ data: tables[table], error: null }).then(resolve, reject); } }; return query;
  } };
  const route = load('src/app/api/cliente/rangos/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/lib/rank-benefit-config': config,
    '@/lib/server/customer-benefits': { customerBenefitPolicy: async () => null },
    '@/lib/server/ruleta-access': { rouletteClient: async () => ({ admin, cliente: { id: 'fixture' } }), RouletteAccessError: class extends Error {} },
    '@/lib/server/cliente-platform': { currentRankBenefits: () => [] },
  });
  const response = await route.GET(new Request('https://fixture.invalid'));
  assert.equal(response.status, 200);
  const body = await response.json();
  const silver = body.ranks.find(row => row.key === 'plata');
  assert.equal(silver.package_benefits[0].coins, 75);
  assert.equal(silver.package_benefits[0].oracle_credits, 2);
  for (const field of spinFields) assert.equal(silver.package_benefits[0][field], 0);
  assert.ok(silver.benefits.includes(config.PURCHASE_RANK_SPIN_NOTICE));
  assert.ok(silver.benefits.every(label => !label.startsWith('+3 giro')));
  assert.equal(body.daily_bonus.roulette_level_1_spins, 2);
});

