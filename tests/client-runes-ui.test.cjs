const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { act, create } = require('react-test-renderer');

function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, console, AbortController, ...globals, require(name) {
    if (name in mocks) return mocks[name];
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => props => React.createElement('span', { ...props, 'data-icon': key }) });
    return require(name);
  } });
  return exports.default;
}
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const flush = async fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const response = payload => ({ ok: true, status: 200, json: async () => payload });

function browser() {
  let nextId = 0;
  const timers = new Map(), listeners = new Map();
  return {
    window: {
      setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
      setInterval(fn) { this.interval = fn; return ++nextId; }, clearInterval() {},
      addEventListener(event, fn) { listeners.set(event, fn); }, removeEventListener(event) { listeners.delete(event); },
    },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    async debounce() { await flush(() => { for (const [id, timer] of timers) if (timer.ms === 250) { timers.delete(id); timer.fn(); } }); },
    async focus() { await flush(() => listeners.get('focus')?.()); },
  };
}

test('client rune displays only the assigned advantage and does not promise benefits without activation', async () => {
  const Component = load('src/components/cliente/RunesComingSoon.tsx', { './CrimsonRuneScene': { default: () => React.createElement('div', { 'data-scene': true }) } });
  let view;
  await flush(() => { view = create(React.createElement(Component, { rune: null })); });
  assert.match(text(view.toJSON()), /Aún no tienes una runa activada/);
  assert.doesNotMatch(text(view.toJSON()), /Acceso a una lectura especial|Reserva previa/);
  assert.equal(view.root.findAllByType('a').length, 0);
  await flush(() => view.update(React.createElement(Component, { rune: { title: 'Runa personal', benefit: 'La ventaja escrita por administración.\nSus condiciones.', updated_at: '2026-11-06T12:00:00Z' } })));
  assert.match(text(view.toJSON()), /Activada para ti/);
  assert.match(text(view.toJSON()), /La ventaja escrita por administración\.\nSus condiciones\./);
  await flush(() => view.unmount());
});

function adminFixture() {
  const env = browser(), posts = [];
  const client = { id: 'client-one', nombre: 'Cliente de prueba', telefono: '123', rune: null };
  let view, changed = 0;
  const Component = load('src/components/admin/ClientRunesAdminPanel.tsx', {
    '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'staff' } } }) } }) },
    '@/lib/client-runes-sync': { CLIENT_RUNES_CHANGED: 'runes-changed', announceClientRunesChange: () => { changed++; } },
  }, { ...env, crypto: { randomUUID: () => 'operation-test' }, fetch: async (_url, init) => {
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); posts.push(body);
      client.rune = { id: 'rune-one', enabled: body.enabled, title: body.title, benefit: body.benefit, updated_at: `2026-11-06T12:0${posts.length}:00Z` };
      return response({ ok: true, rune: { ...client.rune } });
    }
    return response({ ok: true, clients: [{ ...client, rune: client.rune ? { ...client.rune } : null }] });
  } });
  return {
    env, posts, client,
    get view() { return view; },
    get changed() { return changed; },
    async mount() { await flush(() => { view = create(React.createElement(Component)); }); await env.debounce(); },
    async select() { await flush(() => view.root.findAllByType('button').find(button => text(button).includes('Cliente de prueba')).props.onClick()); await env.debounce(); },
    async edit(benefit, enabled = true) {
      await flush(() => {
        view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: enabled } });
        view.root.findByType('textarea').props.onChange({ target: { value: benefit } });
      });
    },
    async save() { await flush(() => view.root.findByType('form').props.onSubmit({ preventDefault() {} })); },
    async unmount() { await flush(() => view.unmount()); },
  };
}

test('admin activation is explicit, saves only the selected client and can deactivate without changing balances', async () => {
  const f = adminFixture(); await f.mount(); await f.select();
  assert.equal(f.posts.length, 0);
  assert.equal(f.view.root.findByProps({ type: 'checkbox' }).props.checked, false);
  await f.edit('Ventaja concreta para este cliente.'); await f.save();
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].cliente_id, 'client-one');
  assert.equal(f.posts[0].enabled, true);
  assert.equal(f.posts[0].expected_updated_at, null);
  assert.equal(f.posts[0].benefit, 'Ventaja concreta para este cliente.');
  assert.equal('coins' in f.posts[0], false);
  assert.equal(f.changed, 1);
  await f.edit('Ventaja concreta para este cliente.', false); await f.save();
  assert.equal(f.posts[1].enabled, false);
  assert.equal(f.posts[1].expected_updated_at, '2026-11-06T12:01:00Z');
  assert.equal(f.posts[1].benefit, f.posts[0].benefit);
  await f.unmount();
});

test('background refresh preserves the admin draft and prevents overwriting another saved version', async () => {
  const f = adminFixture(); await f.mount(); await f.select();
  await f.edit('Mi borrador aún sin guardar.');
  f.client.rune = { id: 'rune-one', enabled: true, title: 'Guardada en otra sesión', benefit: 'Otra ventaja', updated_at: '2026-11-06T13:00:00Z' };
  await f.env.focus();
  assert.equal(f.view.root.findByType('textarea').props.value, 'Mi borrador aún sin guardar.');
  assert.match(text(f.view.toJSON()), /Hay cambios guardados desde otra sesión/);
  assert.equal(f.view.root.findByProps({ type: 'submit' }).props.disabled, true);
  await f.save(); assert.equal(f.posts.length, 0);
  await flush(() => f.view.root.findAllByType('button').find(button => text(button) === 'Cargar versión actual').props.onClick());
  assert.equal(f.view.root.findByType('textarea').props.value, 'Otra ventaja');
  await f.unmount();
});

test('client account switch hides the previous rune immediately and revocation stays empty', async () => {
  const env = browser();
  let listener, view, resolveSecond;
  const router = { replace() {} };
  const firstSession = { user: { id: 'first' }, access_token: 'first-token' };
  const Component = load('src/app/cliente/runas/page.tsx', {
    'next/navigation': { useRouter: () => router },
    '@/components/cliente/ClienteLayout': { default: props => React.createElement('main', null, props.children) },
    '@/components/cliente/RunesComingSoon': { default: props => React.createElement('div', { 'data-rune': props.rune }, props.rune?.benefit || 'Sin runa activada') },
    '@/lib/client-runes-sync': { CLIENT_RUNES_CHANGED: 'runes-changed' },
    '@/lib/supabase-browser': { supabaseClienteBrowser: () => ({ auth: {
      getSession: async () => ({ data: { session: firstSession } }),
      onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    } }) },
  }, { ...env, fetch: async (_url, init) => {
    if (init.headers.Authorization === 'Bearer first-token') return response({ ok: true, rune: { title: 'Primera', benefit: 'Ventaja privada primera', updated_at: '2026-11-06T12:00:00Z' } });
    return new Promise(resolve => { resolveSecond = resolve; });
  } });
  await flush(() => { view = create(React.createElement(Component)); });
  assert.match(text(view.toJSON()), /Ventaja privada primera/);
  await flush(() => listener('SIGNED_IN', { user: { id: 'second' }, access_token: 'second-token' }));
  assert.doesNotMatch(text(view.toJSON()), /Ventaja privada primera/);
  await flush(() => resolveSecond(response({ ok: true, rune: null })));
  assert.match(text(view.toJSON()), /Sin runa activada/);
  await flush(() => listener('SIGNED_OUT', null));
  assert.doesNotMatch(text(view.toJSON()), /Ventaja privada primera|Sin runa activada/);
  await flush(() => view.unmount());
});
