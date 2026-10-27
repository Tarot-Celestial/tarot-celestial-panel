// Exercise the real checkout component with a simulated browser and SDK.
// All payment API calls and SDK loads stay local; no provider requests occur.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const ts = require('typescript'), React = require('react'), renderer = require('react-test-renderer');

const centralRef = '00000000-0000-4000-8000-000000000001';
const customerRef = '00000000-0000-4000-8000-000000000002';
function harness() {
  const scripts = [], requests = [], cards = [], timers = new Map();
  const base = { amount: 26, currency: 'EUR', description: '30 minutos', status: 'pending', remote_status: 'CREATED', can_pay: true };
  const sessions = new Map([
    [centralRef, { ...base, client_id: 'central-client', client_token: 'central-token' }],
    [customerRef, { ...base, client_id: 'customer-client', client_token: 'customer-token' }],
  ]);
  let timerId = 0;
  const window = { location: { search: '', origin: 'https://local.invalid' }, crypto: { randomUUID },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; } };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/app/pago-tarjeta/page.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { exports, window, URLSearchParams, URL, clearTimeout: id => timers.delete(id),
    document: { createElement: () => ({ dataset: {}, remove() { this.removed = true; } }),
      head: { appendChild: script => scripts.push(script) } },
    fetch: async (url, options) => {
      assert.equal(url, '/api/paypal-crm/card');
      const body = JSON.parse(options.body); requests.push(body);
      assert.ok(sessions.has(body.ref));
      const result = body.action === 'order' ? { order_id: `ORDER-${body.ref}` }
        : body.action === 'capture' ? { ...sessions.get(body.ref), status: 'completed', can_pay: false }
        : sessions.get(body.ref);
      return { ok: true, json: async () => result };
    },
    require: name => name === 'react' ? React : name === 'react/jsx-runtime' ? require(name)
      : name.endsWith('.css') ? { default: {} } : (() => { throw Error(name); })(),
  });
  return { scripts, requests, cards, timers, window, sessions,
    async mount(ref) {
      window.location.search = `?ref=${ref}`;
      let tree;
      await renderer.act(async () => { tree = renderer.create(React.createElement(exports.default)); });
      return tree;
    },
    async load(script, account) {
      await renderer.act(async () => {
        // A real SDK publishes to data-namespace before firing the load event,
        // even if its script element was removed while the response was pending.
        window[script.dataset.namespace] = { CardFields(options) {
          const record = { account, rendered: [], closed: 0, submitted: 0 }; cards.push(record);
          const field = () => ({ render: async selector => record.rendered.push(selector), close: () => record.closed++ });
          return { isEligible: () => true, NameField: field, NumberField: field, ExpiryField: field, CVVField: field,
            getState: async () => ({ isFormValid: true }),
            submit: async () => { record.submitted++; await options.createOrder(); await options.onApprove(); } };
        } };
        script.onload();
      });
    },
  };
}

test('late SDK from a previous account cannot replace or initialize the current checkout', async () => {
  const h = harness();
  const first = await h.mount(centralRef), oldScript = h.scripts[0];
  assert.equal(new URL(oldScript.src).searchParams.get('client-id'), 'central-client');
  assert.equal(oldScript.dataset.clientToken, 'central-token');
  await renderer.act(async () => first.unmount());
  assert.equal(oldScript.removed, true);
  assert.equal(h.timers.size, 0, 'unmount cancels the SDK timeout');

  const current = await h.mount(customerRef), currentScript = h.scripts[1];
  try {
    assert.notEqual(oldScript.dataset.namespace, currentScript.dataset.namespace);
    assert.equal(new URL(currentScript.src).searchParams.get('client-id'), 'customer-client');
    assert.equal(currentScript.dataset.clientToken, 'customer-token');
    await h.load(currentScript, 'customer');
    const currentSDK = h.window[currentScript.dataset.namespace];
    await h.load(oldScript, 'central');
    assert.equal(h.window[currentScript.dataset.namespace], currentSDK);
    assert.equal(h.window[oldScript.dataset.namespace], undefined);
    assert.deepEqual(h.cards.map(card => card.account), ['customer']);
    assert.equal(h.cards[0].rendered.length, 4);
    await renderer.act(async () => current.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(h.cards[0].submitted, 1);
    assert.deepEqual(h.requests.filter(call => call.action !== 'session'), [
      { ref: customerRef, action: 'order' }, { ref: customerRef, action: 'capture' },
    ]);
  } finally { await renderer.act(async () => current.unmount()); }
  assert.equal(h.window[currentScript.dataset.namespace], undefined);
  assert.equal(h.cards[0].closed, 4);
  assert.equal(h.timers.size, 0);
});

test('timed-out SDK is discarded and cannot become payable when its script eventually loads', async () => {
  const h = harness(), tree = await h.mount(customerRef), script = h.scripts[0];
  try {
    await renderer.act(async () => { const [id, expire] = [...h.timers][0]; h.timers.delete(id); expire(); });
    assert.equal(script.removed, true);
    assert.match(JSON.stringify(tree.toJSON()), /PayPal no ha cargado/);
    await h.load(script, 'customer');
    assert.equal(h.window[script.dataset.namespace], undefined);
    assert.deepEqual(h.cards, []);
    await renderer.act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(h.requests.map(call => call.action), ['session']);
  } finally { await renderer.act(async () => tree.unmount()); }
});

test('an incomplete account session never loads a fallback SDK', async () => {
  const h = harness();
  delete h.sessions.get(customerRef).client_id;
  const tree = await h.mount(customerRef);
  try {
    assert.equal(h.scripts.length, 0);
    assert.match(JSON.stringify(tree.toJSON()), /El formulario de tarjeta no está disponible/);
  } finally { await renderer.act(async () => tree.unmount()); }
});
