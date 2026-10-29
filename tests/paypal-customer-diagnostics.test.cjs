const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const requiredEvents = ['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DECLINED','PAYMENT.CAPTURE.DENIED'];
const webhookUrl = 'https://clientestarotcelestial.es/api/webhooks/paypal-cliente';
function load(file, globals, mocks) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, URL, Date, Buffer, AbortSignal, Error, ...globals, require: name => mocks[name] || require(name) });
  return exports;
}
function helper(options = {}) {
  const calls = [];
  const env = { PAYPAL_CUSTOMER_CLIENT_ID: 'customer-client-fixture', PAYPAL_CUSTOMER_CLIENT_SECRET: 'customer-secret-fixture',
    PAYPAL_CUSTOMER_WEBHOOK_ID: 'webhook-fixture', PAYPAL_CUSTOMER_MERCHANT_ID: 'MERCHANTFIXTURE', PAYPAL_CUSTOMER_ENVIRONMENT: 'live',
    PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT: 'legacy', PAYPAL_CLIENT_ID: 'legacy-client-fixture', PAYPAL_CLIENT_SECRET: 'legacy-secret-fixture', ...options.env };
  const api = load('src/lib/server/paypal-crm.ts', { process: { env }, fetch: async (url, request) => {
    calls.push({ url, request });
    if (url.endsWith('/v1/oauth2/token')) return { ok: options.authOk !== false, status: options.authOk === false ? 401 : 200,
      json: async () => options.authOk === false ? { error: 'invalid_client', error_description: 'PRIVATE-PROVIDER-DETAIL customer-secret-fixture' } : { access_token: 'PRIVATE-ACCESS-TOKEN' } };
    assert.equal(request.method, 'GET');
    assert.equal(url, 'https://api-m.paypal.com/v1/notifications/webhooks/webhook-fixture');
    if (options.networkFailure) throw new Error('PRIVATE-NETWORK-DETAIL');
    return { ok: !options.webhookStatus, status: options.webhookStatus || 200, json: async () => options.webhook || {
      id: 'webhook-fixture', url: webhookUrl, event_types: requiredEvents.map(name => ({ name })), secret_response: 'PRIVATE-PROVIDER-DETAIL',
    } };
  } }, { '@supabase/supabase-js': { createClient() { throw new Error('Diagnostic must never use database payments'); } } });
  return { api, calls, env };
}
function safeOutput(value) {
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE-|customer-secret-fixture|customer-client-fixture|legacy-secret-fixture/);
}

test('customer preflight uses only customer OAuth and a webhook GET while legacy remains selected', async () => {
  const h = helper(), result = await h.api.diagnoseCustomerPayPalConfiguration();
  assert.equal(result.account, 'client_business_v1'); assert.equal(result.environment, 'live');
  assert.equal(result.active_for_new_purchases, false); assert.equal(result.checks_passed, true);
  assert.equal(result.merchant_verified, false); assert.equal(result.payment_flow_verified, false);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, 'https://api-m.paypal.com/v1/oauth2/token');
  assert.equal(h.calls[0].request.headers.Authorization, 'Basic '+Buffer.from('customer-client-fixture:customer-secret-fixture').toString('base64'));
  assert.equal(h.calls[1].request.headers.Authorization, 'Bearer PRIVATE-ACCESS-TOKEN');
  assert.equal(h.calls[1].request.method, 'GET'); assert.equal(h.calls[1].request.body, undefined);
  safeOutput(result);
});
test('missing webhook still checks OAuth and never performs any other provider request', async () => {
  const h = helper({ env: { PAYPAL_CUSTOMER_WEBHOOK_ID: '' } });
  const result = await h.api.diagnoseCustomerPayPalConfiguration();
  assert.equal(result.oauth_verified, true); assert.equal(result.checks_passed, false);
  assert.equal(result.webhook.configured, false); assert.equal(h.calls.length, 1); safeOutput(result);
});
test('incomplete credentials or environment cannot fall back to the legacy account', async () => {
  for (const env of [{ PAYPAL_CUSTOMER_CLIENT_SECRET: '' }, { PAYPAL_CUSTOMER_ENVIRONMENT: '' }, { PAYPAL_CUSTOMER_CLIENT_ID: '' }]) {
    const h = helper({ env });
    await assert.rejects(h.api.diagnoseCustomerPayPalConfiguration()); assert.equal(h.calls.length, 0);
  }
});
test('wrong webhook identity, URL, missing or disabled events fail the preflight', async () => {
  const good = { id: 'webhook-fixture', url: webhookUrl, event_types: requiredEvents.map(name => ({ name })) };
  for (const webhook of [{ ...good, id: 'another-app-webhook' }, { ...good, url: 'https://wrong.test/api/webhooks/paypal-cliente' },
    { ...good, event_types: good.event_types.slice(1) }, { ...good, event_types: [{ name: '*' }] },
    { ...good, event_types: good.event_types.map((event, index) => ({ ...event, status: index === 0 ? 'DISABLED' : 'ENABLED' })) }]) {
    const h = helper({ webhook }); const result = await h.api.diagnoseCustomerPayPalConfiguration();
    assert.equal(result.checks_passed, false); safeOutput(result);
  }
});
test('missing Merchant ID is reported without pretending to verify merchant ownership', async () => {
  const h = helper({ env: { PAYPAL_CUSTOMER_MERCHANT_ID: '' } });
  const result = await h.api.diagnoseCustomerPayPalConfiguration();
  assert.equal(result.webhook.url_matches, true); assert.equal(result.merchant_configured, false);
  assert.equal(result.merchant_verified, false); assert.equal(result.checks_passed, false);
});
test('OAuth rejection and webhook failures never expose secrets or raw provider details', async () => {
  const rejected = helper({ authOk: false });
  await assert.rejects(rejected.api.diagnoseCustomerPayPalConfiguration(), error => { safeOutput(error.message); return error.message.includes('invalid_client'); });
  assert.equal(rejected.calls.length, 1);
  for (const options of [{ webhookStatus: 404 }, { webhookStatus: 503 }, { networkFailure: true }]) {
    const h = helper(options), result = await h.api.diagnoseCustomerPayPalConfiguration();
    assert.equal(result.oauth_verified, true); assert.equal(result.checks_passed, false); safeOutput(result);
  }
});

function route(options = {}) {
  let calls = 0, authChecks = 0;
  class PayPalError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
  const api = load('src/app/api/admin/payment-settings/route.ts', {}, {
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@/lib/admin/require-admin': { requireAdmin: async () => { authChecks++; return options.gate || { ok: true, me: { role: 'admin', is_active: true } }; } },
    '@/lib/server/client-payment-settings': {},
    '@/lib/server/paypal-crm': { PayPalError, diagnoseCustomerPayPalConfiguration: async (...args) => {
      calls++; assert.equal(args.length, 0); if (options.failure) throw new Error('PRIVATE-INTERNAL-SECRET');
      return { account: 'client_business_v1', oauth_verified: true };
    } },
  });
  return { post: body => api.POST(new Request('https://panel.test/api/admin/payment-settings', { method: 'POST', body: JSON.stringify(body) })), calls: () => calls, authChecks: () => authChecks };
}
test('diagnostics require the existing verified active admin guard before any provider call', async () => {
  for (const error of ['NO_AUTH', 'FORBIDDEN', 'NO_WORKER']) {
    const h = route({ gate: { ok: false, error } });
    const response = await h.post({ action: 'diagnose_paypal_customer' });
    assert.equal(response.status, error === 'FORBIDDEN' ? 403 : 401); assert.equal(h.calls(), 0); assert.equal(h.authChecks(), 1);
  }
});
test('admin diagnostic fixes the account server-side and never accepts arbitrary payment actions', async () => {
  const h = route();
  assert.equal((await h.post({ action: 'create', account: 'legacy' })).status, 400); assert.equal(h.calls(), 0);
  const response = await h.post({ action: 'diagnose_paypal_customer', account: 'legacy', capture: true });
  assert.equal(response.status, 200); assert.equal(h.calls(), 1);
  assert.equal((await response.json()).account, 'client_business_v1'); assert.match(response.headers.get('cache-control'), /no-store/);
});
test('unexpected admin diagnostic failures return a sanitized error', async () => {
  const h = route({ failure: true }); const response = await h.post({ action: 'diagnose_paypal_customer' });
  assert.equal(response.status, 503); safeOutput(await response.json());
});
