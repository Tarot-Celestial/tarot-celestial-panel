const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const exportsFixture = {};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src/lib/client-rank-free-usage.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { exports: exportsFixture });
const { rankFreeUsage, rankFreeOfferLabel } = exportsFixture;
const worker = '00000000-0000-4000-8000-000000000009';
const preview = (rank = 'plata', minutes = 10, changes = {}) => ({
  effective_rank: rank, minutes, policy_key: 'new_tarotista_once_v1',
  offers: [{ tarotista_worker_id: worker, tarotista_name: 'Josefa', eligibility_key: worker, eligible: true, reason: null, grant_minutes: minutes, consume_minutes: minutes, ...changes }],
});

test('all effective ranks including Bronze and no rank show their separate new-tarotista gift', () => {
  for (const [rank, label, minutes] of [['sin_rango', 'Sin rango', 7], ['bronce', 'Bronce', 7], ['plata', 'Plata', 10], ['oro', 'Oro', 12], ['diamante', 'Diamante', 15]]) {
    const choice = rankFreeUsage(preview(rank, minutes));
    assert.equal(rankFreeOfferLabel(choice), `${minutes} minutos FREE · ${label}`);
    assert.equal(choice.minutes, minutes); assert.equal(choice.available.length, 1);
  }
});

test('rank and a FREE balance alone never authorize a gift without a server offer', () => {
  const choice = rankFreeUsage({ effective_rank: 'plata', minutes: 10, free_balance: 500, policy_key: 'new_tarotista_once_v1' });
  assert.equal(choice.available.length, 0);
  assert.equal(rankFreeUsage(null).available.length, 0);
});

test('a legacy preview that would consume the ordinary FREE balance is not accepted as the separate gift', () => {
  for (const [rank, minutes] of [['plata', 10], ['oro', 12], ['diamante', 15]]) {
    const choice = rankFreeUsage(preview(rank, minutes, { grant_minutes: 0 }));
    assert.equal(choice.available.length, 0);
  }
});

test('used and inactive gifts stay unavailable regardless of rank', () => {
  for (const reason of ['ALREADY_USED', 'TAROTISTA_INACTIVE', 'RANK_NOT_ELIGIBLE']) {
    assert.equal(rankFreeUsage(preview('oro', 12, { eligible: false, reason })).available.length, 0);
    assert.equal(rankFreeUsage(preview('oro', 12, { eligible: true, reason })).available.length, 0);
  }
});

test('unknown and unconfirmed ranks never silently become Bronze or Silver', () => {
  for (const rank of [undefined, null, '', 'unexpected']) {
    const choice = rankFreeUsage({ ...preview(), effective_rank: rank });
    assert.equal(choice.rank, null); assert.equal(choice.minutes, 0); assert.equal(choice.available.length, 0);
  }
});

test('malformed offers cannot authorize an initial seven-minute call, arbitrary credit or manual tarotista', () => {
  for (const changes of [{ consume_minutes: 7 }, { grant_minutes: 100 }, { grant_minutes: null }, { grant_minutes: undefined }, { consume_minutes: null }, { tarotista_worker_id: 'CALL' }, { eligibility_key: 'different-worker' }, { eligible: 'true' }]) {
    assert.equal(rankFreeUsage(preview('plata', 10, changes)).available.length, 0);
  }
  assert.equal(rankFreeUsage({ ...preview(), policy_key: 'another-policy' }).available.length, 0);
  assert.equal(rankFreeUsage({ ...preview(), minutes: 12 }).available.length, 0);
});
