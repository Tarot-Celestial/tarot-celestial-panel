const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => name === 'server-only' ? {} : name in mocks ? mocks[name] : require(name), console, Request, Response, URL, performance, AbortController, AbortSignal, setTimeout, clearTimeout, process });
  return exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
const ruleta = load('src/lib/ruleta.ts');
const minute = load('src/lib/server/cliente-minute-packs.ts', { '@/lib/ruleta': ruleta });
const oracle = load('src/lib/server/oracle-premium.ts');
const question = load('src/lib/server/oracle-questions.ts');
const api = load('src/lib/server/cliente-price-catalog.ts', {
  '@/lib/server/cliente-minute-packs': minute,
  '@/lib/server/oracle-premium': oracle,
  '@/lib/server/oracle-questions': question,
});
const owner = '00000000-0000-4000-8000-000000000001';
const foreign = '00000000-0000-4000-8000-000000000002';

function fixture(options = {}) {
  const calls = [], signals = [];
  const admin = {
    rpc(name, args) {
      calls.push({ name, args: clone(args) });
      return { abortSignal(signal) {
        signals.push(signal);
        if (options.hang === name) return new Promise(() => {});
        if (options.reject === name) return Promise.reject(new Error('network unavailable'));
        if (name === 'tc_client_rank_state') return Promise.resolve({ error: options.rankError || null, data: 'rank' in options ? options.rank : { effective: 'diamante', automatic: 'bronce', config: { rank_key: 'diamante', label: 'Diamante' }, override: { reason: 'private reason', notes: 'private notes' } } });
        return Promise.resolve({ error: options.resolveError || null, data: 'rows' in options ? options.rows : args.p_packages.map((pack, i) => ({
          ...pack, rank_key: args.p_rank_key_override, package_level: Math.floor(i / 3) + 1,
          status: args.p_rank_key_override === null ? 'no_effective_rank' : 'ready',
          rank_benefits: args.p_rank_key_override === null ? null : { enabled: true, coins: 500, oracle_credits: 1, updated_by: 'hidden-operator' },
          rank_state: { total: 600, private_notes: 'hidden' }, package_assignment: { updated_by: 'hidden' },
        })) });
      } };
    },
    from() { throw new Error('catalog must not read unrelated tables'); },
  };
  return { admin, calls, signals };
}

test('catalog preserves all checkout pack ids, prices, minutes and native benefits', async () => {
  const f = fixture(), catalog = await api.loadClientePriceCatalog(f.admin, owner);
  assert.equal(catalog.packs.length, 9);
  assert.equal(catalog.rankKey, 'diamante');
  assert.equal(catalog.rankLabel, 'Diamante');
  for (let i = 0; i < minute.CLIENTE_MINUTE_PACKS.length; i++) {
    for (const [key, value] of Object.entries(minute.CLIENTE_MINUTE_PACKS[i])) assert.equal(catalog.packs[i][key], value, key);
    assert.equal(catalog.packs[i].rankBenefitsStatus, 'ready');
    assert.equal(catalog.packs[i].packageLevel, Math.floor(i / 3) + 1);
  }
  assert.deepEqual(clone(catalog.oraclePacks), clone(oracle.ORACLE_PACKS));
  assert.deepEqual(clone(catalog.questionPack), clone(question.ORACLE_QUESTION_PACK));
  assert.equal(JSON.stringify(catalog).includes('private'), false);
  assert.equal(JSON.stringify(catalog).includes('updated_by'), false);
  assert.equal(JSON.stringify(catalog).includes('rank_state'), false);
});

test('rank is resolved once for the authenticated client and manual rank wins', async () => {
  const f = fixture(); await api.loadClientePriceCatalog(f.admin, owner);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], { name: 'tc_client_rank_state', args: { p_cliente_id: owner } });
  assert.equal(f.calls[1].name, 'tc_resolve_rank_package_benefits');
  assert.equal(f.calls[1].args.p_cliente_id, null);
  assert.equal(f.calls[1].args.p_rank_key_override, 'diamante');
  assert.equal(f.calls[1].args.p_packages.length, 9);
  assert.equal(f.signals[0], f.signals[1]);
});

test('verified no-rank state remains distinct from failed or unknown rank state', async () => {
  const f = fixture({ rank: { effective: null, config: null } });
  const catalog = await api.loadClientePriceCatalog(f.admin, owner);
  assert.equal(f.calls[1].args.p_rank_key_override, null);
  assert.equal(catalog.rankKey, null);
  assert.equal(catalog.rankLabel, null);
  assert.ok(catalog.packs.every(pack => pack.rankBenefitsStatus === 'no_effective_rank' && pack.rankBenefits === null));
  for (const rank of [null, {}, { effective: undefined }, { effective: '' }, { effective: 'diamante', config: { rank_key: 'oro' } }, { effective: 'unverified' }]) {
    const failed = fixture({ rank }), response = await api.loadClientePriceCatalog(failed.admin, owner);
    assert.equal(failed.calls.length, 1);
    assert.equal(response.rankKey, null);
    assert.equal(response.rankLabel, null);
    assert.ok(response.packs.every(pack => pack.rankBenefitsStatus === 'unavailable' && pack.rankBenefits === null && pack.packageLevel === null));
    assert.equal(response.packs[0].priceUsd, minute.CLIENTE_MINUTE_PACKS[0].priceUsd);
  }
});

test('RPC errors, network failures and missing resolutions preserve prices with unknown extras', async () => {
  for (const options of [{ rankError: { code: 'DOWN' } }, { resolveError: { code: 'DOWN' } }, { reject: 'tc_client_rank_state' }, { reject: 'tc_resolve_rank_package_benefits' }, { rows: null }, { rows: [] }]) {
    const f = fixture(options), catalog = await api.loadClientePriceCatalog(f.admin, owner);
    assert.equal(catalog.packs.length, 9);
    assert.ok(catalog.packs.every(pack => pack.rankBenefits === null && pack.rankBenefitsStatus === 'unavailable'));
    assert.equal(catalog.packs[8].priceUsd, 99);
  }
});

test('mismatched rank, foreign source and unknown resolver status cannot grant benefits', async () => {
  for (const row of [
    { package_source: 'standard', rank_key: 'oro', status: 'ready' },
    { package_source: 'promotion', rank_key: 'diamante', status: 'ready' },
    { package_source: 'standard', rank_key: 'diamante', status: 'mystery' },
  ]) {
    const f = fixture({ rows: [{ ...row, package_key: 'pack_10', package_level: 1, rank_benefits: { enabled: true, coins: 9000 } }] });
    const catalog = await api.loadClientePriceCatalog(f.admin, owner);
    assert.equal(catalog.packs[0].rankBenefitsStatus, 'unavailable');
    assert.equal(catalog.packs[0].rankBenefits, null);
  }
});

test('timeout bounds both rank and benefits queries and cancels the active request', async () => {
  for (const hang of ['tc_client_rank_state', 'tc_resolve_rank_package_benefits']) {
    const f = fixture({ hang });
    const started = performance.now();
    const catalog = await api.loadClientePriceCatalog(f.admin, owner, 15);
    assert.ok(performance.now() - started < 1000);
    assert.ok(f.signals.every(signal => signal.aborted));
    assert.equal(catalog.packs[0].rankBenefitsStatus, 'unavailable');
    assert.equal(catalog.rankKey, null);
    assert.equal(catalog.rankLabel, null);
  }
});

test('catalog does not cache one client rank or extras for the next account', async () => {
  const first = fixture(), second = fixture({ rank: { effective: null, config: null } });
  await api.loadClientePriceCatalog(first.admin, owner);
  const next = await api.loadClientePriceCatalog(second.admin, foreign);
  assert.equal(second.calls[0].args.p_cliente_id, foreign);
  assert.ok(next.packs.every(pack => pack.rankBenefitsStatus === 'no_effective_rank'));
  assert.equal(next.rankKey, null);
  assert.equal(next.rankLabel, null);
});

// Mirrors the read-only production matrix verified on 2026-10-13. These are
// extra rank benefits, not replacements for a pack's native oracle credits.
test('current rank matrices preserve normal tier extras and the Diamond exception independently of native benefits', async () => {
  for (const rankKey of ['bronce', 'plata', 'oro', 'diamante']) {
    const diamond = rankKey === 'diamante';
    const rows = minute.CLIENTE_MINUTE_PACKS.map((pack, index) => {
      const level = Math.floor(index / 3) + 1;
      return { package_source: 'standard', package_key: pack.id, package_level: level, rank_key: rankKey, status: 'ready', rank_benefits: {
        enabled: true, coins: diamond ? 500 : [50, 150, 300][level - 1],
        oracle_credits: diamond ? [0, 1, 3][level - 1] : (level === 3 ? 2 : 0),
        roulette_level_1_spins: Number(level === 1), roulette_level_2_spins: Number(level === 2), roulette_level_3_spins: Number(level === 3),
        roulette_special_spins: Number(diamond && level === 3), updated_by: 'private-operator',
      } };
    });
    const f = fixture({ rank: { effective: rankKey, config: { rank_key: rankKey, label: `  ${rankKey}  ` } }, rows });
    const catalog = await api.loadClientePriceCatalog(f.admin, owner);
    assert.equal(catalog.rankKey, rankKey);
    assert.equal(catalog.rankLabel, rankKey);
    assert.equal(f.calls.length, 2, 'showing the rank must not add database requests');
    for (let i = 0; i < catalog.packs.length; i++) {
      const pack = catalog.packs[i], expected = rows[i].rank_benefits;
      assert.equal(pack.rankBenefits.coins, expected.coins);
      assert.equal(pack.rankBenefits.oracle_credits, expected.oracle_credits);
      assert.equal(pack.rankBenefits.roulette_special_spins, expected.roulette_special_spins);
      assert.equal(pack.rankBenefits[`roulette_level_${pack.packageLevel}_spins`], 1);
      assert.equal(pack.oracleCredits || 0, minute.CLIENTE_MINUTE_PACKS[i].oracleCredits || 0);
      assert.equal(pack.rouletteSpins, minute.CLIENTE_MINUTE_PACKS[i].rouletteSpins);
    }
    assert.deepEqual(clone(catalog.packs.slice(6).map(pack => (pack.oracleCredits || 0) + pack.rankBenefits.oracle_credits)), diamond ? [4, 5, 6] : [3, 4, 5]);
    assert.equal(JSON.stringify(catalog).includes('private-operator'), false);
  }
});

test('disabled matrix benefits stay disabled without losing the verified rank label or pack benefits', async () => {
  const f = fixture({ rows: [{ package_source: 'standard', package_key: 'pack_80', package_level: 3, rank_key: 'diamante', status: 'disabled', rank_benefits: { enabled: false, coins: 500, oracle_credits: 3, private_notes: 'hidden' } }] });
  const catalog = await api.loadClientePriceCatalog(f.admin, owner);
  const pack = catalog.packs.find(pack => pack.id === 'pack_80');
  assert.equal(catalog.rankKey, 'diamante');
  assert.equal(catalog.rankLabel, 'Diamante');
  assert.equal(pack.rankBenefitsStatus, 'disabled');
  assert.equal(pack.rankBenefits.enabled, false);
  assert.equal(pack.oracleCredits, 1);
  assert.equal(JSON.stringify(catalog).includes('private_notes'), false);
});

test('rank display metadata is never invented from missing or non-text labels', async () => {
  for (const label of [undefined, null, {}, '   ']) {
    const f = fixture({ rank: { effective: 'oro', config: { rank_key: 'oro', label } } });
    const catalog = await api.loadClientePriceCatalog(f.admin, owner);
    assert.equal(catalog.rankKey, 'oro');
    assert.equal(catalog.rankLabel, null);
  }
});

class AccessError extends Error { constructor(status, message) { super(message); this.status = status; } }
function routeFixture(error) {
  const calls = [];
  const gate = { admin: {}, cliente: { id: owner } };
  const route = load('src/app/api/cliente/catalogo/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }) } },
    '@/lib/server/ruleta-access': { RouletteAccessError: AccessError, rouletteClient: async req => { calls.push(['gate', req.headers.get('authorization')]); if (error) throw error; return gate; } },
    '@/lib/server/cliente-price-catalog': { loadClientePriceCatalog: async (admin, clientId) => { calls.push(['catalog', admin === gate.admin, clientId]); return { packs: [], oraclePacks: [], questionPack: null }; } },
  });
  return { route, calls };
}

test('route ignores supplied identity and rank, scopes data to gate, and prevents shared caching', async () => {
  const f = routeFixture();
  const response = await f.route.GET(new Request(`https://example.test/api/cliente/catalogo?cliente_id=${foreign}&rank_key=diamante`, { headers: { Authorization: 'Bearer verified-token' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls[1], ['catalog', true, owner]);
  assert.equal((await response.json()).ok, true);
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.match(response.headers.get('Server-Timing'), /auth;dur=.*catalog;dur=/);
});

test('route denies unauthorized/ambiguous identities before catalog and hides internal errors', async () => {
  for (const error of [new AccessError(401, 'Sesión caducada'), new AccessError(403, 'Acceso en revisión'), new Error('private database details')]) {
    const f = routeFixture(error), response = await f.route.GET(new Request('https://example.test/api/cliente/catalogo'));
    assert.equal(response.status, error.status || 503);
    assert.equal(f.calls.length, 1);
    assert.equal((await response.json()).ok, false);
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  }
});
