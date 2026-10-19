const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');

function evaluate(file, imports = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in imports ? imports[name] : require(name), Date, Intl, AbortController, Event, URLSearchParams, console, ...globals });
  return exports;
}
const shared = evaluate('src/lib/recovery-mission.ts');
const snapshot = overrides => ({
  enabled: true, worker_id: 'worker-isa', server_now: '2026-10-19T15:40:00Z', timezone: 'America/Guayaquil', day: '2026-10-19',
  is_workday: true, active: true, starts_at: '2026-10-19T12:00:00Z', ends_at: '2026-10-19T20:00:00Z', notice_at: '2026-10-19T15:00:00Z',
  target: 30, managed: 0, recovered: 0, recovery_target: 5, management_bonus: 10, recovery_bonus: 200,
  management_bonus_awarded: false, recovery_bonus_awarded: false, awarded_xp: 0, assigned_client_ids: [], expected_managed: 4,
  next_checkpoint_at: '2026-10-19T16:20:00Z', ...overrides,
});

test('red indicator waits 40 minutes after the server notice and clears when the real pace recovers', () => {
  assert.equal(shared.recoveryMissionPhase(snapshot({ server_now: '2026-10-19T15:39:59Z' })), 'active');
  assert.equal(shared.recoveryMissionPhase(snapshot()), 'behind');
  assert.equal(shared.recoveryMissionPhase(snapshot({ managed: 4 })), 'active');
  assert.equal(shared.recoveryMissionPhase(snapshot({ managed: 30 })), 'complete');
});

test('weekends, pre-shift, pre-notice, ended shifts and unavailable snapshots never create a red indicator', () => {
  assert.equal(shared.recoveryMissionPhase(snapshot({ is_workday: false })), 'rest');
  assert.equal(shared.recoveryMissionPhase(snapshot({ server_now: '2026-10-19T11:59:59Z', active: false })), 'before_shift');
  assert.equal(shared.recoveryMissionPhase(snapshot({ server_now: '2026-10-19T14:59:59Z' })), 'before_notice');
  assert.equal(shared.recoveryMissionPhase(snapshot({ server_now: '2026-10-19T20:00:00Z', active: false })), 'ended');
  assert.equal(shared.recoveryMissionPhase(null), 'unavailable');
  assert.equal(shared.recoveryMissionPhase({ enabled: false }), 'disabled');
});

test('the afternoon shift uses its own notice and its Ecuador day across UTC midnight', () => {
  const maria = snapshot({ worker_id: 'worker-maria', starts_at: '2026-10-19T20:00:00Z', notice_at: '2026-10-19T20:00:00Z', ends_at: '2026-10-20T04:00:00Z', server_now: '2026-10-19T20:39:59Z' });
  assert.equal(shared.recoveryMissionPhase(maria), 'active');
  assert.equal(shared.recoveryMissionPhase({ ...maria, server_now: '2026-10-20T00:00:00Z' }), 'behind');
  assert.equal(shared.recoveryMissionTime(maria.ends_at), '23:00');
});

test('progress does not manufacture XP or treat five recoveries as thirty contacts', () => {
  const five = snapshot({ recovered: 5, recovery_bonus_awarded: true, awarded_xp: 575 });
  const parsed = shared.parseRecoveryMission(five, 'worker-isa');
  assert.equal(parsed.awarded_xp, 575); assert.equal(parsed.management_bonus_awarded, false);
  assert.equal(shared.recoveryMissionPhase(parsed), 'behind');
  assert.match(shared.recoveryMissionMessage(snapshot({ managed: 30 })), /aún no está confirmada/);
  assert.match(shared.recoveryMissionMessage(snapshot({ managed: 30, management_bonus_awarded: true })), /10 XP registrados/);
});

test('missing or malformed counts and mismatched workers fail closed instead of displaying fake zeroes', () => {
  for (const change of [{ managed: undefined }, { managed: -1 }, { recovered: '5' }, { awarded_xp: NaN }, { server_now: 'bad-date' }, { notice_at: '2026-10-19T21:00:00Z' }]) {
    assert.throws(() => shared.parseRecoveryMission(snapshot(change)), /verificar la misión/);
  }
  assert.throws(() => shared.parseRecoveryMission(snapshot(), 'worker-maria'), /verificar la misión/);
});

function fixture() {
  const events = new Map(), timers = new Map(), calls = [];
  let latest, tree, authCallback, sequence = 0, responseMission = snapshot(), failure = false, waitForResponse;
  let session = { access_token: 'test-token', user: { id: 'user-isa' } };
  const document = { hidden: false, addEventListener(name, fn) { events.set(`document:${name}`, fn); }, removeEventListener(name) { events.delete(`document:${name}`); } };
  const window = {
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); },
    dispatchEvent(event) { events.get(event.type)?.(event); return true; },
    setTimeout(fn, delay) { timers.set(++sequence, { fn, delay, interval: false }); return sequence; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { timers.set(++sequence, { fn, delay, interval: true }); return sequence; }, clearInterval(id) { timers.delete(id); },
  };
  const auth = { getSession: async () => ({ data: { session } }), onAuthStateChange(fn) { authCallback = fn; return { data: { subscription: { unsubscribe() {} } } }; } };
  const fetch = async (_url, init) => {
    calls.push(init);
    const body = JSON.parse(JSON.stringify(responseMission)), failed = failure, blocked = waitForResponse;
    if (blocked) await blocked;
    return { ok: !failed, json: async () => failed ? { ok: false, error: 'RPC no disponible' } : { ok: true, mission: body } };
  };
  const { useRecoveryMission } = evaluate('src/features/central/assistant/useRecoveryMission.ts', {
    '@/lib/recovery-mission': shared, '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth }) },
  }, { window, document, fetch });
  function Component() { latest = useRecoveryMission({ workerId: 'worker-isa' }); return null; }
  const act = async fn => renderer.act(async () => { fn(); await new Promise(resolve => setImmediate(resolve)); });
  return {
    calls, timers, events, get state() { return latest; },
    async mount() { await act(() => { tree = renderer.create(React.createElement(Component)); }); },
    async unmount() { await act(() => tree.unmount()); },
    async event(name) { await act(() => events.get(name)?.(new Event(name))); },
    async tick() { await act(() => { for (const timer of [...timers.values()]) if (timer.interval) timer.fn(); }); },
    async prepare() { await act(() => { void latest.prepare(); }); },
    async signOut() { await act(() => { session = null; authCallback('SIGNED_OUT', null); }); },
    async settle() { await act(() => {}); },
    setMission(value) { responseMission = value; }, fail(value) { failure = value; }, block(promise) { waitForResponse = promise; },
  };
}

test('a mission RPC failure clears visible counters, and a later successful refresh restores real data', async () => {
  const f = fixture(); await f.mount(); assert.equal(f.state.mission.managed, 0);
  f.fail(true); await f.tick(); assert.equal(f.state.mission, null); assert.match(f.state.error, /RPC no disponible/);
  f.fail(false); f.setMission(snapshot({ managed: 17 })); await f.event('focus');
  assert.equal(f.state.mission.managed, 17); assert.equal(f.state.error, '');
  await f.unmount(); assert.equal(f.timers.size, 0); assert.equal(f.events.size, 0);
});

test('a refresh event discards an older response after a client management and signing out clears the mission', async () => {
  const f = fixture(); await f.mount();
  let release; f.block(new Promise(resolve => { release = resolve; })); await f.tick();
  f.block(null); f.setMission(snapshot({ managed: 9 })); await f.event(shared.RECOVERY_MISSION_REFRESH);
  release(); await f.settle(); assert.equal(f.state.mission.managed, 9);
  await f.signOut(); assert.equal(f.state.mission, null);
  await f.unmount();
});

test('preparing reserves server-returned contacts and never credits imaginary activity', async () => {
  const f = fixture(); await f.mount();
  f.setMission(snapshot({ assigned_client_ids: ['one', 'two'] })); await f.prepare();
  const request = f.calls.find(call => call.method === 'POST');
  assert.deepEqual(JSON.parse(request.body), { action: 'prepare' });
  assert.equal(f.state.mission.assigned_client_ids.length, 2);
  assert.equal(f.state.mission.managed, 0); assert.equal(f.state.mission.awarded_xp, 0);
  await f.unmount();
});

test('disconnecting clears pace indicators until the mission can be verified again', async () => {
  const f = fixture(); await f.mount(); assert.equal(shared.recoveryMissionPhase(f.state.mission), 'behind');
  await f.event('offline'); assert.equal(f.state.mission, null); assert.match(f.state.error, /Sin conexión/);
  f.setMission(snapshot({ managed: 7 })); await f.event('online'); assert.equal(shared.recoveryMissionPhase(f.state.mission), 'active');
  await f.unmount();
});

function panelFixture() {
  const requests = [], events = new Map(); let tree, rejectPost = true, ids = 0;
  const contact = { id: 'client-one', nombre: 'Cliente prueba', telefono: '+34123456789', tags: [], status: 'pending', version: 0, responsible_id: null, responsible_name: null, contacted_at: null, updated_at: null, recovered_at: null, payment_id: null, purchase_amount: null, xp: 0 };
  const mission = snapshot({ assigned_client_ids: ['client-one'] });
  const window = { addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); }, dispatchEvent(event) { events.get(event.type)?.(event); } };
  const document = { hidden: false, activeElement: null, body: { style: { overflow: '' } }, addEventListener() {}, removeEventListener() {} };
  const Component = evaluate('src/features/central/ClientRecoveryPanel.tsx', {
    '@/lib/recovery-mission': shared,
    '@/lib/client-recovery': { recoveryLabels: { pending: 'Pendiente', contacted: 'Contactada' } },
    '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } }) },
    './assistant/useRecoveryMission': { useRecoveryMission: () => ({ mission, loading: false, error: '', preparing: false, refresh() {}, async prepare() {} }) },
    './ClientRecoveryPanel.module.css': { default: new Proxy({}, { get: (_target, key) => key }) },
    './RecoveryMessageComposer': { default: () => null },
    'lucide-react': new Proxy({}, { get: (_target, key) => props => React.createElement('span', { ...props, 'data-icon': key }) }),
  }, {
    window, document, setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: { randomUUID: () => `operation-${++ids}` },
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      if (init.method === 'POST') return { ok: !rejectPost, json: async () => rejectPost ? { ok: false, error: 'Reintenta la gestión' } : { ok: true, status: 'contacted' } };
      return { ok: true, json: async () => ({ ok: true, contacts: [contact], total: 1, counts: { pending: 1, recycled: 0, recovered: 0 }, tags: [] }) };
    },
  }).default;
  const act = async fn => renderer.act(async () => { fn(); await new Promise(resolve => setImmediate(resolve)); });
  const button = text => tree.root.findAllByType('button').find(node => node.children.includes(text));
  return {
    requests, get tree() { return tree; }, button,
    async mount() { await act(() => { tree = renderer.create(React.createElement(Component)); }); },
    async click(text) { await act(() => button(text).props.onClick()); },
    async channel(value) { await act(() => tree.root.findByProps({ 'aria-label': 'Canal utilizado para contactar' }).props.onChange({ target: { value } })); },
    accept() { rejectPost = false; },
    async unmount() { await act(() => tree.unmount()); },
  };
}

test('contact registration requires a channel and retries the same operation without a second request identity', async () => {
  const f = panelFixture(); await f.mount();
  try {
    await f.click('Fue contactada'); assert.equal(f.button('Guardar gestión').props.disabled, true);
    await f.channel('whatsapp'); assert.equal(f.button('Guardar gestión').props.disabled, false);
    await f.click('Guardar gestión'); f.accept(); await f.click('Guardar gestión');
    const posts = f.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body));
    assert.equal(posts.length, 2); assert.equal(posts[0].channel, 'whatsapp');
    assert.equal(posts[0].request_id, posts[1].request_id); assert.equal(posts[0].client_id, 'client-one');
  } finally { await f.unmount(); }
});

test('My mission requests a server-filtered page rather than filtering the current 25 rows in the browser', async () => {
  const f = panelFixture(); await f.mount();
  try {
    await f.click('Ver mi misión'); const last = f.requests.at(-1);
    assert.match(last.url, /mission=1/); assert.match(last.url, /page=1/);
  } finally { await f.unmount(); }
});

test('a state-only mutation also keeps an operation id across retries without inventing a contact channel', async () => {
  const f = panelFixture(); await f.mount();
  try {
    await f.click('Enviar a reciclaje'); await f.click('Guardar gestión');
    f.accept(); await f.click('Guardar gestión');
    const posts = f.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body));
    assert.equal(posts.length, 2); assert.equal(posts[0].action, 'recycled'); assert.ok(posts[0].request_id);
    assert.equal(posts[0].request_id, posts[1].request_id); assert.equal(posts[0].channel, undefined);
  } finally { await f.unmount(); }
});
