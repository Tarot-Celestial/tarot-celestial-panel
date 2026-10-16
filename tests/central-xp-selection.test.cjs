const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/central/useCentralXpData.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

// Execute the actual hook with React-like effect cleanup ordering and deliberately
// late network responses. No credentials or production services are involved.
function mount({ date = '2026-10-16', enabled = true, deferSession = false } = {}) {
  const slots = [], requests = [], sessions = [], timers = new Map(), exportsObject = {};
  let cursor = 0, dirty = false, result, pendingEffects = [], disposed = false, writesAfterDispose = 0, nextTimer = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        if (disposed) writesAfterDispose++;
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: fn, deps };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) {
        pendingEffects.push({ index, fn, oldCleanup: slots[index]?.cleanup });
        slots[index] = { deps, effect: true };
      }
    },
  };
  const schedule = fn => { timers.set(++nextTimer, fn); return nextTimer; };
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const window = { setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: schedule, clearInterval: id => timers.delete(id), addEventListener() {}, removeEventListener() {} };
  const sessionResult = { data: { session: { access_token: 'test-only' } } };
  const sb = {
    auth: { getSession: () => deferSession ? new Promise(resolve => sessions.push(resolve)) : Promise.resolve(sessionResult) },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    async removeChannel() {},
  };
  vm.runInNewContext(source, {
    exports: exportsObject, AbortController, Date, Set, console, window, document,
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    require: name => {
      if (name === 'react') return react;
      if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => sb };
      if (name === '@/lib/tc-toast') return { tcToast() {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    cursor = 0; dirty = false; pendingEffects = [];
    result = exportsObject.useCentralXpData(date, enabled);
    const effects = pendingEffects;
    effects.forEach(effect => effect.oldCleanup?.());
    effects.forEach(effect => { slots[effect.index].cleanup = effect.fn(); });
  };
  render();
  return {
    requests, sessions,
    get result() { return result; },
    get writesAfterDispose() { return writesAfterDispose; },
    async flush() { for (let i = 0; i < 6; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty && !disposed) render(); } },
    update(nextDate, nextEnabled = true) { date = nextDate; enabled = nextEnabled; render(); },
    complete(index, selectedDate = date, xp = 10) {
      requests[index].resolve({ ok: true, async json() { return {
        ok: true, worker: { id: 'isa', name: 'Isa' }, missions: { active: [] },
        daily_activity: { date: selectedDate, total_xp: xp },
      }; } });
    },
    fail(index) { requests[index].resolve({ ok: false, async json() { return { ok: false, error: 'Consulta no disponible' }; } }); },
    resolveSession(index) { sessions[index](sessionResult); },
    dispose() { slots.filter(slot => slot?.effect).forEach(slot => slot.cleanup?.()); disposed = true; },
  };
}

test('disabled lazy tab does not read; enabling fetches the selected day', async () => {
  const m = mount({ enabled: false });
  try {
    await m.flush(); assert.equal(m.requests.length, 0);
    m.update('2026-10-15'); await m.flush(); assert.equal(m.requests.length, 1);
    assert.match(m.requests[0].url, /date=2026-10-15/);
    m.complete(0); await m.flush(); assert.equal(m.result.data.daily_activity.date, '2026-10-15');
  } finally { m.dispose(); }
});

test('changing date aborts the old read, hides old data and cannot be overwritten by its late reply', async () => {
  const m = mount();
  try {
    await m.flush(); m.complete(0, '2026-10-16', 30); await m.flush();
    void m.result.load(true); await m.flush(); assert.equal(m.requests.length, 2);
    assert.equal(m.result.data.daily_activity.total_xp, 30);
    m.update('2026-10-15'); await m.flush();
    assert.equal(m.requests[1].options.signal.aborted, true);
    assert.equal(m.requests.length, 3); assert.match(m.requests[2].url, /date=2026-10-15/);
    assert.equal(m.result.data, null); assert.equal(m.result.lastSyncedAt, null); assert.equal(m.result.busy, true);
    m.complete(1, '2026-10-16', 999); await m.flush();
    assert.equal(m.result.data, null); assert.equal(m.result.busy, true);
    m.complete(2, '2026-10-15', 17); await m.flush();
    assert.equal(m.result.data.daily_activity.total_xp, 17); assert.equal(m.result.busy, false);
  } finally { m.dispose(); }
});

test('a failed selected-day read never falls back to another day as a zero or stale graph', async () => {
  const m = mount();
  try {
    await m.flush(); m.complete(0); await m.flush();
    m.update('2026-10-14'); await m.flush(); m.fail(1); await m.flush();
    assert.equal(m.result.data, null); assert.equal(m.result.busy, false);
    assert.equal(m.result.syncStatus, 'error'); assert.equal(m.result.error, 'Consulta no disponible');
  } finally { m.dispose(); }
});

test('same-day refreshes share one request and retain visible data', async () => {
  const m = mount();
  try {
    await m.flush(); m.complete(0); await m.flush();
    void m.result.load(true); void m.result.load(true); await m.flush();
    assert.equal(m.requests.length, 2); assert.equal(m.result.data.daily_activity.total_xp, 10);
    assert.equal(m.result.busy, false);
    m.complete(1, '2026-10-16', 22); await m.flush();
    assert.equal(m.result.data.daily_activity.total_xp, 22);
  } finally { m.dispose(); }
});

test('a date change before auth resolves does not send a stale date request', async () => {
  const m = mount({ deferSession: true });
  try {
    assert.equal(m.sessions.length, 1);
    m.update('2026-10-13'); assert.equal(m.sessions.length, 2);
    m.resolveSession(0); await m.flush(); assert.equal(m.requests.length, 0);
    m.resolveSession(1); await m.flush(); assert.equal(m.requests.length, 1);
    assert.match(m.requests[0].url, /date=2026-10-13/);
    m.complete(0); await m.flush(); assert.equal(m.result.data.daily_activity.date, '2026-10-13');
  } finally { m.dispose(); }
});

test('leaving the lazy tab or unmounting aborts reads and ignores their late responses', async () => {
  const m = mount(); await m.flush(); m.update('2026-10-16', false); await m.flush();
  assert.equal(m.requests[0].options.signal.aborted, true); assert.equal(m.result.busy, false);
  m.complete(0); await m.flush(); assert.equal(m.result.data, null);
  m.update('2026-10-16'); await m.flush(); m.dispose();
  assert.equal(m.requests[1].options.signal.aborted, true);
  m.complete(1); await m.flush(); assert.equal(m.writesAfterDispose, 0);
});
