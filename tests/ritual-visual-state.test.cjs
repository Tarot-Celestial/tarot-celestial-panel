const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const helpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/cliente/ritual/ritual-visual-state.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: helpers });
const state = (overrides = {}) => helpers.ritualVisualState({ state: 'activo', count: 4, current: 0, progress: 0, ...overrides });

test('four- and five-phase catalogues keep their recorded phase and reserve culmination for completion', () => {
  assert.deepEqual(Array.from({ length: 4 }, (_, current) => state({ current }).frame), [0, 1, 3, 4]);
  assert.deepEqual(Array.from({ length: 5 }, (_, current) => state({ count: 5, current }).frame), [0, 1, 2, 3, 4]);
  assert.equal(state({ current: 3, progress: 100 }).frame, 4);
  assert.ok(state({ current: 3, progress: 100, phaseFrom: 80, phaseTo: 100 }).energy < 1);
  assert.deepEqual({ ...state({ state: 'completado' }) }, { frame: 5, energy: 1 });
});

test('manual phase overrides are not erased by a contradictory progress percentage', () => {
  const early = state({ current: 0, progress: 100, phaseFrom: 0, phaseTo: 25 });
  assert.equal(early.frame, 0);
  assert.ok(early.energy < .2);
  assert.equal(state({ current: 3, progress: 0, phaseFrom: 80, phaseTo: 100 }).frame, 4);
});

test('glow advances gently within the same phase without advancing the artwork', () => {
  const a = state({ current: 1, progress: 25, phaseFrom: 25, phaseTo: 50 });
  const b = state({ current: 1, progress: 49, phaseFrom: 25, phaseTo: 50 });
  assert.equal(a.frame, b.frame);
  assert.ok(b.energy > a.energy && b.energy - a.energy < .08);
});

test('pause keeps the exact recorded appearance while pending and cancelled stay dormant', () => {
  const args = { current: 2, progress: 66, phaseFrom: 50, phaseTo: 80 };
  assert.deepEqual({ ...state({ ...args, state: 'pausado' }) }, { ...state(args) });
  for (const status of ['pendiente', 'cancelado']) {
    const dormant = state({ ...args, state: status });
    assert.equal(dormant.frame, 0);
    assert.ok(dormant.energy < .05);
  }
});

test('missing or malformed phase data always yields finite bounded visuals', () => {
  for (const count of [0, -1, NaN, Infinity, undefined, 1, 999]) {
    for (const current of [-3, NaN, Infinity, undefined, 999]) {
      const result = state({ count, current, progress: NaN, phaseFrom: Infinity, phaseTo: -1 });
      assert.ok(Number.isInteger(result.frame) && result.frame >= 0 && result.frame <= 4);
      assert.ok(Number.isFinite(result.energy) && result.energy >= 0 && result.energy < 1);
    }
  }
});

test('the last completed ritual is chosen by closing date rather than creation order', () => {
  const olderCreation = { id: 'a', estado: 'completado', created_at: '2026-10-01T10:00:00Z', fecha_fin_real: '2026-10-12T10:00:00Z' };
  const newerCreation = { id: 'b', estado: 'completado', created_at: '2026-10-05T10:00:00Z', fecha_fin_real: '2026-10-10T10:00:00Z' };
  assert.equal(helpers.latestCompletedRitual([newerCreation, olderCreation]), olderCreation);
  assert.equal(helpers.latestCompletedRitual([olderCreation, newerCreation]), olderCreation);
});

test('a valid closing date wins over absent or malformed dates even with newer creation dates', () => {
  const valid = { id: 'a', estado: 'completado', fecha_fin_real: '2026-10-01T10:00:00Z' };
  const legacy = [undefined, null, '', 'not-a-date', '2026-99-99'].map((fecha_fin_real, index) => ({
    id: `legacy-${index}`, estado: 'completado', fecha_fin_real, created_at: '2026-10-13T10:00:00Z',
  }));
  assert.equal(helpers.latestCompletedRitual([...legacy, valid]), valid);
});

test('without a valid closing date, creation date and then ID resolve the selection', () => {
  const older = { id: 'z', estado: 'completado', fecha_fin_real: 'invalid', created_at: '2026-10-10T10:00:00Z' };
  const latest = { id: 'b', estado: 'completado', created_at: '2026-10-12T10:00:00Z' };
  const sameCreation = { ...latest, id: 'a', fecha_fin_real: null };
  const noValidDates = { id: 'zz', estado: 'completado', fecha_fin_real: '', created_at: 'invalid' };
  assert.equal(helpers.latestCompletedRitual([noValidDates, sameCreation, latest, older]), latest);
  assert.equal(helpers.latestCompletedRitual([older, latest, sameCreation, noValidDates]), latest);
  assert.equal(helpers.latestCompletedRitual([{ id: 'a', estado: 'completado' }, noValidDates]), noValidDates);
});

test('equal valid closing dates use deterministic creation and ID tie breakers', () => {
  const older = { id: 'z', estado: 'completado', fecha_fin_real: '2026-10-12T10:00:00Z', created_at: '2026-10-01T10:00:00Z' };
  const winner = { ...older, id: 'b', created_at: '2026-10-05T10:00:00Z' };
  const sameDates = { ...winner, id: 'a' };
  assert.equal(helpers.latestCompletedRitual([older, sameDates, winner]), winner);
  assert.equal(helpers.latestCompletedRitual([winner, sameDates, older]), winner);
});

test('non-completed states are excluded and empty or non-completed histories return undefined', () => {
  const others = ['activo', 'pausado', 'pendiente', 'cancelado'].map((estado, index) => ({
    id: String(index), estado, created_at: '2026-10-13T10:00:00Z', fecha_fin_real: '2026-10-13T10:00:00Z',
  }));
  const completed = { id: 'old', estado: 'completado' };
  assert.equal(helpers.latestCompletedRitual([...others, completed]), completed);
  assert.equal(helpers.latestCompletedRitual(others), undefined);
  assert.equal(helpers.latestCompletedRitual([]), undefined);
});

test('selection preserves the input history, records, and selected record identity', () => {
  const first = Object.freeze({ id: 'a', estado: 'completado', fecha_fin_real: '2026-10-10T10:00:00Z', title: 'First' });
  const last = Object.freeze({ id: 'b', estado: 'completado', fecha_fin_real: '2026-10-12T10:00:00Z', title: 'Last' });
  const history = Object.freeze([first, last]);
  const snapshot = JSON.stringify(history);
  assert.equal(helpers.latestCompletedRitual(history), last);
  assert.equal(JSON.stringify(history), snapshot);
  assert.equal(history[0], first);
  assert.equal(history[1], last);
});
