// Local navigation QA. Fake account; all APIs and external traffic are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const baseURL = process.env.TC_NAV_QA_URL || 'http://127.0.0.1:3020';
const origin = new URL(baseURL).origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
const output = process.env.TC_NAV_QA_OUTPUT || path.resolve(__dirname, '../../outputs/prices-nav-qa');
fs.mkdirSync(output, { recursive: true });
const checks = [], failures = [], errors = [], transactions = [];
const navSelector = 'nav[aria-label="Secciones del panel de cliente"]';
const groups = [['Tarotistas', 'consultar', ['tarotistas', 'resenas']], ['Mi camino', 'camino', ['rangos', 'ritual']], ['Experiencias', 'experiencias', ['oraculo', 'ruleta', 'sorteo']], ['Mi cuenta', 'cuenta', ['perfil', 'notificaciones']]];
async function fixture(browser, mobile = false) {
  const state = { ritualAccess: true, promotion: null, unread: 0 };
  const context = await browser.newContext({ viewport: mobile ? { width: 320, height: 740 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  const id = '00000000-0000-4000-8000-000000000001';
  await context.addInitScript(id => {
    const now = Math.floor(Date.now() / 1000), encode = value => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: id, session_id: 'nav-fixture', aud: 'authenticated', role: 'authenticated', exp: now + 86400 })}.fake-test-signature`;
    localStorage.setItem('sb-example-auth-token-cliente', JSON.stringify({ access_token: token, refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user: { id, aud: 'authenticated', role: 'authenticated', email: 'qa@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, id);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return url.hostname === 'example.supabase.co' ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET' && !['/api/cliente/activity/ping', '/api/cliente/leo'].includes(url.pathname)) {
      transactions.push(url.pathname); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"QA forbids transactions"}' });
    }
    const wallet = { effective_rank: 'diamante', minutes_free: 193, minutes_normal: 40, coins: 1200, oracle_credits: 4, spins: { total: 0 } };
    let data = { ok: true, data: [] };
    if (url.pathname === '/api/cliente/me') data = { ok: true, cliente: { id, nombre: 'Ana', rango_actual: 'diamante', onboarding_completado: true }, wallet, recompensas: [], packs: [], cliente_notificaciones: [], rank_info: { label: 'Diamante', benefits: [] }, rank_progress: { current_label: 'Diamante', progress_percent: 100 }, rank_benefits: { ritual_access: state.ritualAccess } };
    else if (url.pathname === '/api/cliente/state') data = { ok: true, state: wallet };
    else if (url.pathname === '/api/cliente/ritual') data = { ok: true, ritual_access: state.ritualAccess, rank: 'diamante', ritual: null, history: [] };
    else if (url.pathname === '/api/cliente/leo') data = { ok: true, profile: { hidden: true, muted: true }, facts: { coins: 1200, minutes: 233 } };
    else if (url.pathname === '/api/cliente/ruleta') data = { ok: true, cliente_id: id, diamond_access: true, catalogue: [], history: [], entitlements: [] };
    else if (url.pathname === '/api/cliente/rangos') data = { ok: true, cliente_id: id, currency: 'USD', window_days: 30, state: { effective: 'diamante', automatic: 'diamante', total: 200, purchases: 3, has_override: false }, ranks: [], warnings: [] };
    else if (url.pathname === '/api/cliente/rank-benefits') data = { ok: true, bonuses: [] };
    else if (url.pathname === '/api/cliente/auth/password/status') data = { ok: true, hasPassword: true };
    else if (url.pathname === '/api/cliente/promotions/active') data = { ok: true, promotion: state.promotion };
    else if (url.pathname === '/api/cliente/notificaciones') data = { ok: true, unread_count: state.unread, data: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  if (context.routeWebSocket) await context.routeWebSocket(/supabase\./, socket => socket.close());
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/cliente/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const nav = page.locator(navSelector); await nav.waitFor({ timeout: 90000 });
  await page.locator('#saldo-minutes strong').filter({ hasText: '233' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { page, context, nav, state };
}
async function check(name, run) { try { await run(); checks.push(name); console.log('PASS: ' + name); } catch (error) { failures.push({ name, error: error.message, stack: error.stack }); console.log('FAIL: ' + name + ': ' + error.message); } }
async function screenshot(page, name) { await page.screenshot({ path: path.join(output, name + '.png') }); }
async function layout(nav) {
  return nav.evaluate(element => {
    const rect = element.getBoundingClientRect(), first = element.querySelector('a'), price = first.getBoundingClientRect();
    return { viewport: innerWidth, html: document.documentElement.scrollWidth, left: rect.left, right: rect.right, priceLeft: price.left, priceRight: price.right, targets: [...element.querySelectorAll('button,a')].filter(el => el.offsetParent).map(el => ({ height: el.getBoundingClientRect().height, name: el.getAttribute('aria-label') || el.textContent })), text: [...element.querySelectorAll('strong,small')].filter(el => el.offsetParent).map(el => parseFloat(getComputedStyle(el).fontSize)) };
  });
}
(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const f = await fixture(browser);
    try {
      await check('Precios y ofertas is the first direct link; all existing destinations remain accessible exactly once', async () => {
        const links = [await f.nav.locator('a').first().getAttribute('href'), await f.nav.getByRole('link', { name: 'Inicio', exact: true }).getAttribute('href')];
        assert.equal(links[0], '/cliente/precios-ofertas'); assert.equal(await f.nav.getByRole('link', { name: 'Precios y ofertas', exact: true }).count(), 1);
        for (const [label, group, expected] of groups) {
          await f.nav.getByRole('button', { name: label, exact: true }).click();
          const actual = await f.page.locator('#client-nav-' + group + ' a').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
          assert.deepEqual(actual, expected.map(value => '/cliente/' + value)); links.push(...actual);
          if (group === 'cuenta') assert.ok(await f.nav.getByRole('button', { name: 'Cerrar sesión', exact: true }).isVisible());
          await f.page.keyboard.press('Escape');
        }
        assert.equal(links.length, 11); assert.equal(new Set(links).size, 11);
        const values = await layout(f.nav); assert.ok(values.targets.every(item => item.height >= 44)); assert.ok(values.text.every(value => value >= 14));
        await screenshot(f.page, 'desktop-navigation');
      });
      await check('Keyboard opens disclosures, focuses a destination and Escape restores the trigger', async () => {
        const trigger = f.nav.getByRole('button', { name: 'Tarotistas', exact: true }); await trigger.focus(); await f.page.keyboard.press('Enter');
        assert.equal(await f.page.locator('#client-nav-consultar a').first().evaluate(el => el === document.activeElement), true);
        await f.page.keyboard.press('Tab'); assert.equal(await f.page.locator('#client-nav-consultar a').last().evaluate(el => el === document.activeElement), true);
        await f.page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(el => el === document.activeElement), true); assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        await f.page.keyboard.press('ArrowDown'); assert.equal(await f.page.locator('#client-nav-consultar a').first().evaluate(el => el === document.activeElement), true);
        await f.page.keyboard.press('Escape'); await trigger.click(); await f.page.locator('#celestial-welcome').click(); assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      });
      await check('Promotion and unread indicators reflect server values without invented offers; ritual access is respected', async () => {
        assert.equal(await f.nav.getByText('Oferta activa disponible').count(), 0);
        f.state.promotion = { id: 'qa-promotion' }; f.state.unread = 12; f.state.ritualAccess = false;
        await f.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await f.nav.getByText('Oferta activa disponible').waitFor(); await f.nav.locator('#client-nav-unread').getByText('12', { exact: true }).waitFor();
        await f.nav.getByRole('button', { name: 'Mi camino', exact: true }).click();
        assert.equal(await f.page.locator('#client-nav-camino a[href="/cliente/ritual"]').count(), 0); assert.equal(await f.page.locator('#client-nav-camino a[href="/cliente/rangos"]').count(), 1);
        await f.page.keyboard.press('Escape'); await screenshot(f.page, 'desktop-navigation-offer');
        f.state.promotion = null; await f.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await f.nav.getByText('Minutos y paquetes').waitFor();
      });
      await check('Desktop 200% text size preserves access to every control without page overflow', async () => {
        await f.page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        const values = await layout(f.nav); assert.ok(values.html <= values.viewport + 1, JSON.stringify(values)); assert.ok(values.left >= 0 && values.right <= values.viewport);
        for (const [label] of groups) { const button = f.nav.getByRole('button', { name: label, exact: true }); await button.focus(); await f.page.keyboard.press('Enter'); await f.nav.locator('[id^="client-nav-"][data-group] a').first().waitFor(); await f.page.keyboard.press('Escape'); }
        await screenshot(f.page, 'desktop-navigation-text-200');
      });
    } finally { await f.context.close(); }
    const mobile = await fixture(browser, true);
    try {
      await check('At 320 px, prices stay visible while the remaining menu scrolls; every destination is touch-accessible', async () => {
        const values = await layout(mobile.nav); assert.ok(values.html <= 321, JSON.stringify(values)); assert.ok(values.priceLeft >= 0 && values.priceRight <= 320); assert.ok(values.targets.every(item => item.height >= 44));
        await screenshot(mobile.page, 'mobile-navigation');
        for (const [label, group] of groups) { await mobile.nav.getByRole('button', { name: label, exact: true }).tap(); const dropdown = mobile.page.locator('#client-nav-' + group); await dropdown.waitFor(); const box = await dropdown.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 320); await mobile.page.keyboard.press('Escape'); }
        await mobile.nav.getByRole('button', { name: 'Experiencias', exact: true }).tap(); await screenshot(mobile.page, 'mobile-navigation-experiences'); await mobile.page.keyboard.press('Escape');
      });
      await check('Mobile 200% text size keeps the price label and dropdown contents readable without clipping', async () => {
        await mobile.page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        const values = await layout(mobile.nav); assert.ok(values.html <= 321, JSON.stringify(values)); assert.ok(values.priceRight <= 320 && values.priceLeft >= 0);
        await mobile.nav.getByRole('button', { name: 'Mi cuenta', exact: true }).tap();
        const fit = await mobile.page.locator('#client-nav-cuenta').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth })); assert.ok(fit.scroll <= fit.width + 1, JSON.stringify(fit));
        await screenshot(mobile.page, 'mobile-navigation-text-200');
      });
    } finally { await mobile.context.close(); }
  } finally { await browser.close(); }
  const report = { ok: !failures.length && !errors.length && !transactions.length, checks, failures, errors, transactions };
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); if (!report.ok) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
