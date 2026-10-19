const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const root = path.join(__dirname, '..');
function evaluate(file, imports = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in imports ? imports[name] : require(name), Date, Intl, AbortController, Event, Error, console, Map, TextEncoder, Uint8Array, ...globals });
  return exports;
}
const shared = evaluate('src/features/admin/atlas/atlas-types.ts');
const watchShared = evaluate('src/features/admin/atlas/atlas-watch-types.ts');
const missionShared = evaluate('src/lib/recovery-mission.ts');
const styles = new Proxy({}, { get: (_, key) => String(key) });
const initial = () => ({ ok: true, overview: { updatedAt: '2026-10-19T15:40:00Z', revenue: { today: 0, goal: 300 }, acquisition: { count: 0, goal: 10 }, missions: [], alerts: [], insights: [], pendingJobs: [] }, messages: [], memories: [], jobs: [], aiConfigured: true });
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

function fixture() {
  let latest, tree, authCallback, sequence = 0;
  let session = { access_token: 'test-token', user: { id: 'admin-one' } };
  const calls = [], events = new Map(), timers = new Map(), held = [];
  let hold = false, fail = false;
  const document = { hidden: false, addEventListener: (name, fn) => events.set(`document:${name}`, fn), removeEventListener: name => events.delete(`document:${name}`) };
  const window = {
    setTimeout: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; }, clearInterval: id => timers.delete(id),
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name),
  };
  const auth = { getSession: async () => ({ data: { session } }), onAuthStateChange: fn => { authCallback = fn; return { data: { subscription: { unsubscribe() {} } } }; } };
  const response = payload => ({ ok: !payload.error, json: async () => payload });
  const fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    if (hold) return new Promise(resolve => held.push(payload => resolve(response(payload))));
    if (fail) throw new Error('Network unavailable');
    return response(body ? { ok: true, message: { id: `answer:${calls.length}`, role: 'assistant', text: 'Comprobado', cards: [] } } : initial());
  };
  const { useAtlas } = evaluate('src/features/admin/atlas/useAtlas.ts', { '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth }) } }, { window, document, fetch, crypto: { randomUUID: () => `request-${++sequence}`, subtle: { digest: async (_, bytes) => bytes.buffer } } });
  function Harness() { latest = useAtlas(); return null; }
  return {
    calls, held, timers, events, get state() { return latest; }, set hold(value) { hold = value; }, set fail(value) { fail = value; },
    async mount() { await renderer.act(async () => { tree = renderer.create(React.createElement(Harness)); await tick(); }); },
    async run(fn) { let result; await renderer.act(async () => { result = await fn(); await tick(); }); return result; },
    async logout() { await renderer.act(async () => { session = null; authCallback('SIGNED_OUT', null); await tick(); }); },
    async switchUser() { await renderer.act(async () => { session = { access_token: 'new-token', user: { id: 'admin-two' } }; authCallback('SIGNED_IN', session); await tick(); }); },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
}

test('missing money is distinct from a real zero and progress stays bounded', () => {
  for (const value of [null, undefined, NaN, Infinity, '300', -1]) assert.equal(shared.atlasNumber(value), null);
  assert.equal(shared.atlasNumber(0), 0);
  assert.equal(shared.atlasProgress(null, 300), 0);
  assert.equal(shared.atlasProgress(585, 300), 100);
});

test('model cards can only navigate to the admin surface', () => {
  assert.equal(shared.atlasInternalHref('/admin?tab=clientes'), '/admin?tab=clientes');
  assert.equal(shared.atlasInternalHref('/admin/companions'), '/admin/companions');
  for (const href of ['javascript:alert(1)', '//evil.test', '/administrator', 'https://evil.test', '/admin\\evil', '/admin /other']) assert.equal(shared.atlasInternalHref(href), null);
});

test('reads use the session bearer and periodic polling only while visible', async () => {
  const f = fixture(); await f.mount();
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(f.calls[0].options.cache, 'no-store');
  assert.equal(f.state.overview.revenue.today, 0);
  await f.run(() => f.events.get('focus')());
  assert.equal(f.calls[1].url, '/api/admin/atlas?overview=1');
  assert.ok([...f.timers.values()].some(timer => timer.delay === 30000));
  await f.close(); assert.equal(f.events.size, 0); assert.equal(f.timers.size, 0);
});

test('logout aborts requests and late responses cannot reveal the prior account', async () => {
  const f = fixture(); f.hold = true; await f.mount();
  const signal = f.calls[0].options.signal;
  await f.logout(); assert.equal(signal.aborted, true); assert.equal(f.state.overview, null);
  await f.run(() => f.held.shift()({ ...initial(), messages: [{ id: 'private', role: 'assistant', text: 'old account', cards: [] }] }));
  assert.equal(f.state.messages.length, 0); assert.equal(f.state.overview, null); await f.close();
});

test('a user switch clears conversation and invalidates in-flight mutation results', async () => {
  const f = fixture(); await f.mount(); f.hold = true;
  let request; await f.run(() => { request = f.state.chat('Client details'); });
  await f.switchUser(); assert.equal(f.state.messages.length, 0);
  await f.run(() => f.held.shift()({ ok: true, message: { id: 'old', role: 'assistant', text: 'Private details', cards: [] } }));
  await request; assert.equal(f.state.messages.length, 0); await f.close();
});

test('a read started before chat cannot overwrite the conversation after the answer', async () => {
  const f = fixture(); await f.mount(); f.hold = true; await f.run(() => f.state.refresh());
  f.hold = false; await f.run(() => f.state.chat('Atlas, cómo vamos'));
  assert.equal(f.state.messages.length, 2);
  await f.run(() => f.held.shift()(initial()));
  assert.equal(f.state.messages.length, 2); assert.equal(f.state.messages[1].text, 'Comprobado'); await f.close();
});

test('retrying a failed chat keeps its request id and does not duplicate the user bubble', async () => {
  const f = fixture(); await f.mount(); f.fail = true;
  assert.equal(await f.run(() => f.state.chat('Prepara mi promo')), false);
  const id = f.calls[1].body.requestId; assert.equal(f.state.messages.length, 1);
  f.fail = false; assert.equal(await f.run(() => f.state.chat('Prepara mi promo')), true);
  assert.equal(f.calls[2].body.requestId, id); assert.equal(f.state.messages.length, 2); await f.close();
});

test('repeated execution uses the same request id and secrets stay outside messages', async () => {
  const f = fixture(); await f.mount(); f.fail = true;
  await f.run(() => f.state.action('execute', 'proposal-one', 'Example-secret1'));
  const id = f.calls[1].body.requestId; f.fail = false;
  await f.run(() => f.state.action('execute', 'proposal-one', 'Example-secret1'));
  assert.equal(f.calls[2].body.requestId, id); assert.equal(f.calls[2].body.password, 'Example-secret1');
  assert.doesNotMatch(JSON.stringify(f.state.messages), /Example-secret1/);
  await f.run(() => f.state.chat('Cambia la contraseña de Ana: secret-test'));
  assert.doesNotMatch(JSON.stringify(f.state.messages), /secret-test/); await f.close();
});

test('a failed overview keeps its timestamp and explicitly marks the data stale', async () => {
  const f = fixture(); await f.mount(); const stamp = f.state.overview.updatedAt; f.fail = true;
  await f.run(() => f.state.refresh()); assert.equal(f.state.overview.updatedAt, stamp); assert.equal(f.state.stale, true); assert.match(f.state.error, /Network/); await f.close();
});

test('password identification followups stay redacted even without a password keyword', async () => {
  const f = fixture(); f.hold = true; await f.mount();
  await f.run(() => f.held.shift()({ ...initial(), messages: [{ id: 'sensitive', role: 'assistant', text: 'Indica la clienta para preparar el formulario', cards: [], sensitiveFollowup: true }] }));
  f.hold = false; await f.run(() => f.state.chat('Accidental-sensitive-text'));
  assert.doesNotMatch(JSON.stringify(f.state.messages), /Accidental-sensitive-text/);
  assert.match(f.state.messages[1].text, /formulario protegido/); await f.close();
});

test('successful actions schedule a full history refresh so new memories appear', async () => {
  const f = fixture(); await f.mount(); await f.run(() => f.state.action('execute', 'new-memory'));
  const refresh = [...f.timers.values()].find(timer => timer.delay === 0);
  assert.ok(refresh); await f.run(refresh.fn);
  assert.equal(f.calls.at(-1).url, '/api/admin/atlas'); assert.equal(f.calls.at(-1).options.method, 'GET'); await f.close();
});

function panelFixture(overrides = {}, props = {}) {
  const actions = [];
  const data = { ...initial(), loading: false, busy: '', error: '', stale: false, identityEpoch: 0, refresh() {}, chat: async () => true, action: async (...args) => { actions.push(args); return true; }, ...overrides };
  const character = evaluate('src/features/admin/atlas/AtlasCharacter.tsx', { './Atlas.module.css': { default: styles }, './atlas-watch-types': watchShared });
  const watchPanel = evaluate('src/features/admin/atlas/AtlasWatchPanel.tsx', { './Atlas.module.css': { default: styles }, './atlas-watch-types': watchShared, './atlas-types': shared });
  const { default: Panel } = evaluate('src/features/admin/atlas/AtlasPanel.tsx', { './useAtlas': { useAtlas: () => data }, './Atlas.module.css': { default: styles }, './AtlasCharacter': character, './atlas-types': shared, './atlas-watch-types': watchShared, './AtlasWatchPanel': watchPanel, '@/lib/recovery-mission': missionShared }, { window: { setTimeout: fn => fn() } });
  let tree; renderer.act(() => { tree = renderer.create(React.createElement(Panel, props)); });
  return { tree, actions };
}

test('unknown overview renders missing values and keyboard-labelled conversation', () => {
  const { tree } = panelFixture({ overview: null });
  assert.match(JSON.stringify(tree.toJSON()), /Aún no hay datos verificados/);
  const composer = tree.root.findByProps({ id: 'atlas-message' });
  assert.equal(composer.props.maxLength, 3000);
  assert.equal(tree.root.findByProps({ htmlFor: 'atlas-message' }).children[0], 'Tu mensaje para Atlas');
  assert.equal(tree.root.findByProps({ role: 'log' }).props['aria-live'], 'polite');
  renderer.act(() => tree.unmount());
});

test('password proposal uses a separate field, clears it, and submits only an execute action', async () => {
  const { tree, actions } = panelFixture({ messages: [{ id: 'msg', role: 'assistant', text: 'Preparado', cards: [], proposal: { id: 'p1', kind: 'change_password', title: 'Cambiar acceso de Ana', status: 'pending', requiresPassword: true, details: [{ label: 'Clienta', value: 'Ana' }] } }] });
  const field = tree.root.findByProps({ type: 'password' });
  assert.equal(field.props.autoComplete, 'new-password');
  await renderer.act(async () => field.props.onChange({ target: { value: 'Example-secret1' } }));
  const button = tree.root.findAllByType('button').find(item => item.children[0] === 'Ejecutar esta acción');
  await renderer.act(async () => { await button.props.onClick(); await tick(); });
  assert.deepEqual(actions[0], ['execute', 'p1', 'Example-secret1']);
  assert.equal(tree.root.findByProps({ type: 'password' }).props.value, '');
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Example-secret1/); renderer.act(() => tree.unmount());
});

test('choosing a promotion card sends its exact preparation prompt without executing it', async () => {
  const chats = [];
  const { tree, actions } = panelFixture({ chat: async text => { chats.push(text); return true; }, messages: [{ id: 'm1', role: 'assistant', text: 'Elige una promoción', cards: [{ id: 'promo1', kind: 'promotion', title: 'Promo de prueba', description: 'Inactiva', prompt: 'Activa la promoción exact-id' }] }] });
  const card = tree.root.findAllByType('button').find(button => button.props.className === 'actionCard');
  await renderer.act(async () => { card.props.onClick(); await tick(); });
  assert.deepEqual(chats, ['Activa la promoción exact-id']); assert.equal(actions.length, 0); renderer.act(() => tree.unmount());
});

test('shared watch alerts replace overview minute alerts so acknowledgement cannot leave a duplicate count', () => {
  const overview = { ...initial().overview, alerts: [{ id: 'minutes:old-alert', title: 'Saldo antiguo', description: 'Aviso ya visto' }] };
  const watches = { watches: [], loading: false, busy: '', error: '', stale: false, refresh() {}, action: async () => true };
  const { tree } = panelFixture({ overview }, { watches });
  const supervision = tree.root.findAllByType('button').find(button => button.children.includes('Supervisión y encargos'));
  assert.equal(supervision.findAllByType('span').length, 0); assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Saldo antiguo/);
  renderer.act(() => tree.unmount());
});

const watchedClient = () => ({ watches: [{ id: 'watch1', clientId: 'client1', clientName: 'Clienta de prueba', threshold: 30, enabled: true, balance: { state: 'known', free: 0, normal: 20, total: 20 }, alert: null }], loading: false, busy: '', error: '', stale: false, refresh() {}, action: async () => true });

test('watch promotion CTA explicitly leaves password context then lists promotions without changing the password proposal', async () => {
  const chats = [];
  const proposal = { id: 'password1', kind: 'change_password', title: 'Cambiar acceso', status: 'pending', requiresPassword: true, details: [] };
  const { tree, actions } = panelFixture({ chat: async text => { chats.push(text); return true; }, messages: [{ id: 'password-msg', role: 'assistant', text: 'Usa el campo protegido', cards: [], proposal }] }, { watches: watchedClient(), initialView: 'supervision' });
  const button = tree.root.findAllByType('button').find(node => node.children.includes('Ver promociones'));
  await renderer.act(async () => { await button.props.onClick(); await tick(); });
  assert.deepEqual(chats, ['otra cosa', 'Atlas, muéstrame las promociones disponibles.']);
  assert.equal(actions.length, 0); assert.equal(proposal.status, 'pending');
  renderer.act(() => tree.unmount());
});

test('watch promotion CTA stops if exiting protected clarification fails', async () => {
  const chats = [];
  const { tree, actions } = panelFixture({ chat: async text => { chats.push(text); return false; }, messages: [{ id: 'password-msg', role: 'assistant', text: 'Selecciona una clienta', cards: [], sensitiveFollowup: true }] }, { watches: watchedClient(), initialView: 'supervision' });
  const button = tree.root.findAllByType('button').find(node => node.children.includes('Ver promociones'));
  await renderer.act(async () => { await button.props.onClick(); await tick(); });
  assert.deepEqual(chats, ['otra cosa']); assert.equal(actions.length, 0);
  renderer.act(() => tree.unmount());
});
