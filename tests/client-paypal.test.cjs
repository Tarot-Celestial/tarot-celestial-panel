// Local-only contract tests: no network, credentials, real clients or payments.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const clean = value => JSON.parse(JSON.stringify(value));
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in mocks ? mocks[name] : require(name), URL, Request, Response, Headers, Buffer, AbortSignal, Date, console, ...globals });
  return exports;
}
const roulette = load('src/lib/ruleta.ts');
const packModule = load('src/lib/server/cliente-minute-packs.ts', { '@/lib/ruleta': roulette });
const packById = Object.fromEntries(packModule.CLIENTE_MINUTE_PACKS.map(pack => [pack.id, pack]));
const clientPayPalOriginAllowed = load('src/lib/server/paypal-crm.ts', { '@supabase/supabase-js': {} }).clientPayPalOriginAllowed;
function checkoutModule() {
  return load('src/lib/server/client-paypal-checkout.ts', { 'server-only': {}, '@/lib/server/cliente-minute-packs': packModule, '@/lib/ruleta': roulette });
}
const expectedSplits = [
  [10, 10, 0], [20, 20, 0], [30, 20, 10], [40, 30, 10], [50, 30, 20],
  [60, 40, 20], [80, 50, 30], [120, 80, 40], [180, 120, 60],
];

test('Nine purchased minute packs use the exact normal/FREE split, independent of the old generic half split', () => {
  const helper = checkoutModule();
  for (const [total, normal, free] of expectedSplits) {
    assert.deepEqual(clean(helper.splitPurchasedPackMinutes(total)), { normal, free });
    const snapshot = helper.buildClientPurchaseSnapshot(packById['pack_' + total]);
    assert.equal(snapshot.normal, normal); assert.equal(snapshot.free, free);
    assert.equal(snapshot.normal + snapshot.free, total);
    assert.equal(snapshot.pack_id, 'pack_' + total);
  }
  for (const invalid of [0, -10, 15, 100, NaN, Infinity]) assert.throws(() => helper.splitPurchasedPackMinutes(invalid));
});

function routeHarness() {
  const rows = new Map(), providerRequests = [], remoteOrders = new Map(), reads = [];
  const auth = { user: { id: id(1) }, cliente: { id: id(2) } };
  const config = { environment: 'sandbox', origin: 'https://panel.test' };
  const state = { enabled: true, settingsError: false, failCreate: false, promotion: null };
  const promotions = load('src/lib/server/client-promotions.ts', { '@/lib/ruleta': roulette, '@/lib/server/rank-benefits': {}, '@/lib/server/cliente-platform': {} });
  const admin = { from(table) {
    let filters = [], operation = 'read', values, single = false, limit;
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push(row => row[key] === value); return query; },
      neq: (key, value) => { filters.push(row => row[key] !== value); return query; },
      is: (key, value) => { filters.push(row => (row[key] ?? null) === value); return query; },
      in: (key, values) => { filters.push(row => values.includes(row[key])); return query; },
      order: () => query, limit: value => { limit = value; return query; },
      maybeSingle: () => { single = true; return query; }, single: () => { single = true; return query; },
      insert: value => { operation = 'insert'; values = value; return query; },
      update: value => { operation = 'update'; values = value; return query; },
      then(resolve, reject) {
        let data, error = null;
        reads.push({ table, operation });
        if (table === 'cliente_payment_settings') {
          data = { id: true, paypal_client_enabled: state.enabled, web_payments_enabled: false };
          if (state.settingsError) error = { message: 'fixture settings unavailable' };
          if (!single) data = [data];
        } else if (operation === 'insert') {
          if (rows.has(values.id)) error = { code: '23505' };
          else rows.set(values.id, { ...values, order_id: null, status: 'pending', remote_status: 'CREATING', created_at: new Date().toISOString() });
          data = error ? null : clean(rows.get(values.id));
        } else {
          let selected = [...rows.values()].filter(row => filters.every(filter => filter(row)));
          if (limit) selected = selected.slice(0, limit);
          if (operation === 'update') selected.forEach(row => Object.assign(row, values));
          data = single ? selected[0] || null : selected;
          data = data ? clean(data) : data;
        }
        return Promise.resolve({ data, error }).then(resolve, reject);
      },
    };
    return query;
  } };
  class PayPalError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
  class RouletteAccessError extends Error { constructor(message, status = 401) { super(message); this.status = status; } }
  const paypal = {
    PAYPAL_TABLE: 'crm_paypal_orders', PayPalError, paypalConfig: () => config, clientPayPalOriginAllowed,
    approvalUrl: order => 'https://www.sandbox.paypal.com/checkoutnow?token=' + order.id,
    paypalRequest: async (url, payload, requestId) => {
      providerRequests.push({ url, payload: clean(payload), requestId });
      if (state.failCreate) throw new PayPalError('Fixture provider unavailable', 503);
      if (!remoteOrders.has(requestId)) remoteOrders.set(requestId, { id: 'ORDER' + (remoteOrders.size + 1), status: 'CREATED' });
      return remoteOrders.get(requestId);
    },
  };
  const api = load('src/app/api/cliente/pagos/paypal/route.ts', {
    'next/server': { NextResponse: { json: (value, options) => new Response(JSON.stringify(value), options) } },
    '@/lib/server/ruleta-access': { RouletteAccessError, rouletteClient: async request => {
      if (request.headers.get('authorization') !== 'Bearer fixture') throw new RouletteAccessError('No autorizado', 401);
      return { ...auth, admin };
    } },
    '@/lib/server/cliente-minute-packs': packModule,
    '@/lib/server/client-promotions': { ...promotions, loadActivePromotion: async () => state.promotion },
    '@/lib/server/client-paypal-checkout': checkoutModule(),
    '@/lib/server/paypal-crm': paypal,
  });
  const post = (overrides = {}, options = {}) => api.POST(new Request('https://panel.test/api/cliente/pagos/paypal', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: options.authorization || 'Bearer fixture', ...(options.origin === null ? {} : { origin: options.origin === undefined ? config.origin : options.origin }) },
    body: JSON.stringify({ packId: 'pack_20', attemptId: id(10), ...overrides }),
  }));
  return { api, post, auth, rows, state, config, reads, providerRequests, remoteOrders };
}

test('Client PayPal route verifies auth and origin before creating orders', async () => {
  const h = routeHarness();
  assert.equal((await h.post({}, { authorization: 'Bearer forged' })).status, 401);
  assert.ok((await h.post({}, { origin: 'https://foreign.invalid' })).status >= 400);
  assert.equal(h.providerRequests.length, 0); assert.equal(h.rows.size, 0);
});

test('Disabled or unavailable PayPal flag fails closed without enabling Mollie payments', async () => {
  for (const unavailable of [false, true]) {
    const h = routeHarness(); h.state.enabled = false; h.state.settingsError = unavailable;
    assert.ok((await h.post()).status >= 400); assert.equal(h.providerRequests.length, 0); assert.equal(h.rows.size, 0);
  }
});

test('Server owns EUR price, customer identity and minute snapshot even when body forges payment data', async () => {
  const h = routeHarness();
  const response = await h.post({ amount: 0.01, currency: 'USD', cliente_id: id(90), purchaser_auth_user_id: id(91), free: 500, normal: 500 });
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.currency, 'EUR'); assert.equal(body.amount, 22); assert.equal(body.attempt_id, id(10));
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  const saved = h.rows.get(id(10));
  assert.equal(saved.checkout_kind, 'client_purchase'); assert.equal(saved.worker_id, null);
  assert.equal(saved.cliente_id, h.auth.cliente.id); assert.equal(saved.purchaser_auth_user_id, h.auth.user.id);
  assert.equal(saved.purchase_payload.normal, 20); assert.equal(saved.purchase_payload.free, 0);
  assert.equal(saved.create_payload.purchase_units[0].amount.currency_code, 'EUR');
  assert.equal(saved.create_payload.purchase_units[0].amount.value, '22.00');
  assert.equal(saved.create_payload.purchase_units[0].custom_id, id(10));
});

test('All nine real pack identifiers keep prices and exact minute bucket snapshots', async () => {
  for (const [total, normal, free] of expectedSplits) {
    const h = routeHarness(), pack = packById['pack_' + total];
    const response = await h.post({ packId: pack.id }); assert.equal(response.status, 200);
    const saved = h.rows.get(id(10));
    assert.equal(saved.amount, pack.priceUsd); assert.equal(saved.currency, 'EUR');
    assert.equal(saved.purchase_payload.normal, normal); assert.equal(saved.purchase_payload.free, free);
    assert.equal(saved.purchase_payload.oracle_credits, pack.oracleCredits || 0);
    assert.equal(saved.purchase_payload.roulette_spins, pack.rouletteSpins);
  }
});

test('Retry and simultaneous duplicate client requests reuse the same PayPal idempotency key and order', async () => {
  const h = routeHarness();
  const responses = await Promise.all([h.post(), h.post()]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal((await h.post()).status, 200);
  assert.equal(h.rows.size, 1); assert.equal(h.remoteOrders.size, 1);
  assert.equal(new Set(h.providerRequests.map(request => request.requestId)).size, 1);
});

test('An attempt cannot be reused by another authenticated customer or for a different package', async () => {
  const h = routeHarness(); await h.post(); const before = h.providerRequests.length;
  h.auth.user.id = id(80); h.auth.cliente.id = id(81);
  assert.ok((await h.post()).status >= 400); assert.equal(h.providerRequests.length, before);
  h.auth.user.id = id(1); h.auth.cliente.id = id(2);
  assert.equal((await h.post({ packId: 'pack_30' })).status, 409); assert.equal(h.providerRequests.length, before);
});

test('Another pending pack opens an independent payment without cancelling the first', async () => {
  const h = routeHarness(); await h.post();
  const response = await h.post({ attemptId: id(11), packId: 'pack_30' });
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.attempt_id, id(11)); assert.ok(body.url);
  assert.equal(h.rows.size, 2); assert.equal(h.remoteOrders.size, 2);
  assert.equal(h.rows.get(id(10)).status, "pending");
  assert.notEqual(h.rows.get(id(10)).approval_url, body.url);
});

test('Provider failure preserves the attempt for retry and invalid packs or IDs create nothing', async () => {
  const h = routeHarness();
  for (const body of [{ packId: 'unknown' }, { attemptId: 'not-a-uuid' }]) assert.equal((await h.post(body)).status, 400);
  assert.equal(h.rows.size, 0); h.state.failCreate = true; assert.ok((await h.post()).status >= 400);
  const snapshot = JSON.stringify(h.rows.get(id(10)).purchase_payload);
  h.state.failCreate = false; assert.equal((await h.post()).status, 200);
  assert.equal(JSON.stringify(h.rows.get(id(10)).purchase_payload), snapshot);
  assert.equal(h.remoteOrders.size, 1);
});

function providerHarness(options = {}) {
  let state = { id: id(10), order_id: 'ORDER10', environment: 'sandbox', currency: 'EUR', amount: 22, status: 'pending', remote_status: 'APPROVED', checkout_kind: 'client_purchase', purchaser_auth_user_id: id(1), cliente_id: id(2), worker_id: null };
  const unit = { custom_id: state.id, invoice_id: 'TC-' + state.id, amount: { currency_code: 'EUR', value: '22.00' } };
  const remote = { id: 'ORDER10', intent: 'CAPTURE', status: options.status || 'APPROVED', purchase_units: [unit] };
  const requests = [], rpcCalls = [], credited = new Set();
  let failCredit = !!options.failCredit;
  const capture = status => ({ id: 'CAPTURE10', status, amount: { currency_code: 'EUR', value: '22.00' } });
  if (options.captureStatus) unit.payments = { captures: [capture(options.captureStatus)] };
  if (options.mutate) options.mutate(remote);
  const fetch = async (url, init) => {
    requests.push({ url, requestId: init?.headers?.['PayPal-Request-Id'] });
    if (url.endsWith('/token')) return { ok: true, json: async () => ({ access_token: 'fixture-only-token' }) };
    if (url.endsWith('/capture')) {
      remote.status = 'COMPLETED'; unit.payments = { captures: [capture(options.pending ? 'PENDING' : 'COMPLETED')] };
      if (options.timeoutAfterCapture) throw Error('Fixture timeout after provider accepted capture');
    }
    return { ok: true, json: async () => clean(remote) };
  };
  const admin = {
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (failCredit) return { error: { message: 'Fixture database confirmation failure' } };
      credited.add(params.p_capture_id); state = { ...state, status: 'completed', capture_id: params.p_capture_id, payment_id: id(20) };
      return { data: { ok: true }, error: null };
    },
    from() {
      let filters = [], patch;
      const query = {
        select: () => query, single: () => query, maybeSingle: () => query,
        eq: (key, value) => { filters.push(row => row[key] === value); return query; },
        neq: (key, value) => { filters.push(row => row[key] !== value); return query; },
        update: value => { patch = value; return query; },
        then(resolve, reject) {
          const match = filters.every(filter => filter(state));
          if (match && patch) state = { ...state, ...patch };
          return Promise.resolve({ data: match ? clean(state) : null, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const api = load('src/lib/server/paypal-crm.ts', { '@supabase/supabase-js': {} }, {
    fetch, process: { env: { PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CLIENT_ID: 'fixture-client', PAYPAL_CLIENT_SECRET: 'fixture-secret', PAYPAL_WEBHOOK_ID: 'fixture-webhook', PAYPAL_PUBLIC_BASE_URL: 'https://panel.test' } },
  });
  return { api, admin, remote, requests, rpcCalls, credited, attempt: () => clean(state), recoverCredit() { failCredit = false; } };
}

test('Approved client capture calls the client purchase RPC and repeated/concurrent callbacks capture once', async () => {
  const h = providerHarness();
  await Promise.all([h.api.reconcilePayPal(h.admin, h.attempt()), h.api.reconcilePayPal(h.admin, h.attempt())]);
  await h.api.reconcilePayPal(h.admin, h.attempt());
  assert.equal(h.requests.filter(request => request.url.endsWith('/capture')).length, 1);
  assert.equal(h.credited.size, 1);
  assert.ok(h.rpcCalls.every(call => call.name === 'tc_complete_paypal_client'));
  assert.equal(h.rpcCalls[0].params.p_currency, 'EUR'); assert.equal(h.rpcCalls[0].params.p_amount, 22);
  assert.equal(h.requests.find(request => request.url.endsWith('/capture')).requestId, 'capture-' + id(10));
});

test('Unapproved, cancelled, rejected and pending captures cannot award purchased minutes or benefits', async () => {
  for (const options of [{ status: 'CREATED' }, { status: 'VOIDED' }, { status: 'COMPLETED', captureStatus: 'DECLINED' }, { status: 'COMPLETED', captureStatus: 'PENDING' }, { pending: true }]) {
    const h = providerHarness(options); await h.api.reconcilePayPal(h.admin, h.attempt());
    assert.equal(h.credited.size, 0); assert.equal(h.rpcCalls.length, 0);
    if (!options.pending) assert.equal(h.requests.filter(request => request.url.endsWith('/capture')).length, 0);
  }
  const cancelled = providerHarness(); await cancelled.api.reconcilePayPal(cancelled.admin, cancelled.attempt(), false);
  assert.equal(cancelled.requests.filter(request => request.url.endsWith('/capture')).length, 0); assert.equal(cancelled.credited.size, 0);
});

test('Client confirmation rejects mismatched order, invoice, amount, currency or capture before any credit', async () => {
  for (const mutate of [
    order => { order.id = 'OTHER'; },
    order => { order.purchase_units[0].custom_id = id(99); },
    order => { order.purchase_units[0].invoice_id = 'OTHER'; },
    order => { order.purchase_units[0].amount.value = '1.00'; },
    order => { order.purchase_units[0].amount.currency_code = 'USD'; },
    order => { order.purchase_units[0].payments.captures[0].amount.value = '1.00'; },
    order => { order.purchase_units[0].payments.captures[0].amount.currency_code = 'USD'; },
    order => { order.purchase_units[0].payments.captures.push(clean(order.purchase_units[0].payments.captures[0])); },
  ]) {
    const h = providerHarness({ status: 'COMPLETED', captureStatus: 'COMPLETED', mutate });
    await assert.rejects(h.api.reconcilePayPal(h.admin, h.attempt())); assert.equal(h.credited.size, 0); assert.equal(h.rpcCalls.length, 0);
  }
});

test('Captured payment retries database confirmation without another capture or a duplicate credit', async () => {
  const h = providerHarness({ failCredit: true });
  await assert.rejects(h.api.reconcilePayPal(h.admin, h.attempt()), /Pago recibido/);
  assert.equal(h.attempt().remote_status, 'CAPTURE_COMPLETED'); assert.equal(h.credited.size, 0);
  h.recoverCredit(); await h.api.reconcilePayPal(h.admin, h.attempt()); await h.api.reconcilePayPal(h.admin, h.attempt());
  assert.equal(h.credited.size, 1); assert.equal(h.requests.filter(request => request.url.endsWith('/capture')).length, 1);
});

test('Provider timeout after capture is reconciled as the original purchase with no second capture', async () => {
  const h = providerHarness({ timeoutAfterCapture: true }); await h.api.reconcilePayPal(h.admin, h.attempt());
  assert.equal(h.credited.size, 1); assert.equal(h.requests.filter(request => request.url.endsWith('/capture')).length, 1);
  assert.ok(h.rpcCalls.every(call => call.name === 'tc_complete_paypal_client'));
});

function cardRouteHarness(kind = 'client_purchase') {
  const ref = id(99), calls = [];
  const row = { id: id(10), public_token: ref, order_id: 'ORDER10', environment: 'sandbox', status: 'pending', remote_status: 'CREATED',
    checkout_kind: kind, amount: 26, currency: 'EUR', pack_name: '30 minutos', cliente_id: id(2), purchaser_auth_user_id: id(1),
    created_at: new Date().toISOString(), purchase_payload: { total_minutes: 30, normal: 20, free: 10 }, create_payload: { payment_source: { card: {} } } };
  const admin = { from() {
    const filters = []; const query = { select: () => query, eq: (key, value) => { filters.push(() => row[key] === value); return query; },
      maybeSingle: async () => ({ data: filters.every(filter => filter()) ? row : null, error: null }) };
    return query;
  } };
  class PayPalError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
  const config = { origin: 'https://panel.test', environment: 'sandbox', client: 'fixture-public-id' };
  const helpers = { PAYPAL_TABLE: 'crm_paypal_orders', PayPalError, paypalConfig: () => config, clientPayPalOriginAllowed, paypalAdmin: () => admin,
    reconcilePayPal: async (_admin, attempt, capture) => { calls.push({ action: 'reconcile', capture }); return attempt; },
    cancelPayPalLink: async (_admin, attempt, actor) => { calls.push({ action: 'cancel', actor }); Object.assign(attempt, { status: 'cancelled', remote_status: 'CANCELLED_BY_CLIENT' }); return attempt; },
    validateOrder: () => {}, paypalRequest: async url => url.includes('generate-token') ? { client_token: 'fixture-client-token' } : { id: 'ORDER10', status: 'CREATED' },
  };
  class NextResponse extends Response { static json(value, options) { return new NextResponse(JSON.stringify(value), options); } }
  const api = load('src/app/api/paypal-crm/card/route.ts', { 'next/server': { NextResponse }, '@/lib/server/paypal-crm': helpers });
  const post = (action, origin = config.origin) => api.POST(new Request('https://panel.test/api/paypal-crm/card', { method: 'POST', headers: { ...(origin === null ? {} : { origin }), 'content-type': 'application/json' }, body: JSON.stringify({ ref, action }) }));
  return { row, calls, config, helpers, post };
}

test('Client checkout session exposes exact purchased split without private customer identifiers', async () => {
  const h = cardRouteHarness(), response = await h.post('session'), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.checkout_kind, 'client_purchase'); assert.equal(data.can_cancel, true); assert.equal(data.credited, false);
  assert.deepEqual(data.purchase_summary, { packName: '30 minutos', totalMinutes: 30, normalMinutes: 20, freeMinutes: 10 });
  for (const field of ['cliente_id', 'purchaser_auth_user_id', 'purchase_payload', 'create_payload', 'public_token']) assert.equal(data[field], undefined);
  assert.ok(h.calls.every(call => call.capture === false));
});

test('Only client purchases accept public-token cancellation and dispatch the client actor', async () => {
  const staff = cardRouteHarness('crm_collection'); assert.equal((await staff.post('cancel')).status, 403); assert.equal(staff.calls.length, 0);
  const h = cardRouteHarness(); const data = await (await h.post('cancel')).json();
  assert.equal(data.status, 'cancelled'); assert.equal(data.remote_status, 'CANCELLED_BY_CLIENT'); assert.equal(data.can_pay, false); assert.equal(data.credited, false);
  assert.deepEqual(h.calls, [{ action: 'cancel', actor: 'client' }]);
});

test('A completed client order without a saved purchase is not reported as credited', async () => {
  const h = cardRouteHarness(); h.row.status = 'completed'; h.row.remote_status = 'COMPLETED';
  let data = await (await h.post('status')).json(); assert.equal(data.credited, false); assert.equal(data.can_pay, false); assert.equal(data.can_cancel, false);
  h.row.payment_id = id(20); data = await (await h.post('status')).json(); assert.equal(data.credited, true);
});

test('Pending or received capture never exposes a client cancellation action', async () => {
  for (const remote_status of ['CAPTURE_REQUESTED', 'CAPTURE_PENDING', 'CAPTURE_COMPLETED']) {
    const h = cardRouteHarness(); h.row.remote_status = remote_status;
    const data = await (await h.post('status')).json(); assert.equal(data.can_cancel, false); assert.equal(data.can_pay, false); assert.equal(data.credited, false);
  }
});

test('Expired client card order retains a cancellable non-payable summary so the pending lock can be resolved', async () => {
  const h = cardRouteHarness(); h.row.created_at = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  for (const action of ['session', 'order']) {
    const response = await h.post(action), data = await response.json();
    assert.equal(response.status, 200); assert.equal(data.can_pay, false); assert.equal(data.can_cancel, true);
    assert.equal(data.checkout_kind, 'client_purchase'); assert.match(data.last_error, /caducado/i);
    assert.equal(data.client_token, undefined); assert.equal(data.order_id, undefined);
  }
  const cancelled = await (await h.post('cancel')).json(); assert.equal(cancelled.status, 'cancelled');
  assert.equal(h.calls.filter(call => call.action === 'cancel').length, 1);
});

test('Origin allowlist accepts only the exact configured alias or verified client HTTPS domain', () => {
  const alias = 'https://nextjs-boilerplate-one-azure-28.vercel.app';
  assert.equal(clientPayPalOriginAllowed(alias, alias), true);
  assert.equal(clientPayPalOriginAllowed('https://clientestarotcelestial.es', alias), true);
  for (const origin of [null, 'null', '', 'https://evil.invalid', 'http://clientestarotcelestial.es', 'https://clientestarotcelestial.es.evil.invalid', 'https://clientestarotcelestial.es:444', 'https://www.clientestarotcelestial.es', alias + '.evil.invalid'])
    assert.equal(clientPayPalOriginAllowed(origin, alias), false, String(origin));
});

test('Client creation on the custom domain keeps approval and return URLs on that domain despite the configured Vercel alias', async () => {
  const h = routeHarness(); h.config.origin = 'https://nextjs-boilerplate-one-azure-28.vercel.app';
  const domain = 'https://clientestarotcelestial.es';
  const response = await h.post({}, { origin: domain }); assert.equal(response.status, 200);
  const body = await response.json(), saved = h.rows.get(id(10));
  assert.equal(new URL(body.url).origin, domain); assert.equal(new URL(saved.approval_url).origin, domain);
  const context = saved.create_payload.payment_source.card.experience_context;
  assert.equal(new URL(context.return_url).origin, domain); assert.equal(new URL(context.cancel_url).origin, domain);
  // Existing stored approval aliases must not redirect a browser to another origin.
  saved.approval_url = h.config.origin + new URL(body.url).pathname + new URL(body.url).search;
  const retry = await h.post({}, { origin: domain }); assert.equal(retry.status, 200);
  assert.equal(new URL((await retry.json()).url).origin, domain); assert.equal(h.remoteOrders.size, 1);
  const conflict = await h.post({ attemptId: id(11), packId: 'pack_30' }, { origin: domain });
  assert.equal(conflict.status, 200); assert.equal(new URL((await conflict.json()).url).origin, domain);
});

test('Missing, null and foreign origins cannot create client PayPal orders', async () => {
  const h = routeHarness();
  for (const origin of [null, 'null', 'https://foreign.invalid', 'https://clientestarotcelestial.es.foreign.invalid'])
    assert.equal((await h.post({}, { origin })).status, 403);
  assert.equal(h.rows.size, 0); assert.equal(h.providerRequests.length, 0);
});

test('Custom-domain card access is limited to client purchases and never broadens staff checkout access', async () => {
  const alias = 'https://nextjs-boilerplate-one-azure-28.vercel.app', domain = 'https://clientestarotcelestial.es';
  const client = cardRouteHarness(); client.config.origin = alias;
  assert.equal((await client.post('session', domain)).status, 200);
  assert.equal((await client.post('session', alias)).status, 200);
  for (const origin of [null, 'null', 'https://foreign.invalid']) assert.equal((await client.post('session', origin)).status, 403);
  const staff = cardRouteHarness('crm_collection'); staff.config.origin = alias;
  assert.equal((await staff.post('session', domain)).status, 403); assert.equal(staff.calls.length, 0);
  assert.equal((await staff.post('session', alias)).status, 200);
});


test('Promotional card purchases retain minutes and Oracle but never award Coins or roulette', async () => {
  for (const [minutes, price, coins, level, oracle] of [[30,20,50,1,0],[60,30,150,2,0],[120,59,300,3,2]]) {
    const h=routeHarness();
    h.state.promotion={id:id(50),name:'Halloween',packages:[{id:id(51),name:'Promo '+minutes,paid_minutes:minutes,free_minutes:0,price,currency:'EUR',coins,roulette_level:level,roulette_spins:1,oracle_credits:oracle,is_active:true}]};
    const response=await h.post({packId:'promo:'+id(51),amount:0.01,normal:999,coins:9999});
    assert.equal(response.status,200);assert.equal(new URL((await response.json()).url).pathname,'/pago-tarjeta');
    const saved=h.rows.get(id(10));assert.equal(saved.amount,price);assert.equal(saved.purchase_payload.normal,minutes);assert.equal(saved.purchase_payload.free,0);
    assert.equal(saved.purchase_payload.points,0);assert.equal(saved.purchase_payload.oracle_credits,oracle);assert.equal(saved.purchase_payload.roulette_level,null);
    assert.equal(saved.purchase_payload.roulette_spins,0);assert.equal(saved.purchase_payload.pricing_mode,'promotion');assert.equal(saved.purchase_payload.rewards_eligible,false);
    assert.equal(saved.purchase_payload.promotion_snapshot.coins,0);assert.equal(saved.purchase_payload.promotion_snapshot.roulette_spins,0);
    assert.equal(saved.create_payload.purchase_units[0].amount.value,price.toFixed(2));
    h.state.promotion=null;
    assert.equal((await h.post({packId:'promo:'+id(51)})).status,200);assert.equal(h.remoteOrders.size,1);
    assert.equal((await h.post({packId:'pack_30',attemptId:id(12)})).status,200);
    assert.equal(h.rows.get(id(12)).purchase_payload.pricing_mode,'regular');
    assert.equal(h.rows.get(id(12)).purchase_payload.roulette_spins,1);
  }
});
test('Inactive, missing and unsupported promotions cannot create payable orders',async()=>{
  for(const change of [null,{is_active:false},{currency:'USD'},{paid_minutes:-1}]) {
    const h=routeHarness();h.state.promotion=change===null?null:{id:id(50),packages:[{id:id(51),name:'Promo',paid_minutes:30,free_minutes:0,price:20,currency:'EUR',coins:50,roulette_level:1,roulette_spins:1,oracle_credits:0,...change}]};
    // Negative persisted minutes normalize to zero; the resulting empty pack is rejected.
    assert.equal((await h.post({packId:'promo:'+id(51)})).status,409);assert.equal(h.remoteOrders.size,0);assert.equal(h.rows.size,0);
  }
});

test('Old promotional reward configuration, including special roulette, cannot opt a new web purchase into rewards',async()=>{
 const h=routeHarness();h.state.promotion={id:id(50),name:'Promo',packages:[{id:id(51),name:'Promo especial antigua',paid_minutes:50,free_minutes:30,price:39,currency:'EUR',coins:500,roulette_level:4,roulette_spins:7,oracle_credits:2,is_active:true}]};
 const response=await h.post({packId:'promo:'+id(51),pricing_mode:'regular',rewards_eligible:true});assert.equal(response.status,200);
 const snap=h.rows.get(id(10)).purchase_payload;assert.equal(snap.normal,50);assert.equal(snap.free,30);assert.equal(snap.oracle_credits,2);
 assert.equal(snap.points,0);assert.equal(snap.roulette_spins,0);assert.equal(snap.rewards_eligible,false);
});

test('Separate intentional attempts for the same pack can coexist, while retrying each creates no duplicate', async()=>{
 const h=routeHarness();const responses=await Promise.all([h.post(),h.post({attemptId:id(11)})]);
 assert.ok(responses.every(r=>r.status===200));assert.equal(h.rows.size,2);assert.equal(h.remoteOrders.size,2);
 await Promise.all([h.post(),h.post({attemptId:id(11)})]);assert.equal(h.remoteOrders.size,2);
});
