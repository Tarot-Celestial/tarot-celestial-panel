const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { create, act } = require('react-test-renderer');
const { randomUUID } = require('node:crypto');
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (Array.isArray(node) ? node : node?.children || []).map(text).join('');
const flush = async fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, console, Date, Request, Response, URL, crypto: { randomUUID }, require: name => name in mocks ? mocks[name] : name.endsWith('.module.css') ? { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } : require(name), ...globals });
  return exports;
}
const policy = load('src/lib/client-free-passes.ts');
const config = load('src/lib/rank-benefit-config.ts');
const source = read('src/lib/server/cliente-platform.ts');
const fragment = source.slice(source.indexOf('export function currentRankBenefits('), source.indexOf('const CRM_MONTH_TAGS'));
const benefitExports = {};
vm.runInNewContext(ts.transpileModule(fragment, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: benefitExports });

test('Bronze, no rank and unknown ranks never promise free passes; Silver and above keep them', () => {
  for (const rank of ['bronce', null, undefined, 'sin_rango', 'unexpected']) {
    assert.equal(policy.rankHasFreePasses(rank), false);
    assert.doesNotMatch(benefitExports.currentRankBenefits(rank).join(' '), /pases|7 minutos/i);
  }
  for (const rank of ['plata', 'oro', 'diamante']) {
    assert.equal(policy.rankHasFreePasses(rank), true);
    const benefits = benefitExports.currentRankBenefits(rank).join(' ');
    assert.match(benefits, /3 pases GRATIS de 7 minutos cada 30 días, con alguna compra confirmada/);
    assert.doesNotMatch(benefits, /4 meses|cuatro meses/);
  }
});

test('pass descriptions use database policy values and do not invent values on missing data', () => {
  assert.equal(policy.freePassPolicyLabel({ passes: 2, minutes: 9, cycle_days: 45 }), '2 pases de 9 minutos FREE cada 45 días');
  for (const value of [null, undefined, { passes: 3, minutes: 7, cycle_days: 0 }, { passes: 3, minutes: NaN, cycle_days: 30 }]) assert.equal(policy.freePassPolicyLabel(value), null);
});

test('disabled rank matrix rows expose no enabled rewards, even when saved amounts are positive', () => {
  const row = { enabled: false, coins: 500, oracle_credits: 3, roulette_level_1_spins: 2, roulette_level_2_spins: 1, roulette_level_3_spins: 2, roulette_special_spins: 1 };
  assert.deepEqual(Array.from(config.matrixBenefitLabels(row)), ['Entrega desactivada']);
  assert.deepEqual(Array.from(config.matrixBenefitLabels(null)), ['Entrega desactivada']);
});

const status = extra => ({ eligible: true, rank_eligible: true, effective_rank: 'plata', eligibility_reason: null, total: 3, available: 2, used: 1, minutes: 7, cycle_days: 30, cycle_start: '2026-10-01', renews_at: '2026-10-31', ...extra });
test('Bronze UI clearly excludes passes, preserves used history, and blocks a new consume', async () => {
  let sends = 0;
  const Panel = load('src/components/crm/FreePassBenefits.tsx', {}, { fetch: async () => { sends++; return {}; } }).default;
  let view; await flush(() => { view = create(React.createElement(Panel, { benefits: status({ eligible: false, rank_eligible: false, effective_rank: 'bronce', eligibility_reason: 'RANK_NOT_ELIGIBLE', available: 0 }), clienteId: 'fixture-client', getToken: async () => 'fixture' })); });
  const body = text(view.toJSON()); assert.match(body, /No incluidos/); assert.match(body, /rango actual no incluye/); assert.match(body, /historial se conserva/); assert.doesNotMatch(body, /4 meses|cuatro meses/);
  const button = view.root.findByType('button'); assert.equal(button.props.disabled, true);
  await flush(() => button.props.onClick()); assert.equal(sends, 0);
  act(() => view.unmount());
});

test('Silver without a confirmed purchase explains the missing purchase separately', () => {
  const Panel = load('src/components/crm/FreePassBenefits.tsx').default;
  const view = create(React.createElement(Panel, { benefits: status({ eligible: false, available: 0, eligibility_reason: 'NO_CONFIRMED_PURCHASE' }) }));
  assert.match(text(view.toJSON()), /se necesita alguna compra confirmada/);
  assert.doesNotMatch(text(view.toJSON()), /rango actual no incluye/);
  act(() => view.unmount());
});

test('an uncertain historical consume can still be checked after the rank drops, using the same operation ID', async () => {
  const requests = []; let fail = true, refreshes = 0;
  const Panel = load('src/components/crm/FreePassBenefits.tsx', {}, { fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); if (fail) throw new Error('Resultado incierto simulado'); return { ok: true, json: async () => ({ ok: true, replayed: true }) }; } }).default;
  const props = { clienteId: 'fixture-client', getToken: async () => 'fixture', onRefresh: async () => { refreshes++; } };
  let view; await flush(() => { view = create(React.createElement(Panel, { ...props, benefits: status() })); });
  await flush(() => view.root.findByType('button').props.onClick());
  await flush(() => view.update(React.createElement(Panel, { ...props, benefits: status({ eligible: false, rank_eligible: false, available: 0 }) })));
  assert.equal(view.root.findByType('button').props.disabled, false);
  fail = false; await flush(() => view.root.findByType('button').props.onClick());
  assert.equal(requests.length, 2); assert.equal(requests[0].request_id, requests[1].request_id); assert.equal(refreshes, 1);
  assert.match(text(view.toJSON()), /No se ha consumido otro/); act(() => view.unmount());
});

test('admin comparison shows saved matrix and policy values for all ranks without implying Bronze passes', () => {
  const Comparison = load('src/components/admin/RankBenefitsPhaseOne.tsx', {
    '@/lib/supabase-browser': { supabaseBrowser: () => ({}) }, '@/lib/rank-benefit-config': config,
    '@/lib/client-free-passes': policy, '@/components/benefits/CrystalEmblem': () => null,
  }).RankBenefitsComparison;
  const data = { ranks: ['bronce', 'plata', 'oro', 'diamante'].map((key, index) => ({ rank_key: key, label: key, sort_order: index, ritual_access: key === 'diamante', is_active: false })), matrix: [{ rank_key: 'plata', package_level: 1, enabled: true, coins: 321, oracle_credits: 2 }], diamond_bonus: { enabled: true, name: 'Bono simulado', coins: 44 }, free_pass_policy: { passes: 2, minutes: 9, cycle_days: 45 }, free_pass_policy_available: true };
  const view = create(React.createElement(Comparison, { data }));
  const cells = view.root.findAllByType('td');
  assert.equal(text(cells.find(cell => cell.props['data-rank'] === 'bronce')), 'No incluidos');
  assert.equal(text(cells.find(cell => cell.props['data-rank'] === 'plata')), '2 pases de 9 minutos FREE cada 45 días');
  assert.match(text(view.toJSON()), /321 Coins/); assert.match(text(view.toJSON()), /44 Coins/);
  assert.match(text(view.toJSON()), /Plata \+10 y Oro \+12[^.]*configurados, pendientes de aplicación automática/);
  assert.match(text(view.toJSON()), /No se aplica a Oráculo ni a registros manuales de llamada/);
  assert.match(text(view.toJSON()), /Coins y giros solo se entregan a tarifa regular/);
  assert.match(text(view.toJSON()), /Oráculo pueden aplicarse también a promociones con nivel asignado/);
  assert.match(text(view.toJSON()), /una consulta de regalo por cliente y por cada nueva tarotista disponible; 10 minutos en Plata, 12 en Oro y 15 en Diamante/);
  assert.match(text(view.toJSON()), /El regalo tiene sus propios minutos y mantiene el saldo pendiente del cliente, aunque sea 0/);
  act(() => view.update(React.createElement(Comparison, { data: { ...data, free_pass_policy: null, free_pass_policy_available: false } })));
  assert.match(text(view.toJSON()), /Política no disponible/); assert.doesNotMatch(text(view.toJSON()), /3 pases de 7/);
  act(() => view.unmount());
});

test('published benefit descriptions distinguish configured Silver/Gold minutes from the active Diamond rule', () => {
  for (const rank of ['plata', 'oro']) {
    const labels = benefitExports.currentRankBenefits(rank);
    assert.ok(labels.some(label => /Configurado, pendiente de aplicación automática/.test(label) && /precio regular/.test(label)));
    assert.ok(labels.some(label => /nueva tarotista disponible, una sola vez por cliente y tarotista.*Central al registrar la consulta/.test(label)));
  }
  const diamond = benefitExports.currentRankBenefits('diamante').join(' ');
  assert.match(diamond, /15 minutos GRATIS para conocer a cada nueva tarotista disponible, una sola vez por cliente y tarotista/);
  assert.match(diamond, /compra de minutos confirmada, incluidas promociones; no Oráculo ni registros manuales de llamada/);
  assert.match(diamond, /500 Coins[^.]*tarifa regular[^.]*configuración del nivel activada/);
  assert.doesNotMatch(diamond, /12 minutos|pendiente de aplicación/);
});

test('raffles and energetic follow-up describe Central assistance instead of automatic rank delivery', () => {
  for (const rank of ['oro', 'diamante']) {
    const labels = benefitExports.currentRankBenefits(rank).join(' ');
    assert.match(labels, /Participación en sorteos activos, gestionada por Central según condiciones/);
    assert.doesNotMatch(labels, /Participación automática|1 número por sorteo/);
  }
  for (const rank of ['plata', 'oro', 'diamante']) assert.match(benefitExports.currentRankBenefits(rank).join(' '), /Seguimiento energético[^.]*coordinado por Central/);
  for (const file of ['src/lib/server/cliente-platform.ts', 'src/features/central/MyClientSummary.tsx', 'src/components/crm/CRMClientesPanel.tsx', 'src/app/cliente/rangos/page.tsx']) assert.doesNotMatch(read(file), /Participación automática en sorteos|1 número por sorteo/, file);
  assert.match(read('src/components/admin/RankBenefitsPhaseOne.tsx'), /seguimiento energético es atención asistida coordinada por Central/);
});

test('CRM and the central purchase summary recognize Diamond without an obsolete 12-minute promise', () => {
  const crm = read('src/components/crm/CRMClientesPanel.tsx');
  const functionSource = crm.slice(crm.indexOf('function rankMeta('), crm.indexOf('function rankChip('));
  const exported = {};
  vm.runInNewContext(ts.transpileModule(`export ${functionSource}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exported });
  const diamond = exported.rankMeta('diamante');
  assert.equal(diamond.label, 'Diamante'); assert.match(diamond.perks.join(' '), /15 min/); assert.doesNotMatch(diamond.perks.join(' '), /12 min|precio regular/);
  for (const file of ['src/features/central/MyClientSummary.tsx', 'src/features/central/MyClientPurchases.tsx']) {
    const code = read(file), start = code.indexOf('const rankInfo:'), end = code.indexOf('\n};', start) + 3;
    const result = {};
    vm.runInNewContext(ts.transpileModule(`export ${code.slice(start, end)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: result });
    assert.equal(result.rankInfo.diamante.label, 'Diamante');
    assert.match(result.rankInfo.diamante.perks.join(' '), /15 minutos/);
    assert.doesNotMatch(result.rankInfo.diamante.perks.join(' '), /12 minutos|precio regular/);
    assert.equal(result.rankInfo.oro.next, 1000);
  }
});

test('every legacy Bronze description and the client FAQ use the corrected scope', () => {
  const summary = read('src/features/central/MyClientSummary.tsx');
  assert.doesNotMatch(summary.slice(summary.indexOf('  bronce: {'), summary.indexOf('  plata: {')), /pases|7 minutos/);
  const crm = read('src/components/crm/CRMClientesPanel.tsx');
  assert.doesNotMatch(crm.slice(crm.indexOf('  if (r === "bronce")'), crm.indexOf('  return {\n    icon: "▫️"')), /3 pases|7 minutos/);
  for (const file of ['src/lib/server/cliente-platform.ts', 'src/features/central/MyClientSummary.tsx', 'src/components/crm/CRMClientesPanel.tsx', 'src/components/crm/FreePassBenefits.tsx', 'src/app/cliente/rangos/page.tsx']) assert.doesNotMatch(read(file), /pases[^\n]{0,200}(?:4 meses|cuatro meses)/i, file);
  assert.match(read('src/app/cliente/rangos/page.tsx'), /Bronce no incluye estos pases/);
  assert.match(read('src/app/cliente/rangos/page.tsx'), /Coins y giros, incluidos los 500 Coins de Diamante, solo corresponden a tarifa regular/);
});

const next = { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), { ...options, headers: { ...options?.headers, 'Content-Type': 'application/json' } }) } };
test('consume API returns a refreshable rank rejection and preserves successful historical replays', async () => {
  let result = { error: { message: 'RANK_NOT_ELIGIBLE' }, data: null };
  const route = load('src/app/api/crm/clientes/pases/route.ts', {
    'next/server': next,
    '@/lib/server/ruleta-access': { rouletteStaff: async () => ({ admin: { rpc: async () => result }, worker: { id: 'fixture-worker' } }), RouletteAccessError: class extends Error {} },
  });
  const request = () => new Request('https://fixture.invalid/pases', { method: 'POST', body: JSON.stringify({ cliente_id: randomUUID(), request_id: randomUUID(), cycle_start: '2026-10-01', expected_used: 1 }) });
  const rejection = await route.POST(request()); const rejected = await rejection.json();
  assert.equal(rejection.status, 409); assert.equal(rejected.refresh, true); assert.match(rejected.error, /rango Plata/);
  result = { error: null, data: { replayed: true, available: 0 } };
  const replay = await route.POST(request()); const body = await replay.json();
  assert.equal(replay.status, 200); assert.equal(body.ok, true); assert.equal(body.replayed, true);
});

test('admin API returns the saved pass policy, while a policy failure stays unavailable instead of inventing defaults', async () => {
  let policyError = false;
  const calls = [];
  const admin = { from(table) {
    const query = { select(columns) { calls.push({ table, columns }); return this; }, order() { return this; }, eq() { return this; }, in() { return this; }, limit() { return this; }, maybeSingle() { return this; }, then(resolve, reject) {
      const data = table === 'crm_free_pass_policy' ? { passes: 2, minutes: 9, cycle_days: 45 } : table === 'tc_rank_daily_bonus_config' ? null : [];
      return Promise.resolve({ data, error: table === 'crm_free_pass_policy' && policyError ? { message: 'unavailable' } : null }).then(resolve, reject);
    } }; return query;
  } };
  const route = load('src/app/api/admin/rank-benefits/phase-one/route.ts', {
    'next/server': next, '@/lib/admin/require-admin': { requireAdmin: async () => ({ ok: true, admin, me: { user_id: 'fixture' } }) },
    '@/lib/server/cliente-minute-packs': { CLIENTE_MINUTE_PACKS: [] }, '@/lib/rank-benefit-config': config,
  });
  const response = await route.GET(new Request('https://fixture.invalid/admin')); const body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.free_pass_policy, { passes: 2, minutes: 9, cycle_days: 45 }); assert.equal(body.free_pass_policy_available, true);
  assert.equal(calls.find(call => call.table === 'crm_free_pass_policy').columns, 'passes,minutes,cycle_days');
  policyError = true;
  const failed = await route.GET(new Request('https://fixture.invalid/admin')); const unavailable = await failed.json();
  assert.equal(failed.status, 200); assert.equal(unavailable.free_pass_policy, null); assert.equal(unavailable.free_pass_policy_available, false);
});
