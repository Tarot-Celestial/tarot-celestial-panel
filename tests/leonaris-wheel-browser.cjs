// Local-only roulette interaction QA. Every API and external host is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const baseURL = process.env.TC_WHEEL_QA_URL || 'http://127.0.0.1:3020';
const origin = new URL(baseURL).origin;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'This fixture must never run against production');
const output = process.env.TC_WHEEL_QA_OUTPUT || path.resolve(__dirname, '../../outputs/leonaris-wheel-qa');
const customerId = '00000000-0000-4000-8000-000000000001';
const spinId = level => `10000000-0000-4000-8000-00000000000${level}`;
const pendingId = '20000000-0000-4000-8000-000000000002';
const center = '[data-roulette-spin="center"]';
const checks = [], failures = [], errors = [], requests = [];
fs.mkdirSync(output, { recursive: true });
function summaryFor(level, options) {
  const summary = { ok: true, cliente_id: customerId, available_spins: 1, next_level: level, diamond_access: options.locked !== true, campaign: null, catalogue: [], history: [], entitlements: [] };
  for (let n = 1; n <= 5; n++) {
    summary[`level_${n}_spins`] = n === level ? options.spins ?? 1 : 0;
    summary[`next_spin_${n}`] = n === level && !options.missingId ? spinId(n) : null;
    if (!options.emptyCatalogue) for (let i = 0; i < 6; i++) summary.catalogue.push({ id: `reward-${n}-${i}`, nivel: n, reward_type: i % 2 ? 'minutes' : 'coins', reward_value: 10 + i, probability: 1 / 6, special: false, rarity: 'common', sort_order: i });
  }
  return summary;
}
async function fixture(browser, options = {}) {
  const level = options.level || 1;
  const summary = summaryFor(level, options);
  const posts = [];
  const context = await browser.newContext({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: !!options.mobile, hasTouch: !!options.mobile, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(({ customerId, pendingId, pending }) => {
    const now = Math.floor(Date.now() / 1000);
    const token = `${btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: customerId, aud: 'authenticated', role: 'authenticated', exp: now + 86400 }))}.fake-test-signature`;
    localStorage.setItem('sb-example-auth-token-cliente', JSON.stringify({ access_token: token, refresh_token: 'fake-refresh-token', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user: { id: customerId, aud: 'authenticated', role: 'authenticated', email: 'cliente@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
    if (pending) sessionStorage.setItem('tc-ruleta-pending:' + customerId, JSON.stringify({ spin_id: pendingId, level: 2 }));
  }, { customerId, pendingId, pending: !!options.pending });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) {
      if (url.hostname === 'example.supabase.co') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push(`${req.method()} ${url.pathname}`);
    let json = { ok: true, data: [] };
    if (url.pathname === '/api/cliente/ruleta') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON(); posts.push(body);
        assert.ok(req.headers().authorization?.startsWith('Bearer '));
        await new Promise(resolve => setTimeout(resolve, 550));
        summary[`level_${body.level}_spins`] = 0; summary[`next_spin_${body.level}`] = null;
        json = { ...summary, spin_id: body.spin_id, spin_level: body.level, reward_id: `reward-${body.level}-0`, reward_type: 'coins', reward_value: 10, reward_rarity: 'common', special: false, balance_before: 100, balance_after: 110 };
      } else json = summary;
    } else if (req.method() !== 'GET') {
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"Unexpected transaction forbidden by QA"}' });
    } else if (url.pathname === '/api/cliente/me') {
      json = { ok: true, cliente: { id: customerId, nombre: 'Cliente', email: 'cliente@example.invalid', rango_actual: 'diamante', onboarding_completado: true }, wallet: { effective_rank: 'diamante', minutes_free: 5, minutes_normal: 10, coins: 100, oracle_credits: 0, spins: { total: 1 } }, rank_info: { label: 'Diamante', benefits: [] }, rank_progress: { current_label: 'Diamante', progress_percent: 100 }, rank_benefits: { ritual_access: true } };
    } else if (url.pathname === '/api/cliente/leo') json = { ok: true, profile: { hidden: true, muted: true }, facts: {} };
    else if (url.pathname === '/api/cliente/rangos') json = { ok: true, state: { effective: 'diamante', total: 200 }, ranks: [], warnings: [] };
    else if (url.pathname === '/api/cliente/auth/password/status') json = { ok: true, hasPassword: true };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
  if (context.routeWebSocket) await context.routeWebSocket(/supabase\./, socket => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseURL}/cliente/ruleta?nivel=${level}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator(center).waitFor({ timeout: 90000 });
  await page.locator(center).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  return { page, context, posts, summary, close: () => context.close() };
}
async function exactCenter(page, touch = false) {
  const point = await page.locator(center).evaluate(button => {
    const box = button.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    return { x, y, target: document.elementFromPoint(x, y)?.closest('button') === button };
  });
  assert.ok(point.target, 'The wheel center must receive the real pointer hit');
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else {
    const before = await page.locator(center).boundingBox();
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    const pressed = await page.locator(center).boundingBox();
    await page.mouse.up();
    assert.ok(Math.abs(before.x - pressed.x) <= 2 && Math.abs(before.y - pressed.y) <= 2,
      'Pressing the themed button must not replace its centering transform');
  }
}
async function check(name, run) {
  try { await run(); checks.push(name); console.log('PASS: ' + name); }
  catch (error) { failures.push({ name, error: error.message, stack: error.stack }); console.log('FAIL: ' + name + ': ' + error.message); }
}
(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    await check('Authenticated load never spends a spin; exact center click starts one request and busy blocks duplicates', async () => {
      const f = await fixture(browser);
      try {
        assert.equal(f.posts.length, 0); assert.equal(await f.page.locator(center).isEnabled(), true);
        await exactCenter(f.page); await f.page.waitForFunction(selector => document.querySelector(selector)?.disabled, center);
        await exactCenter(f.page); await f.page.locator(center).press('Enter');
        await f.page.getByText('Premio acreditado automáticamente en tu saldo real.', { exact: true }).waitFor();
        assert.deepEqual(f.posts, [{ spin_id: spinId(1), level: 1 }]);
        assert.equal(await f.page.locator(center).isDisabled(), true);
      } finally { await f.close(); }
    });
    for (const key of ['Enter', 'Space']) await check(`${key} activates the native center button once at its selected level`, async () => {
      const f = await fixture(browser, { level: 3 });
      try { await f.page.locator(center).focus(); await f.page.keyboard.press(key); await f.page.getByText('Premio acreditado automáticamente en tu saldo real.', { exact: true }).waitFor(); assert.deepEqual(f.posts, [{ spin_id: spinId(3), level: 3 }]); }
      finally { await f.close(); }
    });
    await check('Mobile touch hits the Diamond center through its decorative emblem', async () => {
      const f = await fixture(browser, { level: 5, mobile: true });
      try { await exactCenter(f.page, true); await f.page.getByText('Premio acreditado automáticamente en tu saldo real.', { exact: true }).waitFor(); assert.deepEqual(f.posts, [{ spin_id: spinId(5), level: 5 }]); }
      finally { await f.close(); }
    });
    await check('Locked Diamond never advertises GIRAR or sends a spin', async () => {
      const f = await fixture(browser, { level: 5, locked: true });
      try { assert.equal(await f.page.locator(center).isDisabled(), true); assert.doesNotMatch(await f.page.locator(center).innerText(), /GIRAR/); await f.page.locator(center).evaluate(button => button.click()); assert.equal(f.posts.length, 0); await f.page.screenshot({ path: path.join(output, 'locked-wheel.png') }); }
      finally { await f.close(); }
    });
    await check('Unconfirmed spin ID and absent catalogue give honest disabled labels', async () => {
      for (const options of [{ missingId: true }, { emptyCatalogue: true }]) {
        const f = await fixture(browser, options);
        try { assert.equal(await f.page.locator(center).isDisabled(), true); assert.doesNotMatch(await f.page.locator(center).innerText(), /GIRAR/); await f.page.locator(center).evaluate(button => button.click()); assert.equal(f.posts.length, 0); }
        finally { await f.close(); }
      }
    });
    await check('Pending recovery waits for a click and reuses its exact ID despite no fresh spins or catalogue', async () => {
      const f = await fixture(browser, { pending: true, level: 1, spins: 0, missingId: true, emptyCatalogue: true });
      try {
        assert.equal(f.posts.length, 0); assert.equal(await f.page.locator(center).isEnabled(), true);
        assert.match(await f.page.locator(center).innerText(), /COMPROBAR/);
        await exactCenter(f.page); await f.page.getByText('Premio acreditado automáticamente en tu saldo real.', { exact: true }).waitFor();
        assert.deepEqual(f.posts, [{ spin_id: pendingId, level: 2 }]);
        assert.equal(await f.page.evaluate(key => sessionStorage.getItem(key), 'tc-ruleta-pending:' + customerId), null);
      } finally { await f.close(); }
    });
  } finally {
    await browser.close();
    const report = { ok: failures.length === 0 && errors.length === 0, checks, failures, errors, requests: [...new Set(requests)] };
    fs.writeFileSync(path.join(output, 'wheel-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
