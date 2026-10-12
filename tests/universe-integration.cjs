// Browser QA of the real client routes with fake auth and every API intercepted.
// No request from this test may reach a real backend or external service.
// Run: TC_UNIVERSE_QA_URL=http://127.0.0.1:3020 node tests/universe-integration.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }

const baseURL = process.env.TC_UNIVERSE_QA_URL || 'http://127.0.0.1:3020';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Integration QA only permits a local server');
const output = process.env.TC_UNIVERSE_QA_OUTPUT || path.resolve(__dirname, '../../outputs');
const rootSelector = '[data-celestial-universe]';
const checks = [], errors = [], blocked = [], calls = new Set(), metrics = {};
fs.mkdirSync(output, { recursive: true });
const customerId = '00000000-0000-4000-8000-000000000001';
const wallet = { effective_rank: 'diamante', minutes_free: 193, minutes_normal: 40, coins: 1200, oracle_credits: 4, spins: { total: 0 }, refreshed_at: new Date().toISOString() };
const client = { id: customerId, nombre: 'Cliente', apellido: 'de prueba', email: 'cliente@example.invalid', rango_actual: 'diamante', puntos: 1200, minutos_free_pendientes: 193, minutos_normales_pendientes: 40, onboarding_completado: true };
const roulette = { ok: true, cliente_id: customerId, available_spins: 0, next_level: 1, level_2_from: 27, level_3_from: 49, diamond_access: true, campaign: null, catalogue: [], history: [], entitlements: [] };
for (let i = 1; i <= 5; i++) { roulette[`level_${i}_spins`] = 0; roulette[`next_spin_${i}`] = null; }
const apiData = pathname => {
  if (pathname === '/api/cliente/me') return { ok: true, cliente: client, wallet, recompensas: [{ id: 'fake-reward', nombre: 'Recompensa de prueba', puntos_coste: 100, minutos_otorgados: 5 }], packs: [], cliente_notificaciones: [], rank_info: { label: 'Diamante', benefits: ['Consulta tus ventajas en Rangos', 'Un espacio celestial para explorar'] }, rank_progress: { current_label: 'Diamante', progress_percent: 100 }, rank_benefits: { ritual_access: true } };
  if (pathname === '/api/cliente/state') return { ok: true, state: wallet };
  if (pathname === '/api/cliente/ruleta') return roulette;
  if (pathname === '/api/cliente/oraculo') return { ok: true, credits: 4, freeAvailable: true, freeDailyAvailable: true, packs: [], freeState: { remainingSeconds: 0 } };
  if (pathname === '/api/cliente/leo') return { ok: true, profile: { hidden: false, muted: true }, facts: { coins: 1200, minutes: 233, oracleCredits: 4, activePromotion: null } };
  if (pathname === '/api/cliente/rangos') return { ok: true, cliente_id: customerId, ranks: [], state: { effective: 'diamante', total: 200, has_override: false }, window_days: 30 };
  if (pathname === '/api/cliente/rank-benefits') return { ok: true, cliente_id: customerId, bonuses: [] };
  if (pathname === '/api/cliente/auth/password/status') return { ok: true, hasPassword: true };
  if (pathname === '/api/cliente/promotions/active') return { ok: true, promotion: null };
  if (pathname === '/api/cliente/notificaciones') return { ok: true, unread_count: 0, data: [] };
  return { ok: true, data: [] };
};

async function mockedContext(browser, options, withSession = true) {
  const context = await browser.newContext({ serviceWorkers: 'block', ...options });
  if (withSession) await context.addInitScript(({ customerId }) => {
    const now = Math.floor(Date.now() / 1000);
    const token = `${btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: customerId, aud: 'authenticated', role: 'authenticated', exp: now + 86400 }))}.fake-test-signature`;
    localStorage.setItem('sb-example-auth-token-cliente', JSON.stringify({ access_token: token, refresh_token: 'fake-refresh-token', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user: { id: customerId, aud: 'authenticated', role: 'authenticated', email: 'cliente@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { customerId });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) {
      if (!url.pathname.startsWith('/api/')) return route.continue();
      calls.add(`${route.request().method()} ${url.pathname}`);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiData(url.pathname)) });
    }
    blocked.push(url.hostname);
    if (url.hostname === 'example.supabase.co') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.abort('blockedbyclient');
  });
  if (context.routeWebSocket) await context.routeWebSocket(/supabase\./, socket => socket.close());
  return context;
}

async function pageFor(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(30000);
  return page;
}
async function world(page, renderer = 'webgl') { await page.locator(`${rootSelector}[data-renderer="${renderer}"]`).waitFor({ timeout: 90000 }); }
async function frames(page) { return Number(await page.locator(`${rootSelector} canvas`).getAttribute('data-frames')); }
async function screenshot(page, name) { await page.screenshot({ path: path.join(output, `universe-integration-${name}.png`) }); }

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const desktop = await mockedContext(browser, { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await pageFor(desktop);
    await page.goto(`${baseURL}/cliente/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('heading', { name: 'Tu universo empieza aquí' }).waitFor();
    await world(page);
    await page.getByRole('button', { name: 'Abrir ayuda de Leonaris' }).waitFor();
    await page.waitForTimeout(1000);
    metrics.actualLayout = await page.locator('.tc-rank-panel').evaluate(node => ({ backgroundColor: getComputedStyle(node).backgroundColor, backgroundImage: getComputedStyle(node).backgroundImage, rank: node.dataset.panelRank, canvasCount: document.querySelectorAll('[data-celestial-universe] canvas').length }));
    assert.equal(metrics.actualLayout.backgroundColor, 'rgba(0, 0, 0, 0)');
    assert.equal(metrics.actualLayout.backgroundImage, 'none');
    assert.equal(metrics.actualLayout.canvasCount, 1);
    assert.equal(metrics.actualLayout.rank, 'diamond');
    checks.push('Actual dashboard renders through the transparent Diamante rank shell with one WebGL canvas');
    await screenshot(page, 'dashboard-desktop');

    const leo = page.getByRole('button', { name: 'Abrir ayuda de Leonaris' });
    const leoBefore = await leo.boundingBox();
    await page.evaluate(() => window.scrollTo({ top: 680, behavior: 'instant' }));
    await page.waitForTimeout(1000);
    const leoAfter = await leo.boundingBox();
    metrics.leo = { before: leoBefore, after: leoAfter, scrollY: await page.evaluate(() => scrollY) };
    assert.ok(metrics.leo.scrollY > 100, 'The actual page must scroll for this check');
    assert.ok(Math.abs(leoAfter.y - leoBefore.y) < 3, 'Leo remains viewport-anchored while the real page scrolls');
    await leo.click();
    await page.getByRole('region', { name: 'Ayuda de Leonaris' }).waitFor();
    await page.getByRole('button', { name: 'Cerrar ayuda' }).click();
    checks.push('Leonaris remains fixed to the viewport and its help opens above the new world');
    await page.getByRole('button', { name: 'Pausar universo', exact: true }).click();
    await page.getByRole('button', { name: 'Reanudar universo', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reanudar universo', exact: true }).click();
    checks.push('The universe pause control remains clickable beside the actual rank shell');

    await page.getByRole('button', { name: 'Canjear', exact: true }).click();
    await page.getByRole('dialog', { name: 'Confirmar canje' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Pausar universo', exact: true }).evaluate(control => {
      const r = control.getBoundingClientRect();
      return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.tc-redeem-overlay');
    }), true);
    await screenshot(page, 'modal-stacking');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    checks.push('The actual redemption modal covers the universe control without submitting any redemption');

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const canvas = await page.locator(`${rootSelector} canvas`).elementHandle();
    await page.getByRole('navigation', { name: 'Secciones del panel de cliente' }).getByRole('link', { name: 'Ruleta', exact: true }).click();
    await page.waitForURL('**/cliente/ruleta');
    await page.getByRole('heading', { name: 'Ruletas clientes', exact: true }).waitFor();
    await world(page);
    await page.waitForTimeout(1700);
    assert.equal(await canvas.evaluate(node => node === document.querySelector('[data-celestial-universe] canvas')), true);
    assert.equal(await page.locator(rootSelector).getAttribute('data-destination'), 'Saturno');
    checks.push('The actual dashboard-to-Ruleta menu navigation retains the same canvas and changes to Saturn');
    await screenshot(page, 'ruleta-desktop');

    // Simulated hidden-document event: deterministic in headless browsers.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(150);
    const hiddenFrames = await frames(page);
    await page.waitForTimeout(750);
    assert.equal(await frames(page), hiddenFrames);
    await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(750);
    assert.ok(await frames(page) > hiddenFrames);
    checks.push('Simulated document visibility events suspend render work and resume it');

    const extensionAvailable = await page.evaluate(() => {
      const gl = document.querySelector('[data-celestial-universe] canvas').getContext('webgl2');
      window.__qaLoseContext = gl.getExtension('WEBGL_lose_context');
      if (!window.__qaLoseContext) return false;
      window.__qaLoseContext.loseContext();
      return true;
    });
    assert.equal(extensionAvailable, true, 'Headless GPU must support context-loss verification');
    await world(page, 'fallback');
    assert.equal(await page.getByRole('heading', { name: 'Ruletas clientes', exact: true }).isVisible(), true);
    await screenshot(page, 'context-lost');
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__qaLoseContext.restoreContext());
    await world(page);
    await page.waitForTimeout(750);
    assert.equal(await canvas.evaluate(node => node === document.querySelector('[data-celestial-universe] canvas')), true);
    assert.equal(await page.locator(`${rootSelector} canvas`).count(), 1);
    checks.push('A real WEBGL_lose_context event shows the static fallback and restores the same canvas');
    await screenshot(page, 'context-restored');

    const mobile = await mockedContext(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mobilePage = await pageFor(mobile);
    await mobilePage.goto(`${baseURL}/cliente/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await mobilePage.getByRole('heading', { name: 'Tu universo empieza aquí' }).waitFor();
    await world(mobilePage);
    await mobilePage.waitForTimeout(700);
    metrics.mobile = await mobilePage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, worldCanvases: document.querySelectorAll('[data-celestial-universe] canvas').length }));
    assert.ok(metrics.mobile.scrollWidth <= metrics.mobile.viewport + 1);
    await mobilePage.getByRole('button', { name: 'Pausar universo', exact: true }).click();
    await mobilePage.getByRole('button', { name: 'Reanudar universo', exact: true }).click();
    await screenshot(mobilePage, 'dashboard-mobile');
    checks.push('Actual mobile dashboard has no horizontal overflow and its motion control remains usable');
    await mobilePage.getByRole('button', { name: 'Abrir ayuda de Leonaris' }).click();
    await mobilePage.getByRole('region', { name: 'Ayuda de Leonaris' }).waitFor();
    await mobilePage.waitForTimeout(400);
    const overlap = await mobilePage.evaluate(() => {
      const control = document.querySelector('button[aria-label="Pausar universo"]');
      const panel = document.querySelector('[aria-label="Ayuda de Leonaris"]');
      const a = control.getBoundingClientRect(), b = panel.getBoundingClientRect();
      const x = Math.max(a.left, b.left) + 4;
      const y = Math.max(a.top, b.top) + 4;
      return { overlaps: x < Math.min(a.right, b.right) && y < Math.min(a.bottom, b.bottom), hitsLeo: panel.contains(document.elementFromPoint(x, y)) };
    });
    metrics.mobileLeoControlOverlap = overlap;
    assert.equal(overlap.overlaps, true, 'This mobile viewport should exercise the actual overlapping region');
    assert.equal(overlap.hitsLeo, true, 'Leonaris help must stay above the universe control');
    await screenshot(mobilePage, 'leo-mobile-stacking');
    await mobilePage.getByRole('button', { name: 'Cerrar ayuda' }).click();
    await mobilePage.getByRole('button', { name: 'Canjear', exact: true }).click();
    await mobilePage.getByRole('dialog', { name: 'Confirmar canje' }).waitFor();
    assert.equal(await mobilePage.getByRole('button', { name: 'Pausar universo', exact: true }).evaluate(control => {
      const r = control.getBoundingClientRect();
      return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.tc-redeem-overlay');
    }), true);
    await mobilePage.getByRole('button', { name: 'Cancelar', exact: true }).click();
    checks.push('Actual mobile Leonaris help and redemption overlay both stack above the universe control');
    await mobilePage.getByRole('navigation', { name: 'Secciones del panel de cliente' }).getByRole('link', { name: 'Ruleta', exact: true }).click();
    await mobilePage.waitForURL('**/cliente/ruleta');
    await world(mobilePage);
    await mobilePage.waitForTimeout(1600);
    assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await screenshot(mobilePage, 'ruleta-mobile');
    checks.push('Actual mobile Ruleta navigation and layout fit the viewport');
    await mobile.close();

    const authContext = await mockedContext(browser, { viewport: { width: 390, height: 844 } }, false);
    const authPage = await pageFor(authContext);
    await authPage.goto(`${baseURL}/cliente/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await authPage.getByRole('heading', { name: 'Tarot Celestial', exact: true }).waitFor();
    assert.equal(await authPage.locator(rootSelector).count(), 0);
    checks.push('Actual login page remains outside the universe renderer');
    await authContext.close();

    assert.deepEqual(errors, []);
    checks.push('No uncaught JavaScript errors on the actual client routes');
    const report = { ok: true, source: 'real client routes; fully mocked API, authentication and realtime transport', checks, metrics, interceptedApis: [...calls].sort(), blockedExternalHosts: [...new Set(blocked)].sort(), screenshots: output };
    fs.writeFileSync(path.join(output, 'universe-integration-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => {
  fs.writeFileSync(path.join(output, 'universe-integration-report.json'), JSON.stringify({ ok: false, checks, metrics, errors, interceptedApis: [...calls].sort(), error: error.message }, null, 2));
  console.error(error);
  process.exitCode = 1;
});
