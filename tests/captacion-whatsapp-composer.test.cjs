const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const { webcrypto } = require('node:crypto');
const { act } = renderer;

function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
}
const assistant = { exports: {} };
vm.runInNewContext(compile('src/lib/central-assistant.ts'), { exports: assistant.exports, require() { throw new Error('Unexpected assistant import'); } });
const helpers = { exports: {} };
vm.runInNewContext(compile('src/lib/captacion-whatsapp.ts'), { exports: helpers.exports, encodeURIComponent, require(name) { if (name === './central-assistant') return assistant.exports; throw new Error(name); } });
const { buildCaptacionMessage, buildCaptacionWhatsAppUrl, captacionWhatsAppPhone, CAPTACION_BENEFITS_IMAGE } = helpers.exports;
const component = compile('src/components/captacion/CaptacionWhatsAppComposer.tsx');
const a = { id: 'a', cliente: { nombre: 'Daisy', apellido: 'de Leon', telefono: '+1 (787) 555-0101' } };
const b = { id: 'b', cliente: { nombre: 'Guadalupe', apellido: 'Christobal', telefono: '+34 612 345 678' } };
const content = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(content).join('') : node ? content(node.children) : '';

function fixture(options = {}) {
  const exports = {}, selected = [], copied = [], imageWrites = [], fetches = [], nodeActions = [], apiRequests = [];
  const navigator = options.navigator || { clipboard: { async writeText(text) { copied.push(text); }, async write(items) { imageWrites.push(items); for (const item of items) await Promise.all(Object.values(item.data)); } } };
  class ClipboardFixture { constructor(data) { this.data = data; } }
  vm.runInNewContext(component, {
    exports, navigator, ClipboardItem: options.unsupportedImage ? undefined : ClipboardFixture, crypto: webcrypto, AbortController, encodeURIComponent,
    fetch(url, init) {
      if (url.startsWith('/api/captacion/whatsapp')) {
        apiRequests.push({ url, init });
        return options.api ? options.api(url, init) : Promise.resolve(response({ ok: true, configured: false, ready: false, reason: 'CONFIGURATION_REQUIRED', template: null, delivery: null }));
      }
      fetches.push({ url, init }); return options.fetch ? options.fetch(url, init) : Promise.resolve({ ok: true, blob: async () => ({ type: 'image/png' }) });
    },
    require(name) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
      if (name === '@/lib/captacion-whatsapp') return helpers.exports;
      if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => ({ auth: { getSession: options.getSession || (async () => ({ data: { session: { access_token: 'fixture-only-token' } } })) } }) };
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      throw new Error(name);
    },
  });
  const props = { contacts: [a, b], selectedLeadId: options.selectedLeadId === undefined ? 'a' : options.selectedLeadId, onSelectLead: id => selected.push(id) };
  let tree;
  act(() => { tree = renderer.create(React.createElement(exports.default, props), { createNodeMock: () => ({ focus() { nodeActions.push('focus'); }, select() { nodeActions.push('select'); } }) }); });
  return {
    tree, selected, copied, imageWrites, fetches, nodeActions, apiRequests,
    text: () => content(tree.toJSON()),
    buttons: () => tree.root.findAllByType('button'),
    button: label => tree.root.findAllByType('button').find(node => content(node) === label),
    editor: () => tree.root.findByType('textarea'),
    phone: () => tree.root.findByType('input'),
    links: () => tree.root.findAllByType('a'),
    update(values) { Object.assign(props, values); act(() => tree.update(React.createElement(exports.default, props))); },
    change(node, value) { act(() => node.props.onChange({ target: { value } })); },
    async click(label) { const node = this.button(label); assert.ok(node, label); await act(async () => { await node.props.onClick(); }); },
    async settle() { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); },
    close() { act(() => tree.unmount()); },
  };
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
const readyStatus = { ok: true, configured: true, ready: true, reason: null, template: { status: 'approved', name: 'bienvenida', body: buildCaptacionMessage({ id: 'template', cliente: { nombre: '{{1}}' } }), media_url: CAPTACION_BENEFITS_IMAGE }, delivery: null };

test('normalizes existing international prefixes without guessing a local country or accepting extensions', () => {
  for (const [input, expected] of [['+1 (787) 555-0101', '17875550101'], ['0017875550101', '17875550101'], ['17875550101', '17875550101'], ['+34 612 345 678', '34612345678'], ['+54 9 11 1234 5678', '5491112345678']]) assert.equal(captacionWhatsAppPhone(input), expected, input);
  for (const input of ['7875550101', '612345678', 'TELÉFONO', '+17875550101 ext 22', '00', '+0 12345678', '+1234567890123456', '++17875550101', null]) assert.equal(captacionWhatsAppPhone(input), null, String(input));
});

test('builds an encoded recipient URL and personalizes each welcome independently', () => {
  const first = buildCaptacionMessage(a), second = buildCaptacionMessage(b);
  assert.match(first, /^Hola, Daisy de Leon 💜/);
  assert.match(second, /^Hola, Guadalupe Christobal 💜/);
  assert.doesNotMatch(second, /Daisy/);
  assert.match(first, /3 niveles de compra/);
  assert.match(first, /primera tirada de cartas es gratis/);
  assert.match(first, /https:\/\/clientestarotcelestial.es\/cliente\/oraculo/);
  const url = new URL(buildCaptacionWhatsAppUrl(a.cliente.telefono, first));
  assert.equal(url.hostname, 'wa.me'); assert.equal(url.pathname, '/17875550101'); assert.equal(url.searchParams.get('text'), first);
  assert.equal(buildCaptacionWhatsAppUrl('7875550101', first), null);
  assert.equal(buildCaptacionWhatsAppUrl(a.cliente.telefono, '  '), null);
  assert.match(buildCaptacionMessage({ id: 'missing' }), /^Hola 💜/);
});

test('switching recipients resets message and phone while same-contact refresh preserves the draft', () => {
  const f = fixture(); try {
    f.change(f.editor(), 'Hola Daisy, texto revisado'); f.change(f.phone(), '+17875550199');
    f.update({ contacts: [{ ...a }, { ...b }] }); assert.equal(f.editor().props.value, 'Hola Daisy, texto revisado');
    f.update({ selectedLeadId: 'b' });
    assert.match(f.editor().props.value, /^Hola, Guadalupe/); assert.doesNotMatch(f.editor().props.value, /Daisy/); assert.equal(f.phone().props.value, b.cliente.telefono);
    f.change(f.tree.root.findByType('select'), 'a'); assert.deepEqual(f.selected, ['a']);
    f.update({ contacts: [a] }); assert.equal(f.editor().props.value, ''); assert.equal(f.editor().props.disabled, true);
    assert.equal(f.links().some(node => String(node.props.href).startsWith('https://wa.me/')), false);
  } finally { f.close(); }
});

test('a local number disables opening WhatsApp until a complete prefix is supplied, without changing CRM', () => {
  const local = { ...a, cliente: { ...a.cliente, telefono: '7875550101' } };
  const f = fixture(); try {
    f.update({ contacts: [local], selectedLeadId: null }); f.update({ selectedLeadId: 'a' });
    assert.equal(f.button('Abrir WhatsApp').props.disabled, true);
    f.change(f.phone(), '+17875550101'); assert.equal(f.links().some(node => String(node.props.href).startsWith('https://wa.me/17875550101')), true);
    assert.equal(local.cliente.telefono, '7875550101');
  } finally { f.close(); }
});

test('copy message copies only the reviewed text and falls back to manual selection when clipboard is denied', async () => {
  const f = fixture(); try {
    f.change(f.editor(), 'Hola Daisy 💜 texto final'); await f.click('Copiar mensaje');
    assert.deepEqual(f.copied, ['Hola Daisy 💜 texto final']); assert.equal(f.fetches.length, 0);
  } finally { f.close(); }
  const denied = fixture({ navigator: { clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } } }); try {
    await denied.click('Copiar mensaje'); assert.deepEqual(denied.nodeActions, ['focus', 'select']); assert.match(denied.text(), /Ctrl\+C/);
  } finally { denied.close(); }
});

test('copy image keeps the draft and writes the approved PNG; downloading remains available', async () => {
  const f = fixture(); try {
    f.change(f.editor(), 'Texto revisado para Daisy'); await f.click('Copiar imagen');
    assert.equal(f.editor().props.value, 'Texto revisado para Daisy'); assert.equal(f.imageWrites.length, 1);
    assert.equal(f.fetches[0].url, CAPTACION_BENEFITS_IMAGE); assert.deepEqual(Object.keys(f.imageWrites[0][0].data), ['image/png']);
    assert.match(f.text(), /Imagen copiada/); assert.equal(f.links().some(node => node.props.download && node.props.href === CAPTACION_BENEFITS_IMAGE), true);
  } finally { f.close(); }
});

test('unsupported image clipboard and a missing image give a truthful download fallback', async () => {
  const unsupported = fixture({ unsupportedImage: true }); try {
    await unsupported.click('Copiar imagen'); assert.match(unsupported.text(), /no permite copiar imágenes/); assert.equal(unsupported.fetches.length, 0);
  } finally { unsupported.close(); }
  const missing = fixture({ fetch: async () => ({ ok: false }) }); try {
    await missing.click('Copiar imagen'); assert.match(missing.text(), /No se pudo copiar la imagen/); assert.equal(missing.button('Copiar imagen').props.disabled, false);
  } finally { missing.close(); }
});

test('official connection pending never claims a send or automatically posts', async () => {
  const f = fixture(); try {
    await f.settle(); assert.match(f.text(), /conexión oficial está pendiente/);
    assert.equal(f.button('Enviar WhatsApp').props.disabled, true);
    assert.equal(f.apiRequests.filter(item => item.init.method === 'POST').length, 0);
  } finally { f.close(); }
});

test('official send posts only lead and stable request identity, ignoring editable manual text and phone', async () => {
  let resolvePost;
  const f = fixture({ api: (_url, init) => init.method === 'POST' ? new Promise(resolve => { resolvePost = resolve; }) : Promise.resolve(response(readyStatus)) }); try {
    await f.settle(); f.change(f.editor(), 'Manual text for a different draft'); f.change(f.phone(), '+34600000000');
    const button = f.button('Enviar WhatsApp');
    await act(async () => { button.props.onClick(); button.props.onClick(); });
    const posts = f.apiRequests.filter(item => item.init.method === 'POST'); assert.equal(posts.length, 1);
    const payload = JSON.parse(posts[0].init.body);
    assert.deepEqual(Object.keys(payload).sort(), ['lead_id', 'request_id']); assert.equal(payload.lead_id, a.id);
    assert.match(payload.request_id, /^[0-9a-f-]{36}$/);
    assert.equal(posts[0].init.headers.Authorization, 'Bearer fixture-only-token');
    await act(async () => resolvePost(response({ ok: true, status: 'accepted', duplicate: false })));
    assert.match(f.text(), /aceptó la solicitud/); assert.match(f.text(), /pendiente de confirmación/);
    assert.doesNotMatch(f.text(), /confirmó la entrega/);
    assert.equal(f.button('Enviar WhatsApp').props.disabled, true);
    f.update({ selectedLeadId: 'b' }); await f.settle(); assert.equal(f.button('Enviar WhatsApp').props.disabled, false);
    f.update({ selectedLeadId: 'a' }); await f.settle(); assert.equal(f.button('Enviar WhatsApp').props.disabled, true);
    assert.equal(f.apiRequests.filter(item => item.init.method === 'POST').length, 1);
  } finally { f.close(); }
});

test('unknown outcomes cannot trigger a second send; checking status is a read and can confirm delivery', async () => {
  let status = readyStatus;
  const f = fixture({ api: async (_url, init) => { if (init.method === 'POST') throw new Error('Network interrupted'); return response(status); } }); try {
    await f.settle(); await f.click('Enviar WhatsApp');
    assert.match(f.text(), /envío podría seguir en curso/); assert.equal(f.button('Enviar WhatsApp').props.disabled, true);
    status = { ...readyStatus, ready: false, reason: 'ALREADY_SENT', delivery: { id: 'delivery-a', status: 'delivered' } };
    await f.click('Comprobar estado'); await f.settle();
    assert.match(f.text(), /confirmó la entrega/);
    assert.equal(f.apiRequests.filter(item => item.init.method === 'POST').length, 1);
  } finally { f.close(); }
});

test('late contact A status cannot show A preview or delivery on selected contact B', async () => {
  let resolveA;
  const f = fixture({ api: (url) => url.includes('lead_id=a') ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(response({ ...readyStatus, preview_message: 'Bienvenida oficial Guadalupe' })) }); try {
    await f.settle(); f.update({ selectedLeadId: 'b' }); await f.settle();
    assert.match(f.text(), /Bienvenida oficial Guadalupe/);
    await act(async () => resolveA(response({ ...readyStatus, preview_message: 'Respuesta vieja Daisy privada', delivery: { id: 'old', status: 'read' } })));
    assert.doesNotMatch(f.text(), /Respuesta vieja Daisy privada/); assert.doesNotMatch(f.text(), /mensaje fue leído/);
    assert.equal(f.button('Enviar WhatsApp').props.disabled, false);
  } finally { f.close(); }
});

test('a late POST failure does not erase delivery already confirmed by a status check', async () => {
  let rejectPost, status = readyStatus;
  const f = fixture({ api: (_url, init) => init.method === 'POST' ? new Promise((_resolve, reject) => { rejectPost = reject; }) : Promise.resolve(response(status)) }); try {
    await f.settle(); await f.click('Enviar WhatsApp');
    status = { ...readyStatus, ready: false, delivery: { id: 'delivery-a', status: 'delivered' } };
    await f.click('Comprobar estado'); await f.settle(); assert.match(f.text(), /confirmó la entrega/);
    await act(async () => rejectPost(new Error('Late disconnect')));
    assert.match(f.text(), /confirmó la entrega/); assert.doesNotMatch(f.text(), /envío podría seguir en curso/);
    assert.equal(f.apiRequests.filter(item => item.init.method === 'POST').length, 1);
  } finally { f.close(); }
});

test('a new Meta submission refreshes eligibility for the same contact without sending by itself', async () => {
  const f = fixture({ api: async (_url, init) => response(init.method === 'POST' ? { ok: true, status: 'accepted' } : readyStatus) }); try {
    f.update({ contacts: [{ ...a, latest_meta_lead_at: '2026-10-22T17:00:00Z' }] });
    await f.settle(); await f.click('Enviar WhatsApp'); assert.equal(f.button('Enviar WhatsApp').props.disabled, true);
    f.update({ contacts: [{ ...a, latest_meta_lead_at: '2026-10-23T17:00:00Z' }] });
    await f.settle(); assert.equal(f.button('Enviar WhatsApp').props.disabled, false);
    assert.equal(f.apiRequests.filter(item => item.init.method === 'POST').length, 1);
  } finally { f.close(); }
});

test('a manual retry after confirmed preflight rejection reuses the same request id', async () => {
  let postCount = 0;
  const f = fixture({ api: async (_url, init) => {
    if (init.method !== 'POST') return response(readyStatus);
    postCount += 1;
    return postCount === 1 ? response({ ok: false, error: 'UNAUTHENTICATED' }, 401) : response({ ok: true, status: 'accepted' });
  } }); try {
    await f.settle(); await f.click('Enviar WhatsApp'); assert.match(f.text(), /sesión caducó antes/);
    assert.equal(f.button('Enviar WhatsApp').props.disabled, true);
    await f.click('Comprobar estado'); await f.settle();
    assert.equal(f.apiRequests.filter(item => item.init.method === 'POST').length, 1);
    await f.click('Enviar WhatsApp');
    const posts = f.apiRequests.filter(item => item.init.method === 'POST').map(item => JSON.parse(item.init.body));
    assert.equal(posts.length, 2); assert.equal(posts[0].request_id, posts[1].request_id);
  } finally { f.close(); }
});
