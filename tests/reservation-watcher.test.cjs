const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const due = Date.parse('2026-10-16T18:00:00Z');
const row = () => ({ id: 'reservation-a', fecha_reserva: '2026-10-16T18:00:00', cliente_nombre: 'Prueba local', estado: 'pendiente', deleted_at: null, tarotista_id: 'tarotist-a', notify_when_tarotista_idle: true });

function fixture(options = {}) {
  let clock = options.now ?? due, tree, realtime, authCallback, session = { access_token: 'local-token' }, nextTimer = 0;
  let blockedList, blockedReady, ownDeliveryEvent = false;
  const storage = options.storage || new Map();
  const localStorage = {getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value)};
  const records = [row()], readyRows = [], calls = [], listeners = new Map(), intervals = new Map();
  class Clock extends Date { constructor(value) { super(arguments.length ? value : clock); } static now() { return clock; } }
  const document = { visibilityState: 'visible', addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) };
  const window = {
    ...document,
    setInterval(cb, delay) { intervals.set(++nextTimer, { cb, delay }); return nextTimer; },
    clearInterval: id => intervals.delete(id),
    setTimeout() { return ++nextTimer; }, clearTimeout() {},
  };
  const sb = {
    auth: { getSession: async () => ({ data: { session } }), onAuthStateChange(cb) { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; } },
    channel() { const c = { on(_type, _options, cb) { realtime = cb; return c; }, subscribe() { return c; } }; return c; },
    removeChannel() {},
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const fetch = async url => {
    calls.push(url);
    const isList = url.includes('/listar');
    const snapshot = clone(isList ? records : readyRows);
    if (isList && blockedList) await blockedList;
    if (!isList && blockedReady) await blockedReady;
    if (!isList && ownDeliveryEvent) {
      ownDeliveryEvent = false;
      realtime({ eventType: 'UPDATE', new: { ...records[0], ready_notified_at: new Date(clock).toISOString() }, old: { id: records[0].id } });
    }
    return { ok: true, json: async () => ({ ok: true, reservas: snapshot, serverNow: new Date(clock).toISOString() }) };
  };
  function load(file) {
    const filename = path.resolve(__dirname, '..', file), exports = {};
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(output, { exports, Date: Clock, AbortController, window, document, localStorage, fetch, console, require(name) {
      if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => sb };
      if (name === './ReservationAdvanceNotice') return { default: () => null };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
      if (name === 'lucide-react') return new Proxy({}, { get: (_, name) => props => React.createElement('span', { ...props, 'data-icon': name }) });
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name + '.ts')));
      return require(name);
    } });
    return exports;
  }
  const Component = load('src/components/reservas/ReservasGlobalWatcher.tsx').default;
  const act = async cb => renderer.act(async () => { cb(); await new Promise(resolve => setImmediate(resolve)); });
  return {
    records, readyRows, calls, storage,
    async dismiss() { await act(() => tree.root.findAllByType("button").find(node => node.props["aria-label"] === "Cerrar aviso").props.onClick()); },
    get title() { return tree?.root.findAllByType('h2').map(node => node.children.join('')).join('') || ''; },
    async mount() { await act(() => { tree = renderer.create(React.createElement(Component)); }); },
    async unmount() { await act(() => tree.unmount()); },
    async tick(delay) { await act(() => { for (const timer of intervals.values()) if (timer.delay === delay) timer.cb(); }); },
    async change(newRow, type = 'UPDATE') { await act(() => realtime({ eventType: type, new: newRow || {}, old: { id: 'reservation-a' } })); },
    async localChange(detail) { await act(() => listeners.get('tc-reservation-changed')?.({ detail })); },
    async signOut() { await act(() => { session = null; authCallback('SIGNED_OUT'); }); },
    async settle() { await act(() => {}); },
    setClock(value) { clock = value; }, blockList(value) { blockedList = value; }, blockReady(value) { blockedReady = value; }, ownReadyEvent() { ownDeliveryEvent = true; },
  };
}

test('watcher shows nothing at 19:25 or 19:59:59 and shows the due reservation at 20:00', async () => {
  const f = fixture({ now: Date.parse('2026-10-16T17:25:16Z') });
  await f.mount();
  assert.equal(f.title, '');
  f.setClock(due - 1); await f.tick(15000); await f.tick(1000);
  assert.equal(f.title, '');
  f.setClock(due); await f.tick(1000);
  assert.equal(f.title, 'Es hora de la reserva');
  await f.unmount();
});

test('realtime cancellation/deletion immediately removes an already displayed popup', async () => {
  for (const change of [{ estado: 'cancelada' }, { deleted_at: '2026-10-16T18:00:01Z' }]) {
    const f = fixture();
    await f.mount(); assert.ok(f.title);
    Object.assign(f.records[0], change);
    await f.change(f.records[0]);
    assert.equal(f.title, '');
    await f.tick(1000); assert.equal(f.title, '');
    await f.unmount();
  }
});

test('local delete and hard-delete events remove the popup without waiting for another polling cycle', async () => {
  for (const kind of ['local', 'realtime']) {
    const f = fixture(); await f.mount();
    f.records.length = 0;
    if (kind === 'local') await f.localChange({ id: 'reservation-a' });
    else await f.change(null, 'DELETE');
    assert.equal(f.title, '');
    await f.unmount();
  }
});

test('rescheduling hides the old popup and allows a new popup at the new time', async () => {
  const f = fixture(); await f.mount();
  f.records[0].fecha_reserva = '2026-10-16T19:00:00';
  await f.change(f.records[0]); assert.equal(f.title, '');
  f.setClock(due + 3600000); await f.tick(15000); await f.tick(1000);
  assert.equal(f.title, 'Es hora de la reserva');
  await f.unmount();
});

test('a delayed schedule response cannot restore a reservation after realtime deletion', async () => {
  const f = fixture();
  let release;
  f.blockList(new Promise(resolve => { release = resolve; }));
  await f.mount();
  f.blockList(null); f.records.length = 0;
  await f.change(null, 'DELETE');
  release(); await f.settle();
  assert.equal(f.title, '');
  await f.unmount();
});

test('a delayed ready response cannot restore a cancelled or signed-out popup', async () => {
  for (const kind of ['cancel', 'signout']) {
    const f = fixture({ now: due + 60000 });
    f.readyRows.push(row());
    let release; f.blockReady(new Promise(resolve => { release = resolve; }));
    await f.mount();
    if (kind === 'cancel') { f.records[0].estado = 'cancelada'; await f.change(f.records[0]); }
    else await f.signOut();
    release(); await f.settle();
    assert.equal(f.title, '');
    await f.unmount();
  }
});

test('the ready claim own realtime timestamp does not discard the claimed availability popup', async () => {
  const f = fixture({ now: due + 60000 });
  f.readyRows.push(row()); f.ownReadyEvent();
  await f.mount();
  assert.equal(f.title, 'Tarotista disponible');
  await f.unmount();
});

test('a malformed early ready response still cannot show availability before the scheduled time', async () => {
  const f = fixture({ now: due - 60000 });
  f.readyRows.push(row()); await f.mount();
  assert.equal(f.title, '');
  await f.unmount();
});

test('a scheduled popup cannot take the display slot while a ready alert is being claimed', async () => {
  const f = fixture({ now: due + 60000 });
  f.records.push({ ...row(), id: 'reservation-b', fecha_reserva: '2026-10-16T18:01:05' });
  f.readyRows.push(row());
  let release; f.blockReady(new Promise(resolve => { release = resolve; }));
  await f.mount();
  f.setClock(due + 65000); await f.tick(1000);
  assert.equal(f.title, '');
  release(); await f.settle();
  assert.equal(f.title, 'Tarotista disponible');
  await f.unmount();
});

test('missed due alerts recover after 90 seconds and acknowledgement survives reload without completing the booking',async()=>{
  const f=fixture({now:due+90000});await f.mount();assert.ok(f.title);await f.dismiss();assert.equal(f.records[0].estado,'pendiente');await f.unmount();
  const again=fixture({now:due+95000,storage:f.storage});await again.mount();assert.equal(again.title,'');await again.unmount();
});
test('historic pending reservations do not flood the due dialog',async()=>{
  const f=fixture({now:due+86400001});await f.mount();assert.equal(f.title,'');await f.unmount();
});
