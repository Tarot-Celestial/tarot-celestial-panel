// Real React pages/modal/CRM with simulated HTTP only. No provider SDK, payment or real customer data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const { act } = renderer;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const noop = () => {};
const reply = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: index => [...data.keys()][index],
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function harness(fetch) {
  const h = { events: [], intervals: [], localStorage: storage(), sessionStorage: storage(), imports: {} };
  const window = {
    location: { search: `?ref=${id(90)}`, origin: 'https://fixture.invalid', reload: () => assert.fail('Unexpected navigation') },
    crypto: { randomUUID: () => id(99) }, sessionStorage: h.sessionStorage,
    addEventListener: noop, removeEventListener: noop, dispatchEvent: event => h.events.push(event.type), scrollTo: noop,
    setInterval: fn => { h.intervals.push(fn); return h.intervals.length; }, clearInterval: noop,
    setTimeout: () => 1, clearTimeout: noop,
    open: () => assert.fail('Receipt checks must not open WhatsApp or a payment'),
  };
  const document = { body: {}, visibilityState: 'visible', addEventListener: noop, removeEventListener: noop,
    createElement: () => assert.fail('Receipt checks must not initialize the PayPal SDK') };
  h.load = file => {
    const exports = {};
    vm.runInNewContext(compile(file), { exports, fetch, console, window, document, Date, Intl, URL, URLSearchParams,
      localStorage: h.localStorage, sessionStorage: h.sessionStorage, crypto: window.crypto,
      setTimeout: () => 1, clearTimeout: noop, Event: class { constructor(type) { this.type = type; } },
      CustomEvent: class { constructor(type) { this.type = type; } },
      require: name => {
        if (name in h.imports) return h.imports[name];
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime') return require(name);
        if (name === 'react-dom') return { createPortal: child => child };
        if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
        if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
        if (name === '@/lib/countries') return { getCountryByLabelOrCode: () => ({}), buildInternationalPhone: (_, phone) => phone };
        if (name === '@/lib/purchase-presentation') return h.load('src/lib/purchase-presentation.ts');
        throw Error(`Unexpected import ${name}`);
      },
    });
    return exports;
  };
  return h;
}
async function render(h, file, props) {
  let tree;
  await act(async () => { tree = renderer.create(React.createElement(h.load(file).default, props)); });
  return tree;
}
const button = (tree, label) => tree.root.findAllByType('button').find(node => text(node).trim() === label);
const status = tree => text(tree.root.findByProps({ role: 'status' }));
const centralSession = { amount: 22, currency: 'EUR', description: 'Consulta simulada', status: 'completed', remote_status: 'COMPLETED', can_pay: false, checkout_kind: 'crm_collection' };

test('Central card receipt confirms the collection without claiming purchase delivery or touching self-service attempts', async () => {
  const requests = [];
  const h = harness(async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return reply(centralSession); });
  const key = 'tc-client-purchase-attempt:v1:fixture';
  h.localStorage.setItem(key, JSON.stringify({ attemptId: id(91), url: `https://fixture.invalid/pago-tarjeta?ref=${id(90)}` }));
  const tree = await render(h, 'src/app/pago-tarjeta/page.tsx');
  assert.match(status(tree), /Cobro confirmado.*Central.*registra la compra por separado.*Registrar llamada/);
  assert.doesNotMatch(status(tree), /compra (?:está|ya).*registrad|beneficios.*añadidos|minutos.*añadidos/);
  assert.equal(tree.root.findAllByProps({ 'aria-label': 'Minutos de tu compra' }).length, 0);
  assert.deepEqual(h.events, []);
  assert.notEqual(h.localStorage.getItem(key), null);
  assert.deepEqual(requests.map(request => [request.url, request.body.action]), [['/api/paypal-crm/card', 'session']]);
  await act(async () => tree.unmount());
});

test('self-service minutes are only advertised as delivered after credited confirmation, which signals balances exactly once', async () => {
  const requests = [];
  const session = { ...centralSession, checkout_kind: 'client_purchase', credited: false, attempt_id: id(91),
    purchase_summary: { packName: '20 minutos', purchaseKind: 'minutes', totalMinutes: 20, normalMinutes: 20, freeMinutes: 0 } };
  const h = harness(async (url, init) => {
    const body = JSON.parse(init.body); requests.push(body.action);
    return reply({ ...session, credited: body.action === 'capture' });
  });
  const key = 'tc-client-purchase-attempt:v1:fixture'; h.localStorage.setItem(key, JSON.stringify({ attemptId: id(91) }));
  const tree = await render(h, 'src/app/pago-tarjeta/page.tsx');
  assert.match(status(tree), /Estamos confirmando.*minutos y beneficios/);
  assert.doesNotMatch(status(tree), /ya están añadidos|Central registra/);
  assert.notEqual(h.localStorage.getItem(key), null); assert.deepEqual(h.events, []);
  await act(async () => button(tree, 'Comprobar estado del pago').props.onClick());
  assert.match(status(tree), /Tus minutos y beneficios ya están añadidos/);
  assert.equal(h.localStorage.getItem(key), null);
  assert.deepEqual(h.events, ['tc-client-balances-changed']);
  assert.deepEqual(requests, ['session', 'capture']);
  assert.equal(tree.root.findByProps({ href: '/cliente/dashboard' }).children.join(''), 'Ver mis minutos y beneficios');
  await act(async () => tree.unmount());
});

for (const oracle of [{ oracleCredits: 2, oracleQuestions: 0, label: '2 tiradas del Oráculo' }, { oracleCredits: 0, oracleQuestions: 3, label: '3 preguntas adicionales' }]) {
  test(`self-service Oracle receipt preserves its actual entitlement (${oracle.label}) and never promises minutes`, async () => {
    const h = harness(async () => reply({ ...centralSession, amount: 2, checkout_kind: 'client_purchase', credited: true, purchase_kind: 'oracle',
      purchase_summary: { packName: 'Oráculo simulado', purchaseKind: 'oracle', ...oracle, totalMinutes: 0, normalMinutes: 0, freeMinutes: 0 } }));
    const tree = await render(h, 'src/app/pago-tarjeta/page.tsx');
    assert.match(status(tree), /Tu compra del Oráculo ya está disponible/);
    assert.ok(text(tree.root.findByProps({ 'aria-label': 'Oráculo de tu compra' })).includes(oracle.label));
    assert.equal(tree.root.findAllByProps({ 'aria-label': 'Minutos de tu compra' }).length, 0);
    assert.equal(tree.root.findByProps({ href: '/cliente/oraculo' }).children.join(''), 'Volver a mi Oráculo');
    assert.deepEqual(h.events, ['tc-client-balances-changed']);
    await act(async () => tree.unmount());
  });
}

test('Central PayPal return transitions from pending to collection confirmed without a purchase registration request', async () => {
  const requests = [];
  const h = harness(async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return reply({ status: requests.length === 1 ? 'pending' : 'completed' }); });
  const tree = await render(h, 'src/app/pago-paypal/page.tsx');
  assert.match(status(tree), /aún no ha confirmado.*No repitas el pago/);
  await act(async () => button(tree, 'Comprobar de nuevo').props.onClick());
  assert.match(status(tree), /Cobro PayPal confirmado.*Central.*compra por separado.*Registrar llamada/);
  assert.doesNotMatch(status(tree), /compra ya se ha registrado/);
  assert.ok(requests.every(request => request.url === '/api/paypal-crm/confirm' && request.body.ref === id(90) && request.body.cancel === false));
  assert.equal(requests.length, 2); assert.deepEqual(h.events, []);
  await act(async () => tree.unmount());
});

const fixtureClient = { id: id(1), nombre: 'Cliente simulada', apellido: '', rango_actual: 'bronce', rango_efectivo: 'bronce', rango_automatico: 'bronce',
  rango_gasto_mes_anterior: 22, rango_compras_mes_anterior: 1, minutos_free_pendientes: 4, minutos_normales_pendientes: 8, puntos: 0 };
const pendingAttempt = { id: id(50), checkout_url: `https://fixture.invalid/pago-tarjeta?ref=${id(90)}`, amount: 22, currency: 'EUR', status: 'pending', remote_status: 'capture_completed' };

for (const review of [false, true]) {
  test(`Central modal ${review ? 'review' : 'processing'} preserves the received-money warning, then notifies confirmation once without writing a purchase`, async () => {
    const requests = []; let paid = 0, completed = false;
    const attempt = { ...pendingAttempt, last_error: review ? 'Resultado local pendiente' : null };
    const h = harness(async (url, init = {}) => {
      assert.ok(!init.method || init.method === 'GET'); requests.push(url);
      return reply(url.includes('attempt_id=') ? { ok: true, attempt: { ...attempt, status: completed ? 'completed' : 'pending' } } : { ok: true, packs: [], latest: attempt });
    });
    const tree = await render(h, 'src/components/crm/PayPalCrmPaymentModal.tsx', { open: true, cliente: fixtureClient, getToken: async () => 'fixture', onClose: noop, onPaid: async () => { paid++; } });
    const hero = () => tree.root.findByProps({ className: 'paymentStateHero' });
    assert.equal(hero().props['data-state'], review ? 'review' : 'processing');
    assert.match(text(hero()), /dinero ya se ha recibido.*No solicites otro pago.*confirmación del cobro/);
    assert.doesNotMatch(text(hero()), /PROCESANDO COMPRA|registro y los beneficios/);
    assert.equal(paid, 0);
    assert.equal(button(tree, 'Envío manual · Abrir WhatsApp').props.disabled, true);
    completed = true;
    await act(async () => button(tree, 'Comprobar').props.onClick());
    assert.equal(hero().props['data-state'], 'success'); assert.equal(paid, 1);
    assert.match(text(tree.toJSON()), /Para registrar la compra.*Registrar llamada.*Registrar una compra nueva/);
    await act(async () => button(tree, 'Comprobar').props.onClick());
    assert.equal(paid, 1); assert.deepEqual(h.events, []);
    assert.ok(requests.every(url => url.startsWith('/api/crm/pagos/paypal?')));
    await act(async () => tree.unmount());
  });
}

test('real CRM onPaid only reloads the confirmed server data; it neither writes a purchase nor emits purchase accounting events', async () => {
  const requests = []; let completed = false;
  const h = harness(async (url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET', `Unexpected mutation from confirmation: ${url}`);
    requests.push(url);
    const pathname = new URL(url, 'https://fixture.invalid').pathname;
    if (pathname === '/api/crm/pagos/paypal') return reply(url.includes('attempt_id=')
      ? { ok: true, attempt: { ...pendingAttempt, status: completed ? 'completed' : 'pending' } }
      : { ok: true, packs: [], latest: pendingAttempt });
    if (pathname === '/api/crm/clientes/ficha') return reply({ ok: true, cliente: fixtureClient });
    if (pathname === '/api/crm/clientes/buscar') return reply({ ok: true, clientes: [fixtureClient] });
    return reply({ ok: true, etiquetas: [], tarotistas: [], leads: [], pagos: [], notas: [], summary: {} });
  });
  const blank = () => null;
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: noop };
  const params = new URLSearchParams();
  Object.assign(h.imports, {
    'next/navigation': { useRouter: () => ({ replace: noop }), useSearchParams: () => params },
    '@/lib/supabase-browser': { supabaseBrowser: () => sb },
    '@/components/ui/KpiCard': { __esModule: true, default: blank }, '@/components/crm/RegistrarLlamadaModal': { __esModule: true, default: blank },
    '@/components/crm/ClienteSidebar': { __esModule: true, default: blank }, '@/components/crm/ClienteTimeline': { __esModule: true, default: blank },
    '@/components/crm/PayPalCrmPaymentModal': h.load('src/components/crm/PayPalCrmPaymentModal.tsx'),
    '@/components/global/BrandSwitcher': { getActiveBrand: () => 'celestial' },
    '@/lib/tc-toast': { tcToast: noop }, '@/hooks/useRouletteSignal': { useRouletteSignal: noop },
    '@/lib/background-fetch': { backgroundFetch: async (url, init) => { throw Error(`Unexpected background request ${url}`); } },
  });
  const tree = await render(h, 'src/components/crm/CRMClientesPanel.tsx', { mode: 'central' });
  await act(async () => button(tree, 'Ver ficha').props.onClick());
  await act(async () => button(tree, '💳 Realizar pago').props.onClick());
  const readsBefore = requests.length;
  completed = true;
  await act(async () => button(tree, 'Comprobar').props.onClick());
  const refreshReads = requests.slice(readsBefore);
  assert.ok(refreshReads.some(url => url.startsWith('/api/crm/clientes/ficha?')));
  assert.ok(refreshReads.some(url => url.startsWith('/api/crm/pagos/listar?')));
  assert.ok(requests.every(url => !url.includes('/rendimiento/registrar') && !url.includes('/pagos/crear')));
  assert.match(text(tree.toJSON()), /Pago PayPal confirmado.*La compra se registra desde.*Registrar llamada/);
  assert.deepEqual(h.events, []);
  const minuteField = label => tree.root.findAllByProps({ className: 'tc-sub' }).find(node => text(node) === label).parent.findByType('input');
  assert.equal(String(minuteField('Min free pendientes').props.value), '4');
  assert.equal(String(minuteField('Min normales pendientes').props.value), '8');
  const count = requests.filter(url => url.includes('/clientes/ficha?')).length;
  await act(async () => button(tree, 'Comprobar').props.onClick());
  assert.equal(requests.filter(url => url.includes('/clientes/ficha?')).length, count, 'repeat confirmation must not repeat the onPaid refresh');
  await act(async () => tree.unmount());
});
