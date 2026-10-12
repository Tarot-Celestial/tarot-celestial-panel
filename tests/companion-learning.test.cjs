const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/companion-learning.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const domain = {};
vm.runInNewContext(code, { exports: domain, Date, Intl, Map, Set, Object, Number, Math, RangeError });
const { buildLearningSummary, strategyAdjustment } = domain;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = value => new Date(value).toISOString();
const plain = value => JSON.parse(JSON.stringify(value));

function episode(id = 'episode-1', changes = {}) {
  return {
    id, worker_id: 'worker-a', source_key: `source:${id}`, source_id: '11111111-1111-4111-8111-111111111111',
    client_id: '22222222-2222-4222-8222-222222222222', strategy: 'recovery_loyal',
    title: 'Retomar a una clienta habitual', reason: 'Tiene seguimiento pendiente', expected_outcome: 'Una compra posterior',
    baseline: {}, state: 'observed', created_at: '2026-10-10T08:00:00Z', updated_at: '2026-10-11T11:00:00Z',
    tried_at: '2026-10-10T09:00:00Z', deadline_at: '2026-10-11T10:00:00Z', resolved_at: '2026-10-11T11:00:00Z',
    evidence: { id: `purchase-${id}`, kind: 'purchase', occurredAt: '2026-10-10T09:30:00Z', detail: 'Nueva compra registrada' },
    feedback: null, feedback_note: null, feedback_at: null,
    ...changes,
  };
}

function observedAt(id, resolvedMs) {
  return episode(id, {
    created_at: iso(resolvedMs - 3 * HOUR), tried_at: iso(resolvedMs - 2 * HOUR),
    deadline_at: iso(resolvedMs + HOUR), resolved_at: iso(resolvedMs), updated_at: iso(resolvedMs),
    evidence: { id: `purchase-${id}`, kind: 'purchase', occurredAt: iso(resolvedMs - HOUR), detail: 'Compra posterior comprobada' },
  });
}

function lesson(rows, strategy = 'recovery_loyal') {
  return buildLearningSummary(rows, NOW).lessons.find(item => item.strategy === strategy);
}

test('empty history has a usable first level and no manufactured knowledge', () => {
  const summary = buildLearningSummary([], NOW);
  assert.equal(summary.level, 1);
  assert.equal(summary.xp, 0);
  assert.equal(summary.levelXp, 0);
  assert.equal(summary.nextLevelXp, 100);
  assert.equal(summary.progress, 0);
  assert.equal(summary.lessons.length, 4);
  assert.ok(summary.lessons.every(item => item.attempts === 0 && item.confidence === 'initial' && item.adjustment === 0));
});

test('only verified observations and a dated first rating earn XP; refreshes are idempotent', () => {
  const rows = [episode('observed', { feedback: 'helpful', feedback_at: '2026-10-11T11:00:00Z' }), episode('click', { state: 'suggested', evidence: null, tried_at: null })];
  const first = buildLearningSummary(rows, NOW);
  assert.equal(first.xp, 25);
  assert.equal(first.observedCount, 1);
  assert.equal(first.feedbackCount, 1);
  for (let refresh = 0; refresh < 20; refresh++) assert.deepEqual(plain(buildLearningSummary(rows, NOW)), plain(first));
});

test('duplicate IDs count once and the latest persisted state wins in either input order', () => {
  const old = episode('same');
  const updated = { ...old, updated_at: '2026-10-12T10:00:00Z', state: 'invalidated' };
  for (const rows of [[old, old, old], [old, updated], [updated, old]]) {
    const summary = buildLearningSummary(rows, NOW);
    assert.equal(summary.recent.length, 1);
    assert.equal(summary.xp, rows.includes(updated) ? 0 : 20);
  }
});

test('duplicate timestamp conflicts and recent ordering are deterministic', () => {
  const variants = [episode('same'), episode('same', { state: 'invalidated' }), episode('a'), episode('b')];
  assert.deepEqual(plain(buildLearningSummary(variants, NOW)), plain(buildLearningSummary([...variants].reverse(), NOW)));
});

test('one underlying event cannot inflate XP or evidence counts through multiple missions', () => {
  const first = episode('first', { feedback: 'helpful', feedback_at: '2026-10-11T11:00:00Z' });
  const copy = episode('copy', { strategy: 'recovery_recent', resolved_at: '2026-10-11T12:00:00Z', updated_at: '2026-10-11T12:00:00Z', evidence: first.evidence, feedback: 'not_helpful', feedback_at: '2026-10-11T12:00:00Z' });
  const rows = [first, copy];
  const summary = buildLearningSummary(rows, NOW);
  assert.equal(summary.xp, 30);
  assert.equal(summary.observedCount, 1);
  assert.equal(summary.feedbackCount, 2);
  assert.equal(summary.lessons[0].observed, 1);
  assert.equal(summary.lessons[1].observed, 0);
  assert.deepEqual(plain(summary), plain(buildLearningSummary([...rows].reverse(), NOW)));
});

test('daily XP caps do not hide truthful observation or feedback counts', () => {
  const rows = Array.from({ length: 12 }, (_, i) => episode(`e-${i}`, { feedback: 'helpful', feedback_at: '2026-10-11T11:00:00Z' }));
  const summary = buildLearningSummary(rows, NOW);
  assert.equal(summary.xp, 100);
  assert.equal(summary.observedCount, 12);
  assert.equal(summary.feedbackCount, 12);
  assert.equal(summary.lessons[0].attempts, 12);
  assert.deepEqual(plain(summary), plain(buildLearningSummary([...rows].reverse(), NOW)));
});

test('XP day boundaries use Madrid, including the late UTC evening', () => {
  const beforeMidnight = Date.parse('2026-10-10T21:59:00Z');
  const afterMidnight = Date.parse('2026-10-10T22:01:00Z');
  const rows = [beforeMidnight, afterMidnight].flatMap((at, day) => Array.from({ length: 6 }, (_, i) => observedAt(`${day}-${i}`, at)));
  assert.equal(buildLearningSummary(rows, NOW).xp, 200);
  assert.equal(buildLearningSummary(rows, NOW).observedCount, 12);
});

test('future observations, missing evidence, and pre-attempt or late evidence earn no XP', () => {
  const rows = [
    episode('missing', { evidence: null }),
    episode('empty-id', { evidence: { id: '', kind: 'purchase', occurredAt: '2026-10-10T09:30:00Z', detail: 'Compra' } }),
    episode('before', { evidence: { id: 'p-before', kind: 'purchase', occurredAt: '2026-10-10T08:30:00Z', detail: 'Compra anterior' } }),
    episode('late', { evidence: { id: 'p-late', kind: 'purchase', occurredAt: '2026-10-11T10:30:00Z', detail: 'Compra fuera del plazo' } }),
    episode('future-resolution', { resolved_at: '2026-10-13T11:00:00Z' }),
    episode('bad-evidence', { evidence: { id: 'p-invalid', kind: 'purchase', occurredAt: 'invalid', detail: 'Compra' } }),
    observedAt('future-episode', NOW + DAY),
  ];
  const summary = buildLearningSummary(rows, NOW);
  assert.equal(summary.xp, 0);
  assert.equal(summary.observedCount, 0);
  assert.equal(summary.lessons[0].attempts, 0);
});

test('timezone-free and malformed observation timestamps are not interpreted using the browser timezone', () => {
  const rows = [episode('bad-tried', { tried_at: '2026-10-10T09:00:00' }), episode('bad-created', { created_at: 'never' }), episode('bad-resolved', { resolved_at: 'invalid' })];
  assert.equal(buildLearningSummary(rows, NOW).xp, 0);
  assert.equal(lesson(rows).attempts, 0);
});

test('ongoing attempts are neither failed observations nor XP farming actions', () => {
  const rows = [episode('ongoing', { state: 'trying', resolved_at: null, evidence: null, deadline_at: '2026-10-13T10:00:00Z' }), episode('overdue-awaiting-data', { state: 'trying', resolved_at: null, evidence: null })];
  const summary = buildLearningSummary(rows, NOW);
  assert.equal(summary.tryingCount, 2);
  assert.equal(summary.xp, 0);
  assert.equal(summary.lessons[0].attempts, 0);
  assert.equal(summary.lessons[0].noResult, 0);
});

test('no result needs a completed successful data observation after its deadline', () => {
  const rows = [
    episode('missing-data', { state: 'no_result', evidence: null }),
    episode('failed-data', { state: 'no_result', evidence: null, baseline: { observation_complete: false } }),
    episode('too-soon', { state: 'no_result', evidence: null, baseline: { observation_complete: true }, deadline_at: '2026-10-13T10:00:00Z' }),
    episode('complete', { state: 'no_result', evidence: null, baseline: { observation_complete: true } }),
  ];
  const summary = buildLearningSummary(rows, NOW);
  assert.equal(summary.lessons[0].attempts, 1);
  assert.equal(summary.lessons[0].noResult, 1);
  assert.equal(summary.lessons[0].adjustment, 0);
  assert.equal(summary.xp, 0);
});

test('fewer than five complete outcomes never change recovery priority', () => {
  for (let count = 1; count < 5; count++) {
    const value = lesson(Array.from({ length: count }, (_, i) => episode(`e-${i}`)));
    assert.equal(value.adjustment, 0);
    assert.equal(value.confidence, 'initial');
  }
});

test('five complete observations permit a modest change without claiming sales causation', () => {
  const rows = Array.from({ length: 5 }, (_, i) => episode(`e-${i}`));
  const value = lesson(rows);
  assert.equal(value.confidence, 'emerging');
  assert.ok(value.adjustment > 0 && value.adjustment < 0.2);
  assert.match(value.explanation, /no demuestra.*causara/);
  assert.match(value.nextStep, /seguir comprobando/);
});

test('three negative ratings reduce nuisance independently of unobserved outcomes', () => {
  const rows = Array.from({ length: 3 }, (_, i) => episode(`e-${i}`, { state: 'suggested', evidence: null, tried_at: null, feedback: 'not_helpful', feedback_at: '2026-10-11T11:00:00Z' }));
  assert.equal(lesson(rows.slice(0, 2)).adjustment, 0);
  const value = lesson(rows);
  assert.equal(value.attempts, 0);
  assert.equal(value.confidence, 'initial');
  assert.ok(value.adjustment < 0);
  assert.match(value.nextStep, /Reducir/);
  assert.equal(buildLearningSummary(rows, NOW).xp, 15);
});

test('positive ratings alone never manufacture successful recovery evidence', () => {
  const rows = Array.from({ length: 30 }, (_, i) => episode(`e-${i}`, { state: 'suggested', evidence: null, tried_at: null, feedback: 'helpful', feedback_at: '2026-10-11T11:00:00Z' }));
  assert.equal(lesson(rows).adjustment, 0);
  assert.equal(lesson(rows).observed, 0);
  assert.equal(lesson(rows).attempts, 0);
});

test('feedback timestamps must be present, after creation, and not future', () => {
  const rows = [null, 'invalid', '2026-10-09T10:00:00Z', '2026-10-13T10:00:00Z'].map((at, i) => episode(`e-${i}`, { state: 'suggested', feedback: 'helpful', feedback_at: at }));
  assert.equal(buildLearningSummary(rows, NOW).feedbackCount, 0);
  assert.equal(buildLearningSummary(rows, NOW).xp, 0);
});

test('changing a rating does not add a second feedback award for the same episode', () => {
  const positive = episode('same', { state: 'suggested', feedback: 'helpful', feedback_at: '2026-10-11T11:00:00Z' });
  const corrected = { ...positive, feedback: 'not_helpful', updated_at: '2026-10-12T10:00:00Z' };
  const summary = buildLearningSummary([positive, corrected], NOW);
  assert.equal(summary.xp, 5);
  assert.equal(summary.feedbackCount, 1);
  assert.equal(summary.lessons[0].helpful, 0);
  assert.equal(summary.lessons[0].notHelpful, 1);
});

test('old outcomes retain lifetime XP while strategies adapt only from the last 90 days', () => {
  const old = observedAt('old', NOW - 91 * DAY);
  const boundary = observedAt('boundary', NOW - 90 * DAY);
  const fresh = observedAt('fresh', NOW - DAY);
  const summary = buildLearningSummary([old, boundary, fresh], NOW);
  assert.equal(summary.xp, 60);
  assert.equal(summary.observedCount, 3);
  assert.equal(summary.lessons[0].attempts, 2);
});

test('level thresholds and within-level progress remain consistent as levels get harder', () => {
  const rows = Array.from({ length: 5 }, (_, day) => Array.from({ length: 5 }, (_, i) => observedAt(`${day}-${i}`, NOW - (day + 1) * DAY))).flat();
  const boundary = buildLearningSummary(rows.slice(0, 20), NOW);
  assert.equal(boundary.xp, 400);
  assert.equal(boundary.level, 3);
  assert.equal(boundary.levelXp, 0);
  assert.equal(boundary.progress, 0);
  const summary = buildLearningSummary(rows, NOW);
  assert.equal(summary.xp, 500);
  assert.equal(summary.level, 3);
  assert.equal(summary.levelXp, 100);
  assert.equal(summary.nextLevelXp, 500);
  assert.equal(summary.progress, 20);
});

test('strategy adjustments stay independent, bounded, and safe against malformed values', () => {
  const negatives = Array.from({ length: 100 }, (_, i) => episode(`e-${i}`, { state: 'no_result', evidence: null, baseline: { observation_complete: true }, feedback: 'not_helpful', feedback_at: '2026-10-11T11:00:00Z' }));
  const summary = buildLearningSummary(negatives, NOW);
  assert.equal(summary.lessons[0].confidence, 'supported');
  assert.equal(strategyAdjustment('recovery_loyal', summary.lessons), -0.2);
  assert.equal(strategyAdjustment('recovery_recent', summary.lessons), 0);
  assert.equal(strategyAdjustment('recovery_recent', []), 0);
  assert.equal(strategyAdjustment('recovery_loyal', [{ strategy: 'recovery_loyal', adjustment: Infinity }]), 0);
  assert.equal(strategyAdjustment('recovery_loyal', [{ strategy: 'recovery_loyal', adjustment: 999 }]), 0.2);
});

test('recent audit history contains at most 20 deterministic latest rows without mutating input', () => {
  const rows = Array.from({ length: 25 }, (_, i) => observedAt(`e-${String(i).padStart(2, '0')}`, NOW - (i + 1) * HOUR));
  const original = JSON.stringify(rows);
  const summary = buildLearningSummary(rows, NOW);
  assert.equal(summary.recent.length, 20);
  assert.equal(summary.recent[0].id, 'e-00');
  assert.equal(summary.recent.at(-1).id, 'e-19');
  assert.equal(JSON.stringify(rows), original);
  assert.deepEqual(plain(summary), plain(buildLearningSummary([...rows].reverse(), NOW)));
});
