// React integration with synthetic auth, reads, questions and checkout.
// No customer request, payment, draw, or benefit is performed by these tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const root = path.join(__dirname, '..');
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const styleNames = new Proxy({}, { get: (_, key) => String(key) });
const wrap = ({ children }) => React.createElement('div', null, children);
const character = props => React.createElement('oracle-character', props);
const icon = () => React.createElement('i');
const textOf = node => typeof node === 'string' ? node : (node?.children || []).map(textOf).join('');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const draw = (n = 1) => ({ id: id(n), tema: 'general', cardId: 'star', cardName: `Estrella ${n}`, cardImage: '', keyword: 'Confianza', advice: 'Considera un paso concreto.', message: `Lectura ficticia ${n}.`, isFree: true, drawType: 'free_daily', question: '', cards: [], conclusion: '', revealedAt: '2026-11-04T10:00:00Z' });
const snapshot = (n = 1) => ({ ok: true, freeAvailable: false, freeState: { remainingSeconds: 0, nextFreeAt: null }, credits: 2, latestDraw: draw(n), activeSession: null, questionState: { includedAvailable: true, extra: 0, total: 1 }, mensajes: [], history: [] });

function fixture({ reducedMotion = false, drawRequests = false } = {}) {
  let tree, authCallback, sequence = 0;
  let session = { access_token: 'fictional-token-a', user: { id: 'fictional-customer-a' } };
  let current = snapshot(), holdQuestion = true;
  const calls = [], checkoutCalls = [], held = [], timers = new Map(), events = new Map();
  const window = {
    location: { href: '', search: '' },
    setTimeout: (fn, delay) => { const key = ++sequence; timers.set(key, { fn, delay, repeat: false }); return key; },
    clearTimeout: key => timers.delete(key),
    setInterval: (fn, delay) => { const key = ++sequence; timers.set(key, { fn, delay, repeat: true }); return key; },
    clearInterval: key => timers.delete(key),
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
    matchMedia: () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} }),
  };
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const response = (body, ok = true) => ({ ok, json: async () => body });
  const fetch = async (url, options = {}) => {
    assert.match(url, /^\/api\/cliente\/oraculo(?:\?|$)/);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body, method: options.method });
    if (!body) return response(current);
    if (!drawRequests) assert.equal(body.action, 'question', 'avatar gestures must not create a draw or purchase');
    if (holdQuestion) return new Promise((resolve, reject) => {
      const finish = (payload, ok = true) => resolve(response(payload, ok));
      finish.reject = reject; held.push(finish);
    });
    throw new Error('Unexpected unheld question');
  };
  const auth = {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: fn => { authCallback = fn; fn('INITIAL_SESSION', session); return { data: { subscription: { unsubscribe() {} } } }; },
  };
  class ClientPurchaseError extends Error {}
  const moduleCache = new Map();
  const imports = {
    'next/link': { default: props => React.createElement('a', props, props.children) },
    'next/dynamic': { default: loader => {
      const Lazy = React.lazy(loader);
      return props => React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
    } },
    'lucide-react': new Proxy({}, { get: () => icon }),
    '@/components/cliente/ClienteLayout': { default: wrap },
    '@/components/cliente/ClientPurchaseAction': { default: wrap },
    '@/components/oracle/OraclePhotographicGuide': { default: character },
    '@/lib/supabase-browser': { supabaseClienteBrowser: () => ({ auth }) },
    '@/lib/client-entry': { clientLoginHref: () => '/cliente/login' },
    '@/lib/client-purchase-checkout': { ClientPurchaseError, prepareClientPurchase: async (...args) => { checkoutCalls.push(args); throw new Error('Unexpected checkout'); } },
    './useOracleNarration': { useOracleNarration: () => ({ state: 'idle', available: false, error: '', play() {}, stop() {} }) },
  };
  function load(relative) {
    if (moduleCache.has(relative)) return moduleCache.get(relative);
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { exports, console, Date, Intl, Error, URL, AbortSignal, Blob, window, document, fetch, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, require: name => {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name.endsWith('.css')) return { default: styleNames };
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      return require(name);
    } });
    moduleCache.set(relative, exports); return exports;
  }
  const Page = load('src/app/cliente/oraculo/page.tsx').default;
  const findButton = name => tree.root.findAllByType('button').find(button => button.props['aria-label'] === name || textOf(button).trim() === name);
  const run = async fn => renderer.act(async () => { fn(); await tick(); });
  return {
    calls, checkoutCalls, held, timers, events,
    set snapshot(value) { current = value; },
    get tree() { return tree; },
    get action() { return tree.root.findByType('oracle-character').props.action; },
    get motion() { return tree.root.findByType('oracle-character').props.motion; },
    get selectedIndex() { return tree.root.findByType('oracle-character').props.selectedIndex; },
    button(name) { const button = findButton(name); assert.ok(button, `Missing button: ${name}`); return button; },
    question() { return tree.root.findByProps({ placeholder: '¿Qué te gustaría aclarar?' }); },
    run,
    async mount() { await renderer.act(async () => { tree = renderer.create(React.createElement(Page), { createNodeMock: () => ({ focus() {}, scrollIntoView() {}, scrollHeight: 100, scrollTop: 0 }) }); await tick(); }); },
    async expireMoments() { await run(() => { for (const [key, timer] of [...timers]) if (!timer.repeat) { timers.delete(key); timer.fn(); } }); },
    async switchUser() {
      current = snapshot(2);
      await run(() => {
        session = { access_token: 'fictional-token-b', user: { id: 'fictional-customer-b' } };
        authCallback('SIGNED_IN', session);
        for (const [key, timer] of [...timers]) if (timer.delay === 0) { timers.delete(key); timer.fn(); }
      });
    },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
}

const answer = () => ({ ok: true, mensajes: [{ id: 'fixture-question', role: 'user', contenido: 'Pregunta ficticia' }, { id: 'fixture-answer', role: 'assistant', contenido: 'Respuesta ficticia confirmada.' }], questionState: { includedAvailable: false, extra: 0, total: 0 } });

test('the photographic guide follows the actual shuffle, chosen position, revealed card and reading-specific question', async t => {
  const f = fixture({ drawRequests: true });
  f.snapshot = { ...snapshot(), latestDraw: null, freeAvailable: true };
  await f.mount();
  t.after(() => f.close());
  await f.run(() => f.button('Familia').props.onClick());
  await f.run(() => { void f.button('Usar mi carta gratis').props.onClick(); });
  assert.equal(f.action, 'shuffle');
  assert.equal(f.calls.at(-1).body.tema, 'familia');
  await f.run(() => f.held.shift()({ ok: true, freeAvailable: true, credits: 2, shuffleId: 'fixture-family' }));
  assert.equal(f.action, 'offer');
  const choice = f.button('Elegir carta 19');
  await f.run(() => choice.props.onFocus());
  assert.equal(f.selectedIndex, 18);
  await f.run(() => { void choice.props.onClick(); });
  assert.equal(f.action, 'reveal');
  assert.deepEqual(f.calls.at(-1).body, { action: 'reveal', tema: 'familia', shuffleId: 'fixture-family', position: 18 });
  const saved = { ...draw(15), tema: 'familia', cardId: 'moon', cardName: 'La Luna', message: 'Lectura de familia para esta carta.' };
  f.snapshot = { ...snapshot(), latestDraw: saved };
  await f.run(() => f.held.shift()({ ok: true, draw: saved, credits: 2 }));
  await f.expireMoments();
  assert.equal(f.action, 'reading');
  assert.match(textOf(f.tree.root), /La Luna/);
  assert.match(textOf(f.tree.root), /Lectura de familia para esta carta/);
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  await f.run(() => f.question().props.onChange({ target: { value: '¿Cómo encaja esta carta en mi pregunta sobre mi familia?' } }));
  await f.run(() => { void f.button('Preguntar al Oráculo').props.onClick(); });
  assert.equal(f.action, 'channeling');
  assert.equal(f.calls.at(-1).body.drawId, saved.id);
  await f.run(() => f.held.shift()(answer()));
  assert.equal(f.action, 'answer');
  assert.deepEqual(f.calls.filter(call => call.body).map(call => call.body.action), ['shuffle', 'reveal', 'question']);
  assert.equal(f.checkoutCalls.length, 0);
});

test('a server-confirmed expiry restores the daily option without purchasing or starting a reading', async t => {
  const f = fixture();
  const freeState = { nextFreeAt: '1999-01-01T00:00:00Z', remainingSeconds: 2 };
  f.snapshot = { ...snapshot(), freeState, credits: 0 };
  await f.mount();
  t.after(() => f.close());
  await f.run(() => f.button('Amor').props.onClick());
  const expiry = [...f.timers.values()].find(timer => !timer.repeat && timer.delay > 1000 && timer.delay <= 2000);
  assert.ok(expiry, 'the countdown uses the server duration even when the local clock differs');
  f.snapshot = { ...snapshot(), freeAvailable: true, credits: 0 };
  await f.run(() => { void expiry.fn(); });
  assert.ok(f.button('Usar mi carta gratis'));
  assert.equal(f.calls.filter(call => call.body).length, 0);
});

test('opening, drafting and closing the oracle never submit a question or start checkout', async t => {
  const f = fixture(); await f.mount(); t.after(() => f.close());
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  await f.run(() => f.question().props.onChange({ target: { value: 'Pregunta todavía sin enviar' } }));
  assert.equal(f.action, 'listening');
  await f.run(() => f.button('Volver a mi lectura').props.onClick());
  assert.equal(f.button('Oráculo en línea').props['aria-expanded'], false);
  assert.equal(f.action, 'reading');
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  assert.equal(f.question().props.value, 'Pregunta todavía sin enviar');
  assert.equal(f.calls.filter(call => call.body).length, 0);
  assert.equal(f.checkoutCalls.length, 0);
});

test('switching spreads during the shared cooldown needs a paid credit and never reuses the previous included question', async t => {
  const f = fixture();
  const freeState = { nextFreeAt: new Date(Date.now() + 3600000).toISOString(), remainingSeconds: 3600 };
  f.snapshot = { ...snapshot(), freeState, credits: 0 };
  await f.mount();
  t.after(() => f.close());
  const select = () => f.tree.root.findByProps({ 'aria-label': 'Tipo de tirada' });
  await f.run(() => select().props.onChange({ target: { value: 'yes_no' } }));
  const startLabels = () => f.tree.root.findAllByType('button').map(textOf);
  assert.ok(!startLabels().includes('Usar mi carta gratis'));
  assert.ok(!startLabels().includes('Usar 1 tirada de mi saldo'));
  assert.match(textOf(f.tree.root), /Ver packs de tiradas/);
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  assert.equal(f.tree.root.findAllByProps({ placeholder: '¿Qué te gustaría aclarar?' }).length, 0);
  await f.run(() => f.button('Volver a mi lectura').props.onClick());
  await f.run(() => select().props.onChange({ target: { value: 'free_daily' } }));
  await f.run(() => f.button('Amor').props.onClick());
  assert.ok(!startLabels().includes('Usar mi carta gratis'));
  assert.equal(f.calls.filter(call => call.body).length, 0);
});
test('a purchased credit is labelled explicitly after the free draw and selecting a paid spread never spends it', async t => {
  const f = fixture();
  await f.mount();
  t.after(() => f.close());
  await f.run(() => f.tree.root.findByProps({ 'aria-label': 'Tipo de tirada' }).props.onChange({ target: { value: 'yes_no' } }));
  assert.ok(f.button('Usar 1 tirada de mi saldo'));
  assert.equal(f.calls.filter(call => call.body).length, 0);
});

test('a submitted question drives the sphere while pending, duplicate clicks cannot consume twice', async t => {
  const f = fixture(); await f.mount(); t.after(() => f.close());
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  await f.run(() => f.question().props.onChange({ target: { value: 'Pregunta ficticia' } }));
  const send = f.button('Preguntar al Oráculo').props.onClick;
  await f.run(() => { void send(); void send(); });
  assert.equal(f.action, 'channeling');
  assert.equal(f.calls.filter(call => call.body).length, 1);
  await f.expireMoments();
  assert.equal(f.action, 'channeling', 'animation timers cannot invent a completed answer');
  await f.run(() => f.held.shift()(answer()));
  assert.equal(f.action, 'answer');
  assert.match(textOf(f.tree.root), /Respuesta ficticia confirmada/);
  assert.equal(f.checkoutCalls.length, 0);
});

test('question failures stop channeling, preserve the draft and do not display a successful answer', async t => {
  const f = fixture(); await f.mount(); t.after(() => f.close());
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  await f.run(() => f.question().props.onChange({ target: { value: 'Conservar esta pregunta' } }));
  await f.run(() => { void f.button('Preguntar al Oráculo').props.onClick(); });
  await f.run(() => f.held.shift()({ ok: false, message: 'Error ficticio recuperable' }, false));
  assert.equal(f.action, 'recover');
  assert.equal(f.question().props.value, 'Conservar esta pregunta');
  assert.match(textOf(f.tree.root), /Error ficticio recuperable/);
  assert.doesNotMatch(textOf(f.tree.root), /Respuesta ficticia confirmada/);
  assert.equal(f.calls.filter(call => call.body).length, 1);
});

test('switching customer invalidates a pending answer and resets the oracle interaction', async t => {
  const f = fixture(); await f.mount(); t.after(() => f.close());
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  await f.run(() => f.question().props.onChange({ target: { value: 'Borrador privado anterior' } }));
  await f.run(() => { void f.button('Preguntar al Oráculo').props.onClick(); });
  await f.switchUser();
  assert.notEqual(f.action, 'channeling');
  await f.run(() => f.held.shift()(answer()));
  assert.doesNotMatch(textOf(f.tree.root), /Respuesta ficticia confirmada|Borrador privado anterior/);
  assert.match(textOf(f.tree.root), /Estrella 2/);
  assert.equal(f.button('Oráculo en línea').props['aria-expanded'], false);
});

test('reduced motion and the pause control do not change the request or credit flow', async t => {
  const f = fixture({ reducedMotion: true }); await f.mount(); t.after(() => f.close());
  assert.equal(f.motion, false);
  await f.run(() => f.button('Activar animaciones').props.onClick());
  assert.equal(f.motion, true);
  await f.run(() => f.button('Pausar animaciones').props.onClick());
  assert.equal(f.motion, false);
  assert.equal(f.calls.filter(call => call.body).length, 0);
  assert.equal(f.checkoutCalls.length, 0);
});

test('recovering a timed-out question preserves its reading and draft without auto-resending', async t => {
  const f = fixture(); await f.mount(); t.after(() => f.close());
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  await f.run(() => f.question().props.onChange({ target: { value: 'Pregunta pendiente tras timeout' } }));
  await f.run(() => { void f.button('Preguntar al Oráculo').props.onClick(); });
  const timeout = new Error('Timed out'); timeout.name = 'TimeoutError';
  await f.run(() => f.held.shift().reject(timeout));
  assert.equal(f.action, 'recover');
  assert.match(textOf(f.tree.root), /La conexión ha tardado demasiado/);
  await f.run(() => { void f.button('Recuperar estado').props.onClick(); });
  assert.equal(f.calls.at(-1).url, '/api/cliente/oraculo?drawId=' + id(1));
  assert.equal(f.question().props.value, 'Pregunta pendiente tras timeout');
  assert.equal(f.button('Oráculo en línea').props['aria-expanded'], true);
  assert.equal(f.calls.filter(call => call.body).length, 1);
  assert.notEqual(f.action, 'channeling');
});

test('recovery displays an already saved answer without submitting or charging again', async t => {
  const f = fixture(); await f.mount(); t.after(() => f.close());
  await f.run(() => f.button('Oráculo en línea').props.onClick());
  await f.run(() => f.question().props.onChange({ target: { value: 'Pregunta ficticia' } }));
  await f.run(() => { void f.button('Preguntar al Oráculo').props.onClick(); });
  const timeout = new Error('Timed out after save'); timeout.name = 'TimeoutError';
  await f.run(() => f.held.shift().reject(timeout));
  f.snapshot = { ...snapshot(), mensajes: answer().mensajes, questionState: { includedAvailable: false, extra: 1, total: 1 } };
  await f.run(() => { void f.button('Recuperar estado').props.onClick(); });
  assert.equal(f.action, 'answer');
  assert.equal(f.question().props.value, '');
  assert.match(textOf(f.tree.root), /Respuesta ficticia confirmada/);
  assert.equal(f.button('Oráculo en línea').props['aria-expanded'], true);
  assert.equal(f.calls.filter(call => call.body).length, 1);
  assert.equal(f.checkoutCalls.length, 0);
});
