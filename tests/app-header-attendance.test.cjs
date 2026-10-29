const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

function functionSource(file, names) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const name of names) assert.ok(found.has(name), `Real function ${name} exists`);
  return [...found.values()].join('\n') + names.map(name => `\nexports.${name} = ${name};`).join('');
}
function execute(source, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, Error, ...globals });
  return exports;
}
const transitions = execute(functionSource('src/app/api/attendance/event/route.ts', ['normalizeToDbEventType', 'nextStatusFromMeta']));
const handler = functionSource('src/components/AppHeader.tsx', ['cambiarEstado']);

function fixture(options = {}) {
  let presence = { online: true, status: 'working' }, persisted = { ...presence };
  const calls = [], delegated = [], toast = [], events = [], busy = [];
  let refreshed = 0;
  async function mutation(url, request) {
    calls.push({ url, request });
    const payload = JSON.parse(request.body);
    const normalized = transitions.normalizeToDbEventType(payload.event_type, {});
    const next = transitions.nextStatusFromMeta(normalized.event_type_db, normalized.meta_patch, persisted.status);
    const status = options.status || 200;
    if (status === 200 && !options.stateMissing) persisted = { online: next.is_online, status: next.status };
    return { ok: status === 200, status, json: async () => ({ ok: status === 200, state_updated: !options.stateMissing }) };
  }
  const code = execute(handler, {
    role: options.role || 'tarotista',
    sb: { auth: { getSession: async () => ({ data: { session: options.noSession ? null : { access_token: 'fixture-token' } } }) } },
    setEstadoLoading(value) { busy.push(value); },
    attendance: {
      async refreshAttendance() { refreshed++; presence = { ...persisted }; },
      async changeAttendance(eventType) {
        // Provider contract: one authenticated transition with session identity;
        // only a confirmed result updates the shared visible state.
        delegated.push(eventType);
        if (options.noSession) throw new Error('SESSION_REQUIRED');
        const response = await mutation('/api/attendance/event', { body: JSON.stringify({ event_type: eventType, session_id: 'fixture-session' }) });
        const result = await response.json();
        if (response.status === 401) throw new Error('SESSION_REQUIRED');
        if (!response.ok || !result.ok || result.state_updated === false) throw new Error('STATE_NOT_CONFIRMED');
        presence = { ...persisted };
      },
    },
    tcToast(value) { toast.push(value); },
    CustomEvent: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent(event) { events.push(event); } },
    fetch: mutation,
  });
  return { run: code.cambiarEstado, calls, delegated, toast, events, busy, get presence() { return presence; }, get refreshed() { return refreshed; } };
}

test('the actual Descanso handler persists a break and reconnecting resumes working without an extra attendance write', async () => {
  const f = fixture();
  await f.run('break');
  assert.equal(JSON.parse(f.calls[0].request.body).event_type, 'break_start');
  assert.deepEqual(f.presence, { online: true, status: 'break' });
  assert.equal(f.presence.online && f.presence.status === 'working', false);
  assert.equal(f.events.length, 1); assert.equal(f.refreshed, 1); assert.equal(f.toast.length, 0);
  await f.run('online');
  assert.deepEqual(f.presence, { online: true, status: 'working' });
  await f.run('offline');
  assert.deepEqual(f.presence, { online: false, status: 'offline' });
  assert.equal(f.calls.length, 3); assert.equal(f.events.length, 3);
});

test('rejected or unpersisted attendance changes leave the visible state intact and show an error', async () => {
  for (const options of [{ status: 503 }, { status: 403 }, { status: 401 }, { stateMissing: true }]) {
    const f = fixture(options); await f.run('break');
    assert.deepEqual(f.presence, { online: true, status: 'working' });
    assert.equal(f.refreshed, 0); assert.equal(f.events.length, 0); assert.equal(f.toast.length, 1);
    assert.equal(f.toast[0].tone, 'error'); assert.deepEqual(f.busy, [true, false]);
  }
});

test('missing authentication shows the session error without sending an attendance mutation', async () => {
  for (const role of ['tarotista', 'central', 'admin']) {
    const f = fixture({ noSession: true, role }); await f.run('break');
    assert.equal(f.calls.length, 0); assert.equal(f.refreshed, 0); assert.equal(f.events.length, 0);
    assert.match(f.toast[0].description, /sesión ha caducado/); assert.deepEqual(f.busy, [true, false]);
  }
});

test('central and admin use the shared session transition without duplicate writes or refreshes', async () => {
  for (const role of ['central', 'admin']) {
    const f = fixture({ role });
    await f.run('break');
    assert.deepEqual(f.presence, { online: true, status: 'break' });
    await f.run('online');
    assert.deepEqual(f.presence, { online: true, status: 'working' });
    await f.run('offline');
    assert.deepEqual(f.presence, { online: false, status: 'offline' });
    assert.deepEqual(f.delegated, ['break_start', 'online', 'offline']);
    assert.equal(f.calls.length, 3);
    assert.equal(JSON.parse(f.calls[0].request.body).session_id, 'fixture-session');
    assert.equal(f.refreshed, 0); assert.equal(f.events.length, 0); assert.equal(f.toast.length, 0);
  }
});

test('a rejected shared transition preserves the current state and the header reports it', async () => {
  for (const options of [{ status: 503 }, { status: 403 }, { status: 401 }, { stateMissing: true }]) {
    const f = fixture({ ...options, role: 'central' }); await f.run('break');
    assert.deepEqual(f.presence, { online: true, status: 'working' });
    assert.equal(f.refreshed, 0); assert.equal(f.events.length, 0); assert.equal(f.toast.length, 1);
    assert.equal(f.toast[0].tone, 'error'); assert.deepEqual(f.busy, [true, false]);
    if (options.status === 401) assert.match(f.toast[0].description, /sesión ha caducado/);
  }
});
