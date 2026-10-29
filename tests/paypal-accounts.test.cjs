// Account-routing regression tests. Every provider response and database write
// is simulated in memory; this file never uses credentials or the network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const BUSINESS = 'client_business_v1';
class NextResponse extends Response {
  static json(value, options) { return new NextResponse(JSON.stringify(value), options); }
}
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => name in mocks ? mocks[name] : require(name),
    URL, Request, Response, Headers, Buffer, AbortSignal, Date, console, ...globals });
  return exports;
}
const roulette = load('src/lib/ruleta.ts');
const packs = load('src/lib/server/cliente-minute-packs.ts', { '@/lib/ruleta': roulette });
const checkout = load('src/lib/server/client-paypal-checkout.ts', { '@/lib/ruleta': roulette });

function harness(overrides = {}) {
  const env = {
    PAYPAL_ENVIRONMENT: 'live', PAYPAL_CLIENT_ID: 'fixture-legacy-client', PAYPAL_CLIENT_SECRET: 'fixture-legacy-secret',
    PAYPAL_WEBHOOK_ID: 'FIXTURE-LEGACY-WEBHOOK', PAYPAL_PUBLIC_BASE_URL: 'https://panel.test',
    PAYPAL_CUSTOMER_ENVIRONMENT: 'sandbox', PAYPAL_CUSTOMER_CLIENT_ID: 'fixture-customer-client',
    PAYPAL_CUSTOMER_CLIENT_SECRET: 'fixture-customer-secret', PAYPAL_CUSTOMER_WEBHOOK_ID: 'FIXTURE-CUSTOMER-WEBHOOK',
    PAYPAL_CUSTOMER_MERCHANT_ID: 'CUSTOMER12345', PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT: BUSINESS, ...overrides,
  };
  const rows = new Map(), remoteOrders = new Map(), calls = [], rpcCalls = [], writes = [];
  const state = { failNextCreate: false, verification: true };
  const worker = { id: id(3), role: 'central' }, client = { id: id(2) }, user = { id: id(1) };
  const admin = {
    from(table) {
      const filters = []; let mode = 'read', values, single = false, limit;
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push(row => row[key] === value); return query; },
        neq: (key, value) => { filters.push(row => row[key] !== value); return query; },
        is: (key, value) => { filters.push(row => (row[key] ?? null) === value); return query; },
        in: (key, values) => { filters.push(row => values.includes(row[key])); return query; },
        order: () => query, limit: value => { limit = value; return query; },
        maybeSingle: () => { single = true; return query; }, single: () => { single = true; return query; },
        insert: value => { mode = 'insert'; values = value; return query; },
        update: value => { mode = 'update'; values = value; return query; },
        then(resolve, reject) {
          let data, error = null;
          if (table === 'cliente_payment_settings') data = { id: 'default', paypal_client_enabled: true };
          else if (mode === 'insert') {
            writes.push({ table, mode, values: clone(values) });
            if (rows.has(values.id)) error = { code: '23505' };
            else rows.set(values.id, { checkout_kind: 'crm_collection', order_id: null, status: 'pending',
              remote_status: 'CREATING', created_at: new Date().toISOString(), ...clone(values) });
            data = error ? null : rows.get(values.id);
          } else {
            let selected = (table === 'crm_clientes' ? [client] : [...rows.values()]).filter(row => filters.every(filter => filter(row)));
            if (limit) selected = selected.slice(0, limit);
            if (mode === 'update') { writes.push({ table, mode, values: clone(values) }); selected.forEach(row => Object.assign(row, clone(values))); }
            data = single ? selected[0] || null : selected;
          }
          return Promise.resolve({ data: clone(data), error }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, params) {
      rpcCalls.push({ name, params: clone(params) });
      const row = rows.get(params.p_id);
      Object.assign(row, { status: 'completed', remote_status: 'CAPTURE_COMPLETED', capture_id: params.p_capture_id,
        ...(name === 'tc_complete_paypal_client' ? { payment_id: id(20) } : {}) });
      return { data: { ok: true }, error: null };
    },
  };
  const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(data) });
  const fetch = async (url, init) => {
    const body = init.body && JSON.parse(init.body.startsWith('{') ? init.body : '{}');
    const auth = init.headers.Authorization;
    let account;
    if (url.endsWith('/v1/oauth2/token')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString();
      if (decoded === 'fixture-legacy-client:fixture-legacy-secret') account = 'legacy';
      else if (decoded === 'fixture-customer-client:fixture-customer-secret') account = BUSINESS;
      else throw Error('Unexpected fixture credentials');
    } else account = auth === 'Bearer fixture-token-legacy' ? 'legacy' : auth === 'Bearer fixture-token-' + BUSINESS ? BUSINESS : null;
    assert.ok(account, 'All requests must use one explicitly selected account');
    const environment = account === 'legacy' ? env.PAYPAL_ENVIRONMENT : env.PAYPAL_CUSTOMER_ENVIRONMENT;
    assert.equal(new URL(url).hostname, environment === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com');
    const call = { url, account, body: clone(body), requestId: init.headers['PayPal-Request-Id'] };
    calls.push(call);
    if (url.endsWith('/v1/oauth2/token')) return response({ access_token: 'fixture-token-' + account });
    if (url.endsWith('/v1/notifications/verify-webhook-signature')) {
      const expected = account === 'legacy' ? env.PAYPAL_WEBHOOK_ID : env.PAYPAL_CUSTOMER_WEBHOOK_ID;
      return response({ verification_status: state.verification && body.webhook_id === expected ? 'SUCCESS' : 'FAILURE' });
    }
    if (url.endsWith('/v1/identity/generate-token')) return response({ client_token: 'fixture-sdk-token-' + account });
    if (url.endsWith('/v2/checkout/orders') && init.method === 'POST') {
      const localId = body.purchase_units[0].custom_id, row = rows.get(localId);
      assert.ok(row, 'Account metadata must be persisted before provider creation');
      call.savedPayloadAtCreation = clone(row.purchase_payload);
      if (state.failNextCreate) { state.failNextCreate = false; throw Error('Fixture provider timeout'); }
      const orderId = 'ORDER' + localId.slice(-3);
      const key = account + ':' + orderId;
      // PayPal identifies the receiving merchant in its response, including
      // when the create request relies on the authenticated app's default payee.
      const units = clone(body.purchase_units);
      if (account === BUSINESS) units[0].payee = { merchant_id: 'CUSTOMER12345' };
      if (!remoteOrders.has(key)) remoteOrders.set(key, { id: orderId, intent: 'CAPTURE', status: 'CREATED',
        purchase_units: units, payment_source: { card: {} } });
      return response(remoteOrders.get(key));
    }
    const match = url.match(/\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
    if (match) {
      const remote = remoteOrders.get(account + ':' + match[1]);
      if (!remote) return response({ details: [{ issue: 'RESOURCE_NOT_FOUND' }] }, 404);
      if (match[2]) {
        remote.status = 'COMPLETED';
        remote.purchase_units[0].payments = { captures: [{ id: 'CAPTURE' + match[1], status: 'COMPLETED',
          amount: clone(remote.purchase_units[0].amount) }] };
      }
      return response(remote);
    }
    throw Error('Unexpected mock provider request: ' + url);
  };
  const globals = { fetch, process: { env } };
  const paypal = load('src/lib/server/paypal-crm.ts', { '@supabase/supabase-js': { createClient: () => admin } }, globals);
  class RouletteAccessError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
  const sharedMocks = { 'next/server': { NextResponse }, '@/lib/server/paypal-crm': paypal,
    '@/lib/server/ruleta-access': { RouletteAccessError, rouletteClient: async () => ({ admin, cliente: client, user }), rouletteStaff: async () => ({ admin, worker }) },
    '@/lib/server/cliente-minute-packs': packs, '@/lib/server/client-paypal-checkout': checkout,
    '@/lib/server/oracle-premium': load('src/lib/server/oracle-premium.ts'),
    '@/lib/server/oracle-questions': load('src/lib/server/oracle-questions.ts'),
    '@/lib/server/client-promotions': { loadActivePromotion: async () => null }, '@/lib/ruleta': roulette,
    '@/lib/server/cliente-platform': { splitMinutes: n => ({ normal: n / 2, free: n / 2 }) },
  };
  const clientApi = load('src/app/api/cliente/pagos/paypal/route.ts', sharedMocks, globals);
  const centralApi = load('src/app/api/crm/pagos/paypal/route.ts', sharedMocks, globals);
  const cardApi = load('src/app/api/paypal-crm/card/route.ts', sharedMocks, globals);
  const post = (api, body, pathname) => api.POST(new Request('https://panel.test' + pathname, {
    method: 'POST', headers: { origin: 'https://panel.test', 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  function seed(account = 'legacy', overrides = {}) {
    const payload = checkout.buildClientPurchaseSnapshot(packs.CLIENTE_MINUTE_PACKS.find(p => p.id === 'pack_20'));
    if (account !== 'legacy') Object.assign(payload, { paypal_account: account, paypal_merchant_id: env.PAYPAL_CUSTOMER_MERCHANT_ID });
    const row = { id: id(10), public_token: id(99), order_id: 'ORDER010', environment: account === 'legacy' ? env.PAYPAL_ENVIRONMENT : env.PAYPAL_CUSTOMER_ENVIRONMENT,
      status: 'pending', remote_status: 'CREATED', checkout_kind: 'client_purchase', worker_id: null,
      purchaser_auth_user_id: user.id, cliente_id: client.id, amount: 22, currency: 'EUR', pack_id: 'pack_20', pack_name: payload.pack_name,
      created_at: new Date().toISOString(), purchase_payload: payload, ...overrides };
    const unit = { reference_id: row.id, custom_id: row.id, invoice_id: 'TC-' + row.id,
      amount: { currency_code: 'EUR', value: '22.00' }, ...(account === BUSINESS ? { payee: { merchant_id: env.PAYPAL_CUSTOMER_MERCHANT_ID } } : {}) };
    row.create_payload ||= { intent: 'CAPTURE', purchase_units: [clone(unit)], payment_source: { card: {} } };
    rows.set(row.id, row);
    if (row.order_id) remoteOrders.set(account + ':' + row.order_id, { id: row.order_id, intent: 'CAPTURE', status: 'CREATED',
      purchase_units: [unit], payment_source: { card: {} } });
    return row;
  }
  function completed(row, account) {
    const remote = remoteOrders.get(account + ':' + row.order_id); remote.status = 'COMPLETED';
    remote.purchase_units[0].payments = { captures: [{ id: 'CAPTURE010', status: 'COMPLETED', amount: clone(remote.purchase_units[0].amount) }] };
    return remote;
  }
  async function webhook(account, row) {
    const helper = load('src/lib/server/paypal-webhook.ts', sharedMocks, globals);
    const api = load('src/app/api/webhooks/' + (account === 'legacy' ? 'paypal-crm' : 'paypal-cliente') + '/route.ts', {
      ...sharedMocks, '@/lib/server/paypal-webhook': helper,
    }, globals);
    const headers = Object.fromEntries(['auth-algo', 'cert-url', 'transmission-id', 'transmission-sig', 'transmission-time'].map(key => ['paypal-' + key, 'fixture']));
    return api.POST(new Request('https://panel.test/api/webhooks/fixture', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'EVENT010', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE010', custom_id: row.id,
        supplementary_data: { related_ids: { order_id: row.order_id } } } }) }));
  }
  return { env, rows, calls, writes, state, paypal, admin, rpcCalls, seed, completed, remoteOrders, webhook,
    createClient: body => post(clientApi, { attemptId: id(10), packId: 'pack_20', ...body }, '/api/cliente/pagos/paypal'),
    createCentral: body => post(centralApi, { request_id: id(11), cliente_id: client.id, pack_id: 'pack_20', ...body }, '/api/crm/pagos/paypal'),
    card: (row, action = 'session') => post(cardApi, { ref: row.public_token, action }, '/api/paypal-crm/card'),
  };
}

test('Persisted account determines routing: all unmarked historical orders stay legacy and malformed markers fail closed', () => {
  const h = harness();
  for (const checkout_kind of ['client_purchase', 'crm_collection']) {
    assert.equal(h.paypal.paypalAccountForAttempt({ checkout_kind }), 'legacy');
    assert.equal(h.paypal.paypalAccountForAttempt({ checkout_kind, purchase_payload: {} }), 'legacy');
    assert.equal(h.paypal.paypalAccountForAttempt({ checkout_kind, purchase_payload: { paypal_account: 'legacy' } }), 'legacy');
  }
  const row = h.seed(BUSINESS); assert.equal(h.paypal.paypalAccountForAttempt(row), BUSINESS);
  for (const purchase_payload of [{ paypal_account: 'unknown' }, { paypal_account: null }, { paypal_account: '' }, { paypal_account: 1 },
    { paypal_account: BUSINESS }, { paypal_account: BUSINESS, paypal_merchant_id: '' }])
    assert.throws(() => h.paypal.paypalAccountForAttempt({ checkout_kind: 'client_purchase', purchase_payload }));
  assert.throws(() => h.paypal.paypalAccountForAttempt({ ...row, checkout_kind: 'crm_collection' }));
  assert.equal(h.calls.length, 0);
});

test('Future client creation persists server-selected account and merchant before creating exactly one order', async () => {
  const h = harness();
  const response = await h.createClient({ paypal_account: 'legacy', paypal_merchant_id: 'ATTACK', amount: 0.01 });
  assert.equal(response.status, 200, await response.clone().text());
  const row = h.rows.get(id(10)), create = h.calls.find(call => call.url.endsWith('/v2/checkout/orders'));
  assert.equal(row.purchase_payload.paypal_account, BUSINESS); assert.equal(row.purchase_payload.paypal_merchant_id, 'CUSTOMER12345');
  assert.equal(row.amount, 22); assert.equal(create.account, BUSINESS);
  assert.equal(create.savedPayloadAtCreation.paypal_account, BUSINESS);
  assert.equal(h.remoteOrders.get(BUSINESS + ':' + row.order_id).purchase_units[0].payee.merchant_id, row.purchase_payload.paypal_merchant_id);
  assert.equal(create.requestId, 'create-' + row.id);
  assert.equal((await h.createClient()).status, 200);
  assert.equal(h.calls.filter(call => call.url.endsWith('/v2/checkout/orders')).length, 1);
});

test('Missing or legacy activation flag keeps future purchases on legacy without customer credentials', async () => {
  for (const flag of [undefined, '', 'legacy']) {
    const h = harness({ PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT: flag, PAYPAL_CUSTOMER_CLIENT_ID: '', PAYPAL_CUSTOMER_CLIENT_SECRET: '' });
    assert.equal((await h.createClient()).status, 200);
    assert.equal(h.paypal.paypalAccountForAttempt(h.rows.get(id(10))), 'legacy');
    assert.ok(h.calls.every(call => call.account === 'legacy'));
  }
});

test('Central collections always use the legacy account despite activation or missing customer configuration', async () => {
  const h = harness({ PAYPAL_CUSTOMER_CLIENT_ID: '', PAYPAL_CUSTOMER_CLIENT_SECRET: '' });
  const response = await h.createCentral({ paypal_account: BUSINESS });
  assert.equal(response.status, 200, await response.clone().text());
  const row = h.rows.get(id(11)); assert.equal(row.checkout_kind, 'crm_collection');
  assert.equal(h.paypal.paypalAccountForAttempt(row), 'legacy'); assert.ok(h.calls.every(call => call.account === 'legacy'));
});

test('Incomplete creation retries keep their persisted account, payload and request ID after the activation flag changes', async () => {
  for (const first of ['legacy', BUSINESS]) {
    const h = harness({ PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT: first }); h.state.failNextCreate = true;
    assert.equal((await h.createClient()).status, 503);
    const row = h.rows.get(id(10)); assert.equal(row.order_id, null);
    const snapshot = JSON.stringify(row.purchase_payload), body = JSON.stringify(row.create_payload);
    h.env.PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT = first === 'legacy' ? BUSINESS : 'legacy';
    assert.equal((await h.createClient({ paypal_account: 'ATTACK' })).status, 200);
    const creates = h.calls.filter(call => call.url.endsWith('/v2/checkout/orders'));
    assert.equal(creates.length, 2); assert.ok(creates.every(call => call.account === first));
    assert.ok(creates.every(call => call.requestId === 'create-' + row.id));
    assert.equal(JSON.stringify(row.purchase_payload), snapshot); assert.equal(JSON.stringify(row.create_payload), body);
  }
});

test('Historical client retry and reconciliation remain available when new-account configuration is incomplete', async () => {
  const h = harness({ PAYPAL_CUSTOMER_CLIENT_SECRET: '' }); const row = h.seed('legacy');
  assert.equal((await h.createClient()).status, 200);
  const remote = h.completed(row, 'legacy');
  await h.paypal.reconcilePayPal(h.admin, clone(row));
  assert.equal(h.rpcCalls.length, 1); assert.equal(h.rpcCalls[0].name, 'tc_complete_paypal_client');
  assert.equal(h.rpcCalls[0].params.p_capture_id, remote.purchase_units[0].payments.captures[0].id);
  assert.ok(h.calls.every(call => call.account === 'legacy'));
});

test('Activated customer account rejects missing configuration and unknown flags without falling back or saving an order', async () => {
  for (const key of ['PAYPAL_CUSTOMER_ENVIRONMENT', 'PAYPAL_CUSTOMER_CLIENT_ID', 'PAYPAL_CUSTOMER_CLIENT_SECRET', 'PAYPAL_CUSTOMER_WEBHOOK_ID', 'PAYPAL_CUSTOMER_MERCHANT_ID']) {
    const h = harness({ [key]: '' }); const response = await h.createClient();
    assert.equal(response.status, 503, key); assert.equal(h.rows.size, 0, key); assert.equal(h.calls.length, 0, key);
  }
  const unknown = harness({ PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT: 'future-misspelling' });
  assert.equal((await unknown.createClient()).status, 503); assert.equal(unknown.rows.size, 0); assert.equal(unknown.calls.length, 0);
});

test('Business capture rejects a different configured or remote merchant before any credit', async () => {
  for (const mismatch of ['configuration', 'remote']) {
    const h = harness(), row = h.seed(BUSINESS), remote = h.completed(row, BUSINESS);
    if (mismatch === 'configuration') h.env.PAYPAL_CUSTOMER_MERCHANT_ID = 'DIFFERENT123';
    else remote.purchase_units[0].payee.merchant_id = 'DIFFERENT123';
    await assert.rejects(h.paypal.reconcilePayPal(h.admin, clone(row)));
    assert.equal(h.rpcCalls.length, 0); assert.equal(row.status, 'pending');
    assert.ok(h.calls.every(call => call.account === BUSINESS));
  }
});

test('Business approval captures only on its own account and repeated callbacks do not capture or credit again', async () => {
  const h = harness({ PAYPAL_CUSTOMER_ENVIRONMENT: 'live' }), row = h.seed(BUSINESS);
  h.remoteOrders.get(BUSINESS + ':' + row.order_id).status = 'APPROVED';
  await h.paypal.reconcilePayPal(h.admin, clone(row));
  await h.paypal.reconcilePayPal(h.admin, clone(row));
  assert.ok(h.calls.every(call => call.account === BUSINESS));
  const captures = h.calls.filter(call => call.url.endsWith('/capture'));
  assert.equal(captures.length, 1); assert.equal(captures[0].requestId, 'capture-' + row.id);
  assert.equal(h.rpcCalls.length, 1); assert.equal(h.rpcCalls[0].name, 'tc_complete_paypal_client');
  assert.equal(row.status, 'completed');
});

test('Cancellation checks the business order on its persisted account without asking for capture', async () => {
  const h = harness(), row = h.seed(BUSINESS);
  h.remoteOrders.get(BUSINESS + ':' + row.order_id).status = 'APPROVED';
  h.env.PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT = 'legacy';
  const result = await h.paypal.cancelPayPalLink(h.admin, clone(row), 'client');
  assert.equal(result.status, 'cancelled'); assert.equal(result.remote_status, 'CANCELLED_BY_CLIENT');
  assert.ok(h.calls.every(call => call.account === BUSINESS));
  assert.equal(h.calls.filter(call => call.url.endsWith('/capture')).length, 0); assert.equal(h.rpcCalls.length, 0);
});

test('SDK session uses the persisted order account for client ID and token, including old clients and Central', async () => {
  for (const [account, kind] of [[BUSINESS, 'client_purchase'], ['legacy', 'client_purchase'], ['legacy', 'crm_collection']]) {
    const h = harness(), row = h.seed(account, { checkout_kind: kind });
    const response = await h.card(row), data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.can_pay, true);
    assert.equal(data.client_id, account === 'legacy' ? 'fixture-legacy-client' : 'fixture-customer-client');
    assert.equal(data.client_token, 'fixture-sdk-token-' + account);
    assert.equal(data.environment, row.environment); assert.ok(h.calls.every(call => call.account === account));
    assert.equal(h.rpcCalls.length, 0); assert.equal(h.calls.filter(call => call.url.endsWith('/capture')).length, 0);
    for (const privateValue of ['fixture-legacy-secret', 'fixture-customer-secret', 'fixture-token-', 'CUSTOMER12345'])
      assert.ok(!JSON.stringify(data).includes(privateValue));
  }
});

test('Each webhook verifies its own app and only fulfills orders persisted for that account', async () => {
  for (const account of ['legacy', BUSINESS]) {
    const h = harness(), row = h.seed(account); h.completed(row, account);
    const response = await h.webhook(account, row); assert.equal(response.status, 200, await response.clone().text());
    assert.equal(h.rpcCalls.length, 1); assert.equal(h.rpcCalls[0].name, 'tc_complete_paypal_client');
    const verify = h.calls.find(call => call.url.includes('verify-webhook-signature'));
    assert.equal(verify.account, account);
    assert.equal(verify.body.webhook_id, account === 'legacy' ? h.env.PAYPAL_WEBHOOK_ID : h.env.PAYPAL_CUSTOMER_WEBHOOK_ID);
    assert.ok(h.calls.every(call => call.account === account));
    await h.webhook(account, row); assert.equal(h.rpcCalls.length, 1, 'Repeated webhook must not fulfill again');
  }
});

test('A valid webhook sent to the other account endpoint cannot fulfill even when both accounts use Live', async () => {
  for (const stored of ['legacy', BUSINESS]) {
    const h = harness({ PAYPAL_CUSTOMER_ENVIRONMENT: 'live' }), row = h.seed(stored); h.completed(row, stored);
    const before = JSON.stringify(row), endpoint = stored === 'legacy' ? BUSINESS : 'legacy';
    await h.webhook(endpoint, row);
    assert.equal(h.rpcCalls.length, 0); assert.equal(h.writes.length, 0); assert.equal(JSON.stringify(row), before);
    assert.equal(h.calls.filter(call => call.url.includes('/v2/checkout/orders/')).length, 0);
  }
});

test('Failed webhook signature never reaches fulfillment or account fallback', async () => {
  const h = harness(), row = h.seed(BUSINESS); h.completed(row, BUSINESS); h.state.verification = false;
  assert.equal((await h.webhook(BUSINESS, row)).status, 401); assert.equal(h.rpcCalls.length, 0); assert.equal(h.writes.length, 0);
  assert.ok(h.calls.every(call => call.account === BUSINESS));
});
