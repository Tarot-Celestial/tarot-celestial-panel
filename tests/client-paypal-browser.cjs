// Local-only functional QA. Every API and the PayPal SDK are intercepted.
// No real provider, card details, customer records or financial transactions.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict');
process.env.TC_PRICES_QA_OUTPUT ||= path.resolve(__dirname, '../../outputs/client-paypal-qa');
const fixtureFile = path.join(__dirname, 'prices-offers-browser.cjs');
const fixtureModule = new Module(fixtureFile); fixtureModule.filename = fixtureFile;
fixtureModule.paths = Module._nodeModulePaths(path.dirname(fixtureFile));
fixtureModule._compile(fs.readFileSync(fixtureFile, 'utf8').split('(async () => {')[0] + '\nmodule.exports={fixture,rendered,shot,noOverflow,playwright,baseURL,origin,output,card,packs,ids,prizes,errors,transactions};', fixtureFile);
const { fixture, rendered, shot, noOverflow, playwright, baseURL, origin, output, card, packs, ids, prizes, errors, transactions } = fixtureModule.exports;
const checks = [], failures = [], evidence = [];
const ref = '00000000-0000-4000-8000-000000000099', attemptId = '00000000-0000-4000-8000-000000000010';
const storageKey = `tc-client-purchase-attempt:v1:${ids.A}:pack_30`;
const unrelatedKey = `tc-client-purchase-attempt:v1:${ids.A}:pack_120`;
const cardPath = '/pago-tarjeta?ref=' + ref;
const baseSession = { amount: 26, currency: 'EUR', description: '30 minutos', status: 'pending', remote_status: 'CREATED', can_pay: true,
  client_id: 'fixture-client', client_token: 'fixture-client-token', environment: 'sandbox', checkout_kind: 'client_purchase',
  attempt_id: attemptId, can_cancel: true, credited: false, purchase_summary: { packName: '30 minutos', totalMinutes: 30, normalMinutes: 20, freeMinutes: 10 } };
const fakeSDK = `window[document.currentScript.dataset.namespace]={CardFields(options){
 const field=()=>({render:async selector=>{document.querySelector(selector).textContent='Campo simulado de prueba';},close(){}});
 return {isEligible:()=>true,NameField:field,NumberField:field,ExpiryField:field,CVVField:field,
 getState:async()=>({isFormValid:true}),submit:async()=>{await options.createOrder();await options.onApprove();}};
}};`;
async function checkoutFixture(browser, options = {}) {
  const f = await fixture(browser, { name: options.name, prizes, viewport: options.viewport, mobile: options.mobile });
  const calls = [], gates = [];
  const state = { checkoutStatus: 200, checkoutBody: { ok: true, url: origin + cardPath, attempt_id: attemptId, amount: 26, currency: 'EUR', status: 'pending' },
    holdCheckout: false, holdCancel: false, failCancel: false, session: { ...baseSession }, result: { ...baseSession, status: 'completed', remote_status: 'COMPLETED', can_pay: false, can_cancel: false, credited: true } };
  await f.context.addInitScript(() => {
    window.__checkoutQA = { balanceEvents: 0 };
    window.addEventListener('tc-client-balances-changed', () => ++window.__checkoutQA.balanceEvents);
  });
  await f.context.route('**/api/cliente/pagos/paypal', async route => {
    assert.equal(route.request().method(), 'POST'); calls.push({ path: 'checkout', body: route.request().postDataJSON() });
    if (state.holdCheckout) await new Promise(resolve => gates.push(resolve));
    await route.fulfill({ status: state.checkoutStatus, contentType: 'application/json', body: JSON.stringify(state.checkoutBody) }).catch(() => {});
  });
  await f.context.route('**/api/paypal-crm/card', async route => {
    const body = route.request().postDataJSON(); calls.push({ path: 'card', body });
    assert.equal(body.ref, ref);
    if (body.action === 'cancel' && state.holdCancel) await new Promise(resolve => gates.push(resolve));
    let json = state.session, status = 200;
    if (body.action === 'order') json = { order_id: 'FIXTUREORDER' };
    if (body.action === 'capture') json = state.result;
    if (body.action === 'cancel') {
      if (state.failCancel) { status = 409; json = { error: 'Pago en proceso; no se ha confirmado la cancelación.' }; }
      else json = { ...state.session, status: 'cancelled', remote_status: 'CANCELLED_BY_CLIENT', can_pay: false, can_cancel: false, credited: false };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) }).catch(() => {});
  });
  await f.context.route('https://www.paypal.com/sdk/js**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeSDK }));
  return { ...f, state, calls, release() { state.holdCheckout = false; state.holdCancel = false; gates.splice(0).forEach(resolve => resolve()); },
    async seedAndOpenCard() {
      await f.start(); await rendered(f.page);
      await f.page.evaluate(({ storageKey, unrelatedKey, attemptId, cardPath }) => {
        localStorage.setItem(storageKey, JSON.stringify({ attemptId, url: cardPath }));
        localStorage.setItem(unrelatedKey, JSON.stringify({ attemptId: '00000000-0000-4000-8000-000000000011' }));
      }, { storageKey, unrelatedKey, attemptId, cardPath });
      await f.page.goto(baseURL + cardPath, { waitUntil: 'domcontentloaded' });
    },
    async close() { gates.splice(0).forEach(resolve => resolve()); await f.close(); },
  };
}
async function check(name, run) {
  try { await run(); checks.push(name); console.log('PASS: ' + name); }
  catch (error) { failures.push({ name, error: error.message, stack: error.stack }); console.log('FAIL: ' + name + ': ' + error.message); }
}

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    await check('All nine minute packs display EUR and checkout sends only the chosen pack and a persisted idempotency key', async () => {
      const f = await checkoutFixture(browser, { name: 'eur-and-payload' });
      try {
        await f.start(); await rendered(f.page);
        for (const pack of packs) {
          const article = f.page.locator(card).filter({ has: f.page.getByRole('heading', { name: pack.nombre, exact: true }) });
          const text = await article.innerText(); assert.match(text, new RegExp(pack.priceUsd.toFixed(2).replace('.', ',') + '\\s*€')); assert.ok(!text.includes('$'));
        }
        f.state.holdCheckout = true;
        const buy = f.page.locator(card).filter({ has: f.page.getByRole('heading', { name: '30 minutos', exact: true }) }).getByRole('button', { name: 'Elegir paquete', exact: true });
        await buy.evaluate(button => { button.click(); button.click(); });
        await f.page.getByRole('button', { name: 'Preparando pago…', exact: true }).waitFor();
        assert.equal(f.calls.filter(call => call.path === 'checkout').length, 1);
        assert.equal(await f.page.locator(card).getByRole('button', { name: 'Elegir paquete', exact: true }).filter({ visible: true }).count(), 8);
        for (const button of await f.page.locator(card).getByRole('button').all()) assert.equal(await button.isDisabled(), true);
        const sent = f.calls.find(call => call.path === 'checkout').body;
        assert.deepEqual(Object.keys(sent).sort(), ['attemptId', 'packId']); assert.equal(sent.packId, 'pack_30');
        assert.match(sent.attemptId, /^[0-9a-f-]{36}$/i);
        const stored = await f.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey); assert.equal(stored.attemptId, sent.attemptId);
        await shot(f.page, 'checkout-preparing'); f.release(); await f.page.waitForURL('**/pago-tarjeta?ref=' + ref);
        await f.page.getByRole('button', { name: /Pagar 26,00/ }).waitFor();
        await f.page.getByText('20 minutos normales + 10 minutos gratis', { exact: true }).waitFor();
        await shot(f.page, 'checkout-card-form');
      } finally { await f.close(); }
    });
    await check('Failure and reload retry the same purchase key; conflicting pending purchase offers a safe review link', async () => {
      const f = await checkoutFixture(browser, { name: 'retry-conflict' });
      try {
        f.state.checkoutStatus = 503; f.state.checkoutBody = { ok: false, error: 'Prueba: pago temporalmente no disponible.' };
        await f.start(); await rendered(f.page);
        let article = f.page.locator(card).filter({ has: f.page.getByRole('heading', { name: '30 minutos', exact: true }) });
        await article.getByRole('button', { name: 'Elegir paquete', exact: true }).click(); await article.getByRole('alert').waitFor();
        const first = f.calls[0].body.attemptId;
        await f.page.reload(); await rendered(f.page); article = f.page.locator(card).filter({ has: f.page.getByRole('heading', { name: '30 minutos', exact: true }) });
        f.state.checkoutStatus = 409; f.state.checkoutBody = { ok: false, error: 'Tienes otra compra pendiente.', attempt_id: attemptId, url: origin + cardPath };
        await article.getByRole('button', { name: 'Elegir paquete', exact: true }).click();
        const link = article.getByRole('link', { name: 'Revisar pago pendiente', exact: true }); await link.waitFor();
        assert.equal(f.calls[1].body.attemptId, first); assert.equal(await link.getAttribute('href'), cardPath);
        assert.equal(new URL(f.page.url()).pathname, '/cliente/precios-ofertas'); await shot(f.page, 'checkout-retry-conflict');
      } finally { await f.close(); }
    });
    await check('Minutes and Oracle refuse unexpected redirect origins without opening maintenance', async () => {
      const f = await checkoutFixture(browser, { name: 'redirect-and-oracle' });
      try {
        f.state.checkoutBody.url = 'https://foreign.invalid/pay';
        await f.start(); await rendered(f.page); const article = f.page.locator(card).first();
        await article.getByRole('button', { name: 'Elegir paquete', exact: true }).click(); await article.getByRole('alert').waitFor();
        assert.equal(new URL(f.page.url()).pathname, '/cliente/precios-ofertas');
        await f.page.locator('#oraculo-packs').getByRole('button', { name: 'COMPRAR', exact: true }).first().click();
        await f.page.locator('#oraculo-packs').getByRole('alert').waitFor();
        assert.equal(await f.page.getByRole('dialog', { name: 'Compras desde la app en mantenimiento' }).count(), 0);
        assert.equal(f.calls.filter(call => call.path === 'checkout').length, 2);
        assert.equal(f.calls.filter(call => call.path === 'checkout')[1].body.packId, 'oracle_2');
        assert.equal(new URL(f.page.url()).pathname, '/cliente/precios-ofertas');
      } finally { await f.close(); }
    });
    await check('Simulated hosted card approval confirms the receipt, clears only its purchase key and refreshes balances once', async () => {
      const f = await checkoutFixture(browser, { name: 'confirmed-receipt' });
      try {
        await f.seedAndOpenCard(); await f.page.getByRole('button', { name: /Pagar 26,00/ }).click();
        await f.page.getByRole('heading', { name: 'Pago confirmado', exact: true }).waitFor();
        await f.page.getByRole('link', { name: 'Ver mis minutos y beneficios', exact: true }).waitFor();
        const storage = await f.page.evaluate(({ storageKey, unrelatedKey }) => ({ completed: localStorage.getItem(storageKey), unrelated: localStorage.getItem(unrelatedKey), events: window.__checkoutQA.balanceEvents }), { storageKey, unrelatedKey });
        assert.equal(storage.completed, null); assert.ok(storage.unrelated); assert.equal(storage.events, 1);
        assert.equal(f.calls.filter(call => call.body.action === 'capture').length, 1); await shot(f.page, 'checkout-receipt-confirmed');
      } finally { await f.close(); }
    });
    await check('Received but not credited money remains pending with the same key until confirmation succeeds', async () => {
      const f = await checkoutFixture(browser, { name: 'received-not-credited' });
      try {
        f.state.session = { ...baseSession, status: 'completed', remote_status: 'COMPLETED', can_pay: false, can_cancel: false, credited: false };
        await f.seedAndOpenCard(); await f.page.getByRole('button', { name: 'Comprobar estado del pago', exact: true }).waitFor();
        assert.equal(await f.page.getByRole('heading', { name: 'Pago confirmado', exact: true }).count(), 0);
        assert.ok(await f.page.evaluate(key => localStorage.getItem(key), storageKey));
        assert.equal(await f.page.evaluate(() => window.__checkoutQA.balanceEvents), 0);
        await shot(f.page, 'checkout-receipt-pending');
        await f.page.getByRole('button', { name: 'Comprobar estado del pago', exact: true }).click();
        await f.page.getByRole('heading', { name: 'Pago confirmado', exact: true }).waitFor();
        assert.equal(await f.page.evaluate(key => localStorage.getItem(key), storageKey), null);
      } finally { await f.close(); }
    });
    await check('Cancellation waits for confirmation and failed cancellation retains the purchase key', async () => {
      for (const failCancel of [false, true]) {
        const f = await checkoutFixture(browser, { name: 'cancel-' + failCancel });
        try {
          f.state.session = { ...baseSession, remote_status: 'APPROVED', can_pay: false }; f.state.holdCancel = true; f.state.failCancel = failCancel;
          await f.seedAndOpenCard(); await f.page.getByRole('button', { name: 'Cancelar esta compra', exact: true }).click();
          await f.page.getByRole('button', { name: 'Comprobando cancelación…', exact: true }).waitFor();
          assert.equal(await f.page.getByRole('heading', { name: 'Compra cancelada', exact: true }).count(), 0);
          assert.ok(await f.page.evaluate(key => localStorage.getItem(key), storageKey)); f.release();
          if (!failCancel) {
            await f.page.getByRole('heading', { name: 'Compra cancelada', exact: true }).waitFor();
            assert.equal(await f.page.evaluate(key => localStorage.getItem(key), storageKey), null);
          } else {
            await f.page.getByText('Pago en proceso; no se ha confirmado la cancelación.', { exact: true }).waitFor();
            assert.ok(await f.page.evaluate(key => localStorage.getItem(key), storageKey));
            assert.equal(await f.page.getByRole('heading', { name: 'Compra cancelada', exact: true }).count(), 0);
          }
          assert.equal(f.calls.filter(call => call.body.action === 'capture').length, 0);
        } finally { await f.close(); }
      }
    });
    await check('320px checkout keeps EUR, exact purchased split and all card actions readable without overflow', async () => {
      const f = await checkoutFixture(browser, { name: 'mobile-checkout', viewport: { width: 320, height: 740 }, mobile: true });
      try {
        await f.seedAndOpenCard(); await f.page.getByRole('button', { name: /Pagar 26,00/ }).waitFor();
        await noOverflow(f.page, '320px client checkout'); await shot(f.page, 'checkout-mobile-320');
        assert.equal(await f.page.getByRole('button', { name: 'Cancelar esta compra', exact: true }).isVisible(), true);
      } finally { await f.close(); }
    });
    await check('No browser errors or unexpected real payment operations occurred', async () => { assert.deepEqual(errors, []); assert.deepEqual(transactions, []); });
  } finally {
    await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), baseURL, checks, failures, errors, blockedUnexpectedTransactions: transactions, evidence, allProviderCallsMocked: true }, null, 2));
  }
  console.log(JSON.stringify({ passed: checks.length, failed: failures.length, output })); if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
