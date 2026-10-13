// Local-only QA. Every API and external host is intercepted; no real transaction is possible.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const baseURL = process.env.TC_PRICES_QA_URL || 'http://127.0.0.1:3020';
const origin = new URL(baseURL).origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'QA must use localhost');
const output = process.env.TC_PRICES_QA_OUTPUT || path.resolve(__dirname, '../../outputs/benefits-redesign-qa');
fs.mkdirSync(output, { recursive: true });
const checks = [], failures = [], errors = [], metrics = [], transactions = [], requests = [];
const ids = { A: '00000000-0000-4000-8000-000000000001', B: '00000000-0000-4000-8000-000000000002' };
const pricePath = '/cliente/precios-ofertas', catalogPath = '/api/cliente/catalogo';
const card = 'article[data-level]';
function loadSource(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => name in mocks ? mocks[name] : require(name) });
  return JSON.parse(JSON.stringify(exports));
}
const packs = loadSource('src/lib/server/cliente-minute-packs.ts', { '@/lib/ruleta': {} }).CLIENTE_MINUTE_PACKS;
const oraclePacks = loadSource('src/lib/server/oracle-premium.ts').ORACLE_PACKS;
const questionPack = loadSource('src/lib/server/oracle-questions.ts').ORACLE_QUESTION_PACK;
function catalogue(owner = 'A') {
  const diamond = owner === 'B';
  return { ok: true, rankKey: diamond ? 'diamante' : 'bronce', rankLabel: diamond ? 'Diamante' : 'Bronce', packs: packs.map((pack, i) => {
    const level = Math.floor(i / 3) + 1;
    return { ...pack,
      nombre: diamond && i === 0 ? '10 minutos · cuenta B' : pack.nombre,
      packageLevel: level, rankBenefits: {
        enabled: true, coins: diamond ? 500 : [50, 150, 300][level - 1],
        oracle_credits: diamond ? [0, 1, 3][level - 1] : level === 3 ? 2 : 0,
        roulette_level_1_spins: level === 1 ? 1 : 0,
        roulette_level_2_spins: level === 2 ? 1 : 0,
        roulette_level_3_spins: level === 3 ? 1 : 0,
        roulette_special_spins: diamond && level === 3 ? 1 : 0,
      }, rankBenefitsStatus: 'ready',
    };
  }), oraclePacks, questionPack };
}
const rankBox = '[data-benefits="rank"]', includedBox = '[data-benefits="included"]';
// Synthetic catalogue with the same maxima already audited separately in Supabase.
const prizes = [1, 2, 3].flatMap(level => [
  { id: `qa-minutes-${level}`, nivel: level, reward_type: 'minutes', reward_value: [60, 80, 100][level - 1], probability: 1, special: false },
  { id: `qa-coins-${level}`, nivel: level, reward_type: 'coins', reward_value: [400, 1000, 2000][level - 1], probability: 1, special: false },
]);
async function fixture(browser, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, deviceScaleFactor: options.scale || 1, isMobile: !!options.mobile, hasTouch: !!options.mobile, reducedMotion: options.reducedMotion || 'no-preference', serviceWorkers: 'block' });
  const state = { records: [], gates: [], hold: new Set(options.hold || []), fail: new Set(options.fail || []), nullRoulette: !!options.nullRoulette, credits: options.credits === undefined ? 4 : options.credits, closing: false };
  await context.addInitScript(({ ids, catalogPath }) => {
    const now = Math.floor(Date.now() / 1000), id = ids.A;
    const encode = value => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: id, session_id: 'session-A', aud: 'authenticated', role: 'authenticated', exp: now + 86400 })}.fake-test-signature`;
    if (!localStorage.getItem('sb-example-auth-token-cliente')) localStorage.setItem('sb-example-auth-token-cliente', JSON.stringify({ access_token: token, refresh_token: 'fake-refresh-A', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user: { id, aud: 'authenticated', role: 'authenticated', email: 'ana@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
    window.__priceQA = { replies: [], cards: [], aborts: [], nowOffset: 0 };
    const dateNow = Date.now; Date.now = () => dateNow() + window.__priceQA.nowOffset;
    const fetchOriginal = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]);
      args[1]?.signal?.addEventListener('abort', () => window.__priceQA.aborts.push({ url, at: performance.now() }), { once: true });
      const response = await fetchOriginal(...args);
      if (url.includes(catalogPath) && response.ok) {
        const jsonOriginal = response.json.bind(response);
        response.json = async () => { const value = await jsonOriginal(); window.__priceQA.replies.push(performance.now()); return value; };
      }
      return response;
    };
    let observedCard = null;
    new MutationObserver(() => {
      const node = document.querySelector('article[data-level] h3');
      if (node && node !== observedCard) { observedCard = node; window.__priceQA.cards.push({ at: performance.now(), label: node.textContent }); }
    }).observe(document, { childList: true, subtree: true });
    // Block telephone actions and external navigation even if a test accidentally clicks them.
    document.addEventListener('click', event => { const a = event.target.closest?.('a'); if (a && /^(tel:|mailto:|https?:)/.test(a.getAttribute('href') || '') && !a.href.startsWith(location.origin)) event.preventDefault(); }, true);
    window.open = () => null;
  }, { ids, catalogPath });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    let sub = ids.A;
    try { sub = JSON.parse(Buffer.from(request.headers().authorization.split('.')[1], 'base64url').toString()).sub; } catch {}
    const owner = sub === ids.B ? 'B' : 'A';
    const user = { id: sub, aud: 'authenticated', role: 'authenticated', email: `${owner}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    if (url.origin !== origin) {
      if (url.hostname === 'example.supabase.co') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname === '/auth/v1/user' ? user : []) });
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const record = { endpoint: url.pathname, method: request.method(), owner, scenario: options.name || '', started: Date.now(), completed: false };
    state.records.push(record); requests.push(record);
    const fulfill = async (json, status = 200) => {
      record.completed = true;
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) }).catch(() => {});
    };
    if (request.method() !== 'GET') {
      if (url.pathname === '/api/cliente/activity/ping' || url.pathname === '/api/cliente/leo') return fulfill({ ok: true });
      transactions.push({ path: url.pathname, method: request.method(), body: request.postData() });
      return fulfill({ ok: false, error: 'QA blocked transaction' }, 403);
    }
    // Capture the response before a gate is released to reproduce a genuinely stale owner response.
    const rankKey = owner === 'B' ? 'diamante' : 'bronce', rankLabel = owner === 'B' ? 'Diamante' : 'Bronce';
    const wallet = { effective_rank: rankKey, minutes_free: 193, minutes_normal: 40, coins: 1200, oracle_credits: state.credits, spins: { total: 0 } };
    let json = { ok: true, data: [] };
    if (url.pathname === catalogPath) json = options.catalogue ? options.catalogue(owner) : catalogue(owner);
    else if (url.pathname === '/api/cliente/me') json = { ok: true, cliente: { id: sub, nombre: owner, email: user.email, rango_actual: rankKey, onboarding_completado: true }, wallet, recompensas: [], packs: [], cliente_notificaciones: [], rank_info: { label: rankLabel, benefits: [] }, rank_progress: { current_label: rankLabel, progress_percent: 100 }, rank_benefits: { ritual_access: true } };
    else if (url.pathname === '/api/cliente/ruleta') json = state.nullRoulette ? { ok: true, catalogue: null } : { ok: true, cliente_id: sub, available_spins: 0, diamond_access: true, catalogue: options.prizes || [], history: [], entitlements: [], level_1_spins: 0, level_2_spins: 0, level_3_spins: 0, level_4_spins: 0, level_5_spins: 0 };
    else if (url.pathname === '/api/cliente/state') json = { ok: true, state: wallet };
    else if (url.pathname === '/api/cliente/promotions/active') json = { ok: true, promotion: null };
    else if (url.pathname === '/api/cliente/rangos') json = { ok: true, cliente_id: sub, currency: 'USD', window_days: 30, state: { effective: rankKey, automatic: rankKey, total: 200, purchases: 3, has_override: false }, ranks: [], warnings: [] };
    else if (url.pathname === '/api/cliente/leo') json = { ok: true, profile: { hidden: true, muted: true }, facts: { coins: 1200, minutes: 233, oracleCredits: 4 }, companion: { displayName: owner, memoryEnabled: false, style: 'warm', memories: [], favoriteSections: [], learning: { helpful: 0, unhelpful: 0, visits: 0, summary: '' }, greeting: null } };
    else if (url.pathname === '/api/cliente/auth/password/status') json = { ok: true, hasPassword: true };
    if (state.hold.has(url.pathname) || state.hold.has(url.pathname + ':' + owner)) await new Promise(resolve => state.gates.push({ endpoint: url.pathname, owner, resolve }));
    if (state.closing) return route.abort().catch(() => {});
    if (state.fail.has(url.pathname)) return fulfill({ ok: false, error: 'Mock temporarily unavailable' }, 503);
    return fulfill(json);
  });
  if (context.routeWebSocket) await context.routeWebSocket(/supabase\./, socket => socket.close());
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push({ scenario: options.name || '', message: error.message }));
  return { state, context, page,
    start: () => page.goto(baseURL + pricePath, { waitUntil: 'domcontentloaded', timeout: 120000 }),
    release(endpoint, owner) { state.hold.delete(endpoint); state.hold.delete(endpoint + ':' + owner); for (const gate of state.gates.splice(0)) { if (gate.endpoint === endpoint && (!owner || owner === gate.owner)) gate.resolve(); else state.gates.push(gate); } },
    count: endpoint => state.records.filter(row => row.endpoint === endpoint).length,
    async close() { state.closing = true; for (const gate of state.gates) gate.resolve(); await context.close(); },
    async switchAccount() {
      await page.evaluate(async id => {
        const now = Math.floor(Date.now() / 1000), encode = value => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
        const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: id, session_id: 'session-B', aud: 'authenticated', role: 'authenticated', exp: now + 86400 })}.fake-test-signature`;
        const result = await globalThis.__tcSupabaseClienteBrowserClient.auth.setSession({ access_token: token, refresh_token: 'fake-refresh-B' });
        if (result.error) throw result.error;
      }, ids.B);
    },
  };
}
async function check(name, run) { if (process.env.TC_PRICES_QA_FILTER && !name.includes(process.env.TC_PRICES_QA_FILTER)) return; try { await run(); checks.push(name); console.log('PASS: ' + name); } catch (error) { failures.push({ name, error: error.message, stack: error.stack }); console.log('FAIL: ' + name + ': ' + error.message); } }
const shot = (page, name, options = {}) => page.screenshot({ path: path.join(output, name + '.png'), ...options });
async function rendered(page) { await page.getByRole('heading', { name: '10 minutos', exact: true }).waitFor(); }
async function summary(page, label) { return page.getByText(label, { exact: true }).locator('..').locator('strong').innerText(); }
async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, cards: [...document.querySelectorAll('article[data-level]')].map(el => ({ width: el.clientWidth, scroll: el.scrollWidth, box: el.getBoundingClientRect().toJSON(), text: el.querySelector('h3')?.textContent })), benefitChips: [...document.querySelectorAll('[class*="levelBenefitChip"]')].map(el => ({ width: el.clientWidth, scroll: el.scrollWidth, whiteSpace: getComputedStyle(el).whiteSpace, class: el.className, text: el.textContent })) }));
  metrics.push({ label, ...size });
  assert.ok(size.document <= size.viewport + 1 && size.body <= size.viewport + 1, JSON.stringify(size));
  for (const item of size.cards) { assert.ok(item.scroll <= item.width + 1, 'Card content overflow: ' + JSON.stringify(item)); assert.ok(item.box.width >= 160, 'Card too narrow: ' + JSON.stringify(item)); }
  for (const item of size.benefitChips) assert.ok(item.scroll <= item.width + 1, 'Benefits clipped: ' + JSON.stringify(item));
}

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    await check('All nine packs expose their own minutes and price; normal and Diamond rank rewards stay separate from included purchases', async () => {
      for (const owner of ['A', 'B']) {
        const f = await fixture(browser, { name: `benefits-${owner}`, prizes, catalogue: () => catalogue(owner) });
        try {
          await f.start(); await f.page.locator(card).first().waitFor();
          assert.equal(await f.page.locator(card).count(), 9);
          assert.equal(await f.page.getByText('Beneficios por tu rango', { exact: true }).count(), 9);
          const data = catalogue(owner);
          for (const pack of data.packs) {
            const article = f.page.locator(card).filter({ has: f.page.getByRole('heading', { name: pack.nombre, exact: true }) });
            assert.equal(await article.count(), 1, pack.id + ' title');
            assert.match(await article.innerText(), new RegExp(pack.priceUsd.toFixed(2).replace('.', ',') + '\\s*€'), pack.id + ' EUR price');
            const rank = await article.locator(rankBox).innerText(), included = await article.locator(includedBox).innerText();
            assert.ok(rank.includes(`+${pack.rankBenefits.coins} Coins`), pack.id + ': ' + rank);
            assert.match(rank, new RegExp(`1\\s+giro[^\\n]*[Nn]ivel\\s*${pack.packageLevel}`, 'i'));
            if (pack.rankBenefits.oracle_credits) assert.match(rank, new RegExp(`${pack.rankBenefits.oracle_credits}\\s+(?:tiradas?\\s+(?:del?\\s+)?(?:Oráculo)|Oráculo)`, 'i'));
            else assert.doesNotMatch(rank, /\d+\s+(?:tiradas?|Oráculo)/i);
            if (pack.rankBenefits.roulette_special_spins) assert.match(rank, /1\s+giro[^\n]*[Ee]special/);
            assert.match(included, new RegExp(`${pack.rouletteSpins}\\s+giros?[^\\n]*[Nn]ivel\\s*${pack.rouletteLevel}`, 'i'));
            if (pack.oracleCredits) assert.match(included, new RegExp(`${pack.oracleCredits}\\s+(?:tiradas?\\s+(?:del?\\s+)?(?:Oráculo)|Oráculo)`, 'i'));
            assert.doesNotMatch(included, /50 Coins|150 Coins|300 Coins|500 Coins/, 'rank coins must not be repeated as base benefit');
          }
          await f.page.locator('#nivel-1').scrollIntoViewIfNeeded(); await shot(f.page, `benefits-${owner}-level1`);
          await f.page.locator('#nivel-3').scrollIntoViewIfNeeded(); await shot(f.page, `benefits-${owner}-level3`);
          await shot(f.page, `benefits-${owner}-full`, { fullPage: true });
        } finally { await f.close(); }
      }
    });
    await check('Configured roulette maxima are possible prizes rather than purchased minutes, and each next-level link reaches a visible section', async () => {
      const f = await fixture(browser, { name: 'prizes-and-levels', prizes });
      try {
        await f.start(); await rendered(f.page);
        for (const [index, max] of [60, 80, 100].entries()) {
          const section = f.page.locator(`#nivel-${index + 1}`);
          await section.getByText(/Premios posibles, no garantizados/i).waitFor();
          const text = await section.innerText();
          assert.match(text, new RegExp(`hasta\\s+${max}\\s+min`, 'i'));
          assert.match(text, index === 0 ? /400\s+Coins/ : index === 1 ? /1[.,\s]?000\s+Coins/ : /2[.,\s]?000\s+Coins/);
          assert.equal(await section.locator(card).count(), 3);
        }
        for (const level of [2, 3]) {
          const link = f.page.locator(`a[href="#nivel-${level}"]`).first();
          assert.equal(await link.count(), 1); await link.click();
          await f.page.waitForFunction(level => {
            const rect = document.getElementById(`nivel-${level}`).getBoundingClientRect();
            return rect.top >= -10 && rect.top < innerHeight * .75;
          }, level);
        }
        assert.equal(await f.page.getByRole('tab').count(), 0, 'all levels must be discoverable by ordinary scrolling');
      } finally { await f.close(); }
    });
    await check('Missing rank information never displays invented Coins or oracle credits while all base packs remain available', async () => {
      for (const status of ['no_effective_rank', 'unavailable']) {
        const f = await fixture(browser, { name: status, prizes, catalogue: () => {
          const data = catalogue();
          return { ...data, rankKey: null, rankLabel: null, packs: data.packs.map(pack => ({ ...pack, rankBenefits: null, rankBenefitsStatus: status })) };
        } });
        try {
          await f.start(); await rendered(f.page); assert.equal(await f.page.locator(card).count(), 9);
          for (const article of await f.page.locator(card).all()) {
            const text = await article.locator(rankBox).innerText();
            assert.doesNotMatch(text, /\+\s*\d+\s*(?:Coins|Oráculo|tirada|giro)/i, status + ': ' + text);
            assert.equal(await article.getByRole('button', { name: 'Elegir paquete', exact: true }).isDisabled(), false);
          }
        } finally { await f.close(); }
      }
    });
    await check('Package grouping never substitutes a different roulette level or advertises a maximum for mixed or absent included spins', async () => {
      for (const scenario of ['different-wheel', 'mixed-wheels', 'no-base-spins']) {
        const f = await fixture(browser, { name: scenario, prizes, catalogue: () => {
          const data = catalogue();
          data.packs = data.packs.map((pack, index) => pack.packageLevel !== 2 ? pack : {
            ...pack,
            rouletteLevel: scenario === 'different-wheel' || scenario === 'mixed-wheels' && index === 3 ? 1 : 2,
            rouletteSpins: scenario === 'no-base-spins' && index === 3 ? 0 : 1,
          });
          return data;
        } });
        try {
          await f.start(); await rendered(f.page);
          const section = f.page.locator('#nivel-2'), banner = section.locator('[class*="prizeBanner"]');
          await f.page.locator('#nivel-1').getByText(/hasta\s+60\s+min/i).waitFor();
          const text = await banner.innerText();
          if (scenario === 'different-wheel') {
            assert.match(text, /hasta\s+60\s+min/i); assert.match(text, /400\s+Coins/i); assert.doesNotMatch(text, /80\s+min|1[.,\s]?000\s+Coins/i);
            assert.equal(await banner.locator('a[href="/cliente/ruleta?nivel=1"]').count(), 1);
            assert.equal(await section.locator(`${includedBox} a[href="/cliente/ruleta?nivel=1"]`).count(), 3);
          } else assert.doesNotMatch(text, /hasta\s*\d|\d[.,\d]*\s+Coins/i);
        } finally { await f.close(); }
      }
    });
    await check('Catalogue renders independently of held account, roulette, promotion and me requests', async () => {
      const f = await fixture(browser, { name: 'independent', hold: ['/api/cliente/me', '/api/cliente/state', '/api/cliente/ruleta', '/api/cliente/promotions/active'] });
      try {
        await f.start(); await rendered(f.page);
        assert.equal(await f.page.locator(card).count(), 9);
        assert.equal(await summary(f.page, 'Giros disponibles'), '—');
        assert.equal(await summary(f.page, 'Tiradas compradas'), '—');
        assert.equal(await summary(f.page, 'Packs de minutos'), '9');
        assert.equal(f.count('/api/cliente/oraculo'), 0);
        assert.equal(await f.page.getByText(/Hasta \+?\d/).count(), 0);
        assert.equal(await f.page.getByText('Nuevas promociones próximamente', { exact: true }).count(), 0);
        assert.ok(f.state.records.filter(row => f.state.hold.has(row.endpoint)).every(row => !row.completed));
        const timing = await f.page.evaluate(() => { const q = window.__priceQA; return { reply: q.replies[0], firstCard: q.cards[0]?.at, label: q.cards[0]?.label, responseToCardMs: q.cards[0]?.at - q.replies[0] }; });
        metrics.push({ ...timing, label: 'catalogue response to first card' });
        assert.ok(timing.responseToCardMs >= 0 && timing.responseToCardMs < 1000, JSON.stringify(timing));
        await shot(f.page, 'desktop-prices-independent');
        await f.page.locator(card).first().scrollIntoViewIfNeeded(); await shot(f.page, 'desktop-prices-cards');
        assert.equal(await f.page.getByRole('button', { name: 'Ver más minutos', exact: true }).count(), 0);
        assert.equal(await f.page.locator(card).count(), 9);
        for (const pack of packs) {
          const article = f.page.locator(card).filter({ has: f.page.getByRole('heading', { name: pack.nombre, exact: true }) });
          assert.match(await article.innerText(), new RegExp(pack.priceUsd.toFixed(2).replace('.', ',') + '\\s*€'), pack.id + ' original price in EUR');
          assert.equal((await article.locator('h3 strong').innerText()).trim(), String(pack.totalMinutes), pack.id + ' original minutes');
        }
        for (const [index, coins] of [50, 150, 300].entries()) {
          const boxes = await f.page.locator(`article[data-level="${index + 1}"] ${rankBox}`).allInnerTexts();
          assert.equal(boxes.length, 3); assert.ok(boxes.every(text => text.includes(`+${coins} Coins`)));
        }
      } finally { await f.close(); }
    });
    await check('Slow catalogue shows skeleton; a failed response offers retry and recovers all products', async () => {
      const f = await fixture(browser, { name: 'retry', hold: [catalogPath], fail: [catalogPath] });
      try {
        const catalogueStarted = f.page.waitForRequest(request => new URL(request.url()).pathname === catalogPath);
        await f.start(); await catalogueStarted; await f.page.getByRole('status', { name: 'Cargando precios' }).waitFor();
        assert.equal(await f.page.locator(card).count(), 0); assert.equal(await summary(f.page, 'Packs de minutos'), '—');
        await shot(f.page, 'desktop-prices-loading'); f.release(catalogPath);
        await f.page.getByRole('button', { name: 'Reintentar precios' }).waitFor();
        assert.equal(await f.page.locator(card).count(), 0); await shot(f.page, 'desktop-prices-retry');
        f.state.fail.delete(catalogPath); await f.page.getByRole('button', { name: 'Reintentar precios' }).click(); await rendered(f.page);
        assert.equal(f.count(catalogPath), 2); assert.equal(await f.page.getByRole('button', { name: 'Reintentar precios' }).count(), 0);
        await f.page.getByRole('heading', { name: 'Pack Oráculo', exact: true }).waitFor();
        await f.page.getByRole('heading', { name: 'Pack Destino', exact: true }).waitFor();
        await f.page.getByRole('heading', { name: 'Preguntas al Oráculo', exact: true }).waitFor();
      } finally { await f.close(); }
    });
    await check('Failed or malformed roulette never invents maximum prizes; unknown balance stays distinct from confirmed zero', async () => {
      for (const nullRoulette of [false, true]) {
        const f = await fixture(browser, { name: 'unknown-rewards', fail: nullRoulette ? [] : ['/api/cliente/ruleta'], nullRoulette, credits: null });
        try {
          await f.start(); await rendered(f.page); await f.page.getByText('Consulta tus giros en Ruleta', { exact: true }).waitFor();
          assert.equal(await summary(f.page, 'Giros disponibles'), '—'); assert.equal(await summary(f.page, 'Tiradas compradas'), '—');
          assert.equal(await f.page.getByText(/Hasta \+?\d/).count(), 0);
          assert.equal(await f.page.getByText(/Descubre los premios de la ruleta Nivel [123]/).count(), 3);
          f.state.credits = 0; await f.page.evaluate(() => window.dispatchEvent(new Event('online')));
          await f.page.waitForFunction(() => [...document.querySelectorAll('small')].find(el => el.textContent === 'Tiradas compradas')?.parentElement.querySelector('strong')?.textContent === '0');
        } finally { await f.close(); }
      }
    });
    await check('Focus refresh coalesces simultaneous events to one catalogue request', async () => {
      const f = await fixture(browser, { name: 'focus' });
      try {
        await f.start(); await rendered(f.page); const before = f.count(catalogPath); f.state.hold.add(catalogPath);
        await f.page.evaluate(() => { window.__priceQA.nowOffset = 16001; for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('tc-client-balances-changed')); });
        await f.page.waitForFunction(() => document.querySelector('[aria-busy="true"]'));
        await f.page.waitForTimeout(250); assert.equal(f.count(catalogPath) - before, 1);
        f.release(catalogPath); await f.page.locator('[aria-busy="false"]').waitFor();
      } finally { await f.close(); }
    });
    await check('Account switch aborts old catalogue and isolates delayed account A from account B', async () => {
      const f = await fixture(browser, { name: 'account-switch', hold: [catalogPath + ':A'] });
      try {
        const catalogueStarted = f.page.waitForRequest(request => new URL(request.url()).pathname === catalogPath);
        await f.start(); await catalogueStarted; await f.page.getByRole('status', { name: 'Cargando precios' }).waitFor();
        await f.page.waitForFunction(() => !!globalThis.__tcSupabaseClienteBrowserClient); await f.switchAccount();
        await f.page.getByRole('heading', { name: '10 minutos · cuenta B', exact: true }).waitFor();
        assert.ok((await f.page.evaluate(() => window.__priceQA.aborts)).some(row => row.url.includes('/api/cliente/catalogo')));
        f.release(catalogPath, 'A'); await f.page.waitForTimeout(300);
        assert.equal(await f.page.getByRole('heading', { name: '10 minutos', exact: true }).count(), 0);
        const boxes = await f.page.locator(rankBox).allInnerTexts();
        assert.equal(boxes.length, 9); assert.ok(boxes.every(text => text.includes('+500 Coins')));
        assert.ok(boxes.every(text => !text.includes('+50 Coins') && !text.includes('+150 Coins') && !text.includes('+300 Coins')));
      } finally { await f.close(); }
    });
    await check('Route change aborts the pending prices catalogue and a later response cannot restore old cards', async () => {
      const f = await fixture(browser, { name: 'unmount', hold: [catalogPath] });
      try {
        const catalogueStarted = f.page.waitForRequest(request => new URL(request.url()).pathname === catalogPath);
        await f.start(); await catalogueStarted; await f.page.getByRole('status', { name: 'Cargando precios' }).waitFor();
        await f.page.getByRole('link', { name: 'Inicio', exact: true }).click(); await f.page.waitForURL('**/cliente/dashboard');
        await f.page.waitForFunction(() => window.__priceQA.aborts.some(row => row.url.includes('/api/cliente/catalogo')));
        f.release(catalogPath); await f.page.waitForTimeout(250);
        assert.equal(await f.page.locator('main[data-leo-page="/cliente/precios-ofertas"]').count(), 0);
      } finally { await f.close(); }
    });
    await check('Oracle retains its manual purchase dialog while minutes use the authenticated client PayPal checkout', async () => {
      const f = await fixture(browser, { name: 'purchase-contract' });
      try {
        await f.start(); await rendered(f.page); await f.page.locator('#oraculo-packs').getByRole('button', { name: 'COMPRAR', exact: true }).first().click();
        await f.page.getByRole('dialog', { name: 'Compras desde la app en mantenimiento' }).waitFor();
        assert.equal(transactions.length, 0); await f.page.getByRole('button', { name: 'Cerrar aviso' }).click();
        const source = fs.readFileSync(path.resolve(__dirname, '../src/app/cliente/precios-ofertas/page.tsx'), 'utf8');
        assert.match(source, /JSON\.stringify\(\{ pack_id: packId \}\)/);
        assert.match(source, /checkoutMinutes\(pack\.id\)/);
        assert.match(source, /fetch\("\/api\/cliente\/pagos\/paypal"/);
        assert.match(source, /JSON\.stringify\(\{ packId, attemptId \}\)/);
        assert.match(source, /checkout\("\/api\/cliente\/oraculo\/checkout", pack\.id\)/);
        assert.match(source, /checkout\("\/api\/cliente\/oraculo\/checkout", questionPack\.id\)/);
        assert.match(source, /JSON\.stringify\(\{ package_id: packageId \}\)/);
        metrics.push({ label: 'checkout coverage boundary', note: 'Oracle keeps its telephone maintenance dialog. Minute PayPal flow is exercised separately in client-paypal-browser.cjs with all provider calls mocked.' });
      } finally { await f.close(); }
    });
    await check('Refresh and failure disable stale catalogue purchases; retry enables the minute purchase action', async () => {
      const f = await fixture(browser, { name: 'stale-purchase' });
      try {
        await f.start(); await rendered(f.page); const buy = f.page.locator(card).first().getByRole('button', { name: 'Elegir paquete', exact: true });
        assert.equal(await buy.isDisabled(), false); f.state.hold.add(catalogPath); f.state.fail.add(catalogPath);
        await f.page.evaluate(() => window.dispatchEvent(new Event('online')));
        await f.page.locator('[aria-busy="true"]').waitFor(); assert.equal(await buy.isDisabled(), true);
        f.release(catalogPath); await f.page.getByRole('button', { name: 'Reintentar precios' }).waitFor(); assert.equal(await buy.isDisabled(), true);
        f.state.fail.delete(catalogPath); await f.page.getByRole('button', { name: 'Reintentar precios' }).click();
        await f.page.getByRole('button', { name: 'Reintentar precios' }).waitFor({ state: 'detached' }); assert.equal(await buy.isDisabled(), false);
        assert.equal(transactions.length, 0);
      } finally { await f.close(); }
    });
    await check('320px mobile packs stay readable without horizontal document or card overflow', async () => {
      const f = await fixture(browser, { name: 'mobile320', viewport: { width: 320, height: 740 }, mobile: true });
      try {
        await f.start(); await rendered(f.page); await noOverflow(f.page, '320px mobile');
        await shot(f.page, 'mobile-320-prices'); await f.page.locator(card).first().scrollIntoViewIfNeeded(); await shot(f.page, 'mobile-320-card');
        assert.equal(await f.page.locator(card).count(), 9); await noOverflow(f.page, '320px mobile all levels visible');
        await f.page.locator('article[data-level="3"]').first().scrollIntoViewIfNeeded(); await shot(f.page, 'mobile-320-premium');
      } finally { await f.close(); }
    });
    await check('200 percent desktop reflow keeps prices and actions readable without horizontal overflow', async () => {
      // 720 CSS pixels at DPR 2 represents a 1440px desktop at 200% browser zoom.
      const f = await fixture(browser, { name: 'zoom200', viewport: { width: 720, height: 500 }, scale: 2 });
      try {
        await f.start(); await rendered(f.page); await noOverflow(f.page, '200% desktop reflow: 1440 device pixels / 720 CSS pixels');
        await f.page.locator(card).first().scrollIntoViewIfNeeded(); await shot(f.page, 'desktop-200-percent-card');
      } finally { await f.close(); }
    });
    await check('Reduced-motion cards keep all rewards visible and offer readable keyboard actions', async () => {
      const f = await fixture(browser, { name: 'reduced-motion', reducedMotion: 'reduce', prizes });
      try {
        await f.start(); await rendered(f.page);
        assert.equal(await f.page.locator(card).count(), 9);
        const buy = f.page.locator(card).first().getByRole('button', { name: 'Elegir paquete', exact: true });
        await buy.focus();
        const presentation = await buy.evaluate(button => {
          const style = getComputedStyle(button), box = button.getBoundingClientRect();
          return { focused: document.activeElement === button, focusVisible: button.matches(':focus-visible'), height: box.height, fontSize: parseFloat(style.fontSize), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
        });
        assert.equal(presentation.focused, true); assert.equal(presentation.focusVisible, true);
        assert.ok(presentation.height >= 44, JSON.stringify(presentation)); assert.ok(presentation.fontSize >= 16, JSON.stringify(presentation));
        const animations = await f.page.locator(card).evaluateAll(cards => cards.flatMap(card => card.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').map(animation => ({ duration: animation.effect?.getTiming().duration, iterations: animation.effect?.getTiming().iterations }))));
        assert.ok(animations.every(animation => Number(animation.duration) <= 1 || animation.iterations !== Infinity), JSON.stringify(animations));
        metrics.push({ label: 'reduced motion and keyboard action', ...presentation, runningAnimations: animations });
        await shot(f.page, 'benefits-reduced-motion-keyboard');
        assert.equal(transactions.length, 0);
      } finally { await f.close(); }
    });
    await check('No unexpected page errors, real transactions or oracle-reading requests', async () => {
      assert.deepEqual(errors, []); assert.deepEqual(transactions, []);
      // Only the route-unmount scenario navigates to Dashboard, which legitimately loads its own oracle resources.
      assert.equal(requests.filter(row => row.scenario !== 'unmount' && row.endpoint === '/api/cliente/oraculo').length, 0);
    });
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), baseURL, checks, failures, errors, metrics, transactions, pricePageOracleReadCount: requests.filter(row => row.scenario !== 'unmount' && row.endpoint === '/api/cliente/oraculo').length, requestCounts: requests.reduce((counts, row) => { const key = row.method + ' ' + row.endpoint; counts[key] = (counts[key] || 0) + 1; return counts; }, {}) }, null, 2));
  }
  console.log(JSON.stringify({ passed: checks.length, failed: failures.length, output })); if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
