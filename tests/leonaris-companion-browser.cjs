// Local-only companion QA: all API calls and external hosts are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const baseURL = process.env.TC_LEONARIS_QA_URL || 'http://127.0.0.1:3020';
const origin = new URL(baseURL).origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
const output = process.env.TC_LEONARIS_QA_OUTPUT || path.resolve(__dirname, '../../outputs/leonaris-companion-qa');
fs.mkdirSync(output, { recursive: true });
const checks = [], failures = [], errors = [], transactions = [];
const ids = { A: '00000000-0000-4000-8000-000000000001', B: '00000000-0000-4000-8000-000000000002' };
const action = { id: 'minutes', label: 'Ver mis minutos', path: '/cliente/dashboard', anchor: 'minutes', explanation: 'Aquí están tus minutos disponibles.' };
const guide = 'aside[aria-label="Leonaris, tu guía celestial"]', panel = 'section[aria-label="Ayuda de Leonaris"]';
const character = `${guide} button[aria-describedby="leonaris-move-help"]`, pet = `${character} >> xpath=..`;
function account(name) { return { name, profile: { hidden: false, muted: false }, memoryEnabled: true, style: 'warm', memories: [{ id: `${name}-note`, content: `Prefiero las explicaciones de ${name}`, createdAt: new Date().toISOString() }], visits: 0, helpful: 0, unhelpful: 0, greeting: { id: `welcome-${name}`, title: `Hola, ${name}`, message: 'Te acompaño con lo que necesitas hoy.', actions: [action] } }; }
const clone = value => JSON.parse(JSON.stringify(value));
async function fixture(browser, options = {}) {
  const context = await browser.newContext({ viewport: options.mobile ? { width: 320, height: 740 } : { width: 1440, height: 1000 }, isMobile: !!options.mobile, hasTouch: !!options.mobile, serviceWorkers: 'block' });
  const state = { A: account('Ana'), B: account('Bea'), posts: [], unavailable: false, failChat: false, holdChat: false, releaseChat: null, gets: 0, pending: 0 };
  const payload = owner => ({ ok: true, profile: owner.profile, facts: { coins: 1200, minutes: 233, oracleCredits: 4, activePromotion: null }, companion: { displayName: owner.name, memoryEnabled: owner.memoryEnabled, style: owner.style, memories: owner.memoryEnabled ? owner.memories : [], favoriteSections: [], learning: { helpful: owner.helpful, unhelpful: owner.unhelpful, visits: owner.visits, summary: owner.visits ? 'Estoy aprendiendo de tus visitas y valoraciones.' : 'Todavía no hay aprendizaje registrado.' }, greeting: owner.greeting } });
  await context.addInitScript(({ ids, stalePreferences }) => {
    if (!localStorage.getItem('sb-example-auth-token-cliente')) {
      const now = Math.floor(Date.now() / 1000), id = ids.A;
      const encode = value => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: id, session_id: 'session-A', aud: 'authenticated', role: 'authenticated', exp: now + 86400 })}.fake-test-signature`;
      localStorage.setItem('sb-example-auth-token-cliente', JSON.stringify({ access_token: token, refresh_token: 'fake-refresh-A', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user: { id, aud: 'authenticated', role: 'authenticated', email: 'ana@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
      if (stalePreferences) localStorage.setItem('tc-leonaris-preferences:' + id, JSON.stringify({ hidden: true, muted: true }));
    }
  }, { ids, stalePreferences: !!options.stalePreferences });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    let sub = ids.A;
    try { sub = JSON.parse(Buffer.from(request.headers().authorization.split('.')[1], 'base64url').toString()).sub; } catch {}
    const key = sub === ids.B ? 'B' : 'A', owner = state[key];
    if (url.origin !== origin) {
      if (url.hostname === 'example.supabase.co') {
        const user = { id: sub, aud: 'authenticated', role: 'authenticated', email: `${owner.name}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname === '/auth/v1/user' ? user : []) });
      }
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/cliente/activity/ping') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (request.method() !== 'GET' && url.pathname !== '/api/cliente/leo') {
      transactions.push(request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"QA forbids transactions"}' });
    }
    let json = { ok: true, data: [] }, status = 200;
    const wallet = { effective_rank: 'diamante', minutes_free: 193, minutes_normal: 40, coins: 1200, oracle_credits: 4, spins: { total: 0 } };
    if (url.pathname === '/api/cliente/leo') {
      if (state.unavailable) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"La memoria no está disponible en este momento."}' });
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); state.posts.push({ owner: key, ...body });
        if (body.action === 'preference') { for (const field of ['hidden', 'muted']) if (typeof body[field] === 'boolean') owner.profile[field] = body[field]; if (typeof body.memoryEnabled === 'boolean') owner.memoryEnabled = body.memoryEnabled; if (body.style) owner.style = body.style; }
        else if (body.action === 'remember') owner.memories.push({ id: 'explicit-' + owner.memories.length, content: body.content, createdAt: new Date().toISOString() });
        else if (body.action === 'forget') owner.memories = owner.memories.filter(memory => memory.id !== body.memoryId);
        else if (body.action === 'forget_all') { owner.memories = []; owner.visits = owner.helpful = owner.unhelpful = 0; }
        else if (body.action === 'visit' && owner.memoryEnabled) owner.visits++;
        else if (body.action === 'feedback') owner[body.helpful ? 'helpful' : 'unhelpful']++;
        else if (body.action === 'chat') {
          if (state.failChat) { state.failChat = false; status = 429; json = { ok: false, error: 'Espera un momento antes de otra consulta.' }; }
          else {
            const answer = { id: body.requestId, title: `Respuesta para ${owner.name}`, message: `${owner.name}, tienes 233 minutos disponibles. ${owner.memoryEnabled ? owner.memories[0]?.content || '' : 'Memoria desactivada.'}`, actions: [action], mode: 'ai' };
            if (state.holdChat) { state.pending++; await new Promise(resolve => { state.releaseChat = resolve; }); state.pending--; }
            json = { ok: true, answer };
          }
          return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) }).catch(() => {});
        }
      } else state.gets++;
      json = clone(payload(owner));
    } else if (url.pathname === '/api/cliente/me') json = { ok: true, cliente: { id: sub, nombre: owner.name, email: `${owner.name}@example.invalid`, rango_actual: 'diamante', onboarding_completado: true }, wallet, recompensas: [], packs: [], cliente_notificaciones: [], rank_info: { label: 'Diamante', benefits: [] }, rank_progress: { current_label: 'Diamante', progress_percent: 100 }, rank_benefits: { ritual_access: true } };
    else if (url.pathname === '/api/cliente/ruleta') { json = { ok: true, cliente_id: sub, diamond_access: true, catalogue: [], history: [], entitlements: [] }; for (let level = 1; level <= 5; level++) { json[`level_${level}_spins`] = 0; json[`next_spin_${level}`] = null; } }
    else if (url.pathname === '/api/cliente/rangos') json = { ok: true, cliente_id: sub, currency: 'USD', window_days: 30, state: { effective: 'diamante', automatic: 'diamante', total: 200, purchases: 3, has_override: false }, ranks: [], warnings: [] };
    else if (url.pathname === '/api/cliente/state') json = { ok: true, state: wallet };
    else if (url.pathname === '/api/cliente/ritual') json = { ok: true, ritual_access: true, rank: 'diamante', ritual: null, history: [] };
    else if (url.pathname === '/api/cliente/rank-benefits') json = { ok: true, cliente_id: sub, bonuses: [] };
    else if (url.pathname === '/api/cliente/oraculo') json = { ok: true, credits: 4, freeAvailable: true, freeDailyAvailable: true, packs: [], freeState: { remainingSeconds: 0 } };
    else if (url.pathname === '/api/cliente/auth/password/status') json = { ok: true, hasPassword: true };
    else if (url.pathname === '/api/cliente/promotions/active') json = { ok: true, promotion: null };
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  if (context.routeWebSocket) await context.routeWebSocket(/supabase\./, socket => socket.close());
  const page = await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/cliente/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator(character).waitFor({ timeout: 90000 });
  await page.locator(`${character} [data-sheet="v2"]`).waitFor({ timeout: 15000 });
  return { state, context, page,
    open: async () => { if (!await page.locator(panel).isVisible()) await page.locator(character).click(); await page.locator(panel).waitFor(); },
    close: () => context.close(),
    async switchAccount() {
      await page.evaluate(async id => {
        const now = Math.floor(Date.now() / 1000);
        const encode = value => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
        const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: id, session_id: 'session-B', aud: 'authenticated', role: 'authenticated', exp: now + 86400 })}.fake-test-signature`;
        const result = await globalThis.__tcSupabaseClienteBrowserClient.auth.setSession({ access_token: token, refresh_token: 'fake-refresh-B' });
        if (result.error) throw result.error;
      }, ids.B);
    },
  };
}
async function check(name, run) { try { await run();checks.push(name);console.log('PASS: ' + name); } catch (error) { failures.push({ name, error: error.message, stack: error.stack });console.log('FAIL: ' + name + ': ' + error.message); } }
async function shot(page, name) { const file = path.join(output, name + '.png');await page.screenshot({ path: file });return file; }
async function memory(page) { await page.getByRole('button', { name: 'Memoria y preferencias', exact: true }).click();await page.getByRole('heading', { name: 'Lo que recuerdo de ti' }).waitFor(); }

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    await check('The 12-pose atlas loads, uses exact cells and animates blinking and thinking with clean pauses', async () => {
      const f = await fixture(browser);try {
        const sprite=f.page.locator(`${character} [data-sheet="v2"]`);
        await f.page.mouse.move(20,20);await f.page.waitForTimeout(1900);
        assert.equal(await sprite.getAttribute('data-pose'),'idle');
        const details=await sprite.evaluate(async element=>{
          const url=getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1],image=new Image();image.src=url;await image.decode();
          const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          const cell=image.naturalWidth/4,edge=[];
          for(let row=0;row<3;row++)for(let column=0;column<4;column++){let count=0;for(let p=0;p<cell;p++)for(const [x,y] of [[column*cell,row*cell+p],[(column+1)*cell-1,row*cell+p],[column*cell+p,row*cell],[column*cell+p,(row+1)*cell-1]])if(pixels[(y*canvas.width+x)*4+3]>128)count++;edge.push(count);}
          return {width:image.naturalWidth,height:image.naturalHeight,size:getComputedStyle(element).backgroundSize,cell,edge};
        });
        assert.deepEqual(details,{width:1448,height:1086,size:'400% 300%',cell:362,edge:Array(12).fill(0)});
        await shot(f.page,'desktop-leonaris-v2');
        // Record a bounded blink cycle; reduced motion must cancel the timer-driven state.
        await f.page.waitForFunction(selector=>document.querySelector(selector)?.dataset.pose==='blink', `${character} [data-sheet="v2"]`,{timeout:11000});
        await f.page.emulateMedia({reducedMotion:'reduce'});await f.page.waitForTimeout(200);assert.notEqual(await sprite.getAttribute('data-pose'),'blink');
        await f.open();f.state.holdChat=true;await f.page.getByLabel('¿En qué te ayudo?',{exact:true}).fill('Muéstrame mis minutos');await f.page.getByRole('button',{name:'Consultar a Leonaris'}).click();
        await f.page.waitForFunction(selector=>document.querySelector(selector)?.dataset.pose==='thinking', `${character} [data-sheet="v2"]`);
        const thinking=await sprite.evaluate(element=>({position:getComputedStyle(element).backgroundPosition,translate:getComputedStyle(element).translate}));assert.match(thinking.position,/^0(?:px|%) 100%$/);assert.equal(thinking.translate,'0px 9%');
        await shot(f.page,'desktop-leonaris-thinking');f.state.releaseChat?.();await f.page.getByRole('heading',{name:'Respuesta para Ana'}).waitFor();
      }finally{f.state.releaseChat?.();await f.close();}
    });
    await check('Server greeting is quiet, deduplicates within a session and overrides stale local preferences', async () => {
      const f = await fixture(browser, { stalePreferences: true });try {
        await f.page.locator(guide).getByText('Hola, Ana', { exact: true }).waitFor();assert.equal(await f.page.locator(panel).isVisible(), false);
        await f.open();await f.page.getByRole('heading', { name: 'Hola, Ana', exact: true }).waitFor();
        await f.page.reload({ waitUntil: 'domcontentloaded' });await f.page.locator(character).waitFor();await f.page.waitForTimeout(250);
        assert.equal(await f.page.locator(guide).getByText('Hola, Ana', { exact: true }).count(), 0);assert.equal(await f.page.locator(panel).isVisible(), false);
      } finally { await f.close(); }
    });
    await check('Dragging stays inside the viewport, persists, does not open chat and cursor look pauses', async () => {
      const f = await fixture(browser);try {
        const box = await f.page.locator(character).boundingBox();await f.page.mouse.move(box.x + 60, box.y + 60);await f.page.mouse.down();await f.page.mouse.move(220, 270, { steps: 12 });await f.page.mouse.up();
        assert.equal(await f.page.locator(panel).isVisible(), false);const moved = await f.page.locator(character).boundingBox();assert.ok(moved.x < 300 && moved.y < 300);
        await f.page.reload({ waitUntil: 'domcontentloaded' });await f.page.locator(character).waitFor();const restored = await f.page.locator(character).boundingBox();assert.ok(Math.abs(restored.x - moved.x) < 2 && Math.abs(restored.y - moved.y) < 2);
        await f.page.mouse.move(restored.x + restored.width + 90, restored.y + 45);await f.page.waitForTimeout(80);assert.notEqual(await f.page.locator(pet).evaluate(el => el.style.getPropertyValue('--leo-look-turn')), '0deg');
        await f.page.emulateMedia({ reducedMotion: 'reduce' });await f.page.waitForTimeout(80);assert.equal(await f.page.locator(pet).evaluate(el => el.style.getPropertyValue('--leo-look-turn')), '0deg');assert.equal(await f.page.locator(character).evaluate(el => el.getAnimations({ subtree: true }).length), 0);
        await shot(f.page, 'desktop-dragged');
      } finally { await f.close(); }
    });
    await check('Chat shows server errors, retries the same request id, offers guide actions and records feedback', async () => {
      const f = await fixture(browser);try {
        await f.open();f.state.failChat = true;await f.page.getByLabel('¿En qué te ayudo?', { exact: true }).fill('¿Cuántos minutos tengo?');await f.page.getByRole('button', { name: 'Consultar a Leonaris' }).click();await f.page.getByRole('alert').filter({ hasText: 'Espera un momento' }).waitFor();
        await f.page.getByRole('button', { name: 'Consultar a Leonaris' }).click();await f.page.getByRole('heading', { name: 'Respuesta para Ana' }).waitFor();
        const requests = f.state.posts.filter(post => post.action === 'chat');assert.equal(requests.length, 2);assert.equal(requests[0].requestId, requests[1].requestId);
        await f.page.getByRole('button', { name: 'Sí', exact: true }).click();await f.page.getByText('Gracias, tendré en cuenta tu valoración.').waitFor();assert.equal(f.state.A.helpful, 1);
        await f.page.getByRole('button', { name: 'Ver mis minutos', exact: true }).click();await f.page.locator(`${guide}[data-journey="true"]`).waitFor({ state: 'attached' });await f.page.getByRole('button', { name: 'Ya lo tengo', exact: true }).click();
        assert.equal(await f.page.locator(panel).isVisible(), false);assert.equal(transactions.length, 0);
      } finally { await f.close(); }
    });
    await check('Memory explicitly saves, deletes, pauses without claiming empty and clears learned counters', async () => {
      const f = await fixture(browser);try {
        await f.open();await memory(f.page);await f.page.getByText('Prefiero las explicaciones de Ana', { exact: true }).waitFor();
        await f.page.getByLabel('Algo que quieres que recuerde').fill('Prefiero respuestas breves.');await f.page.getByRole('button', { name: 'Guardar este recuerdo' }).click();await f.page.getByText('Prefiero respuestas breves.', { exact: true }).waitFor();assert.equal(f.state.A.memories.length, 2);
        await f.page.getByRole('button', { name: 'Olvidar: Prefiero respuestas breves.', exact: true }).click();await f.page.getByText('Prefiero respuestas breves.', { exact: true }).waitFor({ state: 'detached' });
        await f.page.getByLabel('Activar memoria y personalización').click();await f.page.getByText(/Tus notas están en pausa/).waitFor();assert.equal(await f.page.getByText('Aún no has guardado ningún recuerdo.').count(), 0);assert.equal(f.state.A.memories.length, 1);
        await f.page.getByRole('button', { name: 'Borrar toda mi memoria' }).click();await f.page.getByRole('button', { name: 'Sí, borrar todo' }).click();await f.page.getByRole('button', { name: 'Borrar toda mi memoria' }).waitFor();assert.equal(f.state.A.memories.length, 0);assert.equal(f.state.A.visits, 0);
        await shot(f.page, 'desktop-memory');
      } finally { await f.close(); }
    });
    await check('Unavailable memory is distinguished from an empty profile', async () => {
      const f = await fixture(browser);try {
        await f.open();f.state.unavailable = true;await f.page.getByRole('button', { name: 'Actualizar información de Leonaris' }).click();await f.page.waitForTimeout(350);await memory(f.page);
        await f.page.getByText(/Esto no significa que tus recuerdos se hayan borrado/).waitFor();assert.equal(await f.page.getByText('Aún no has guardado ningún recuerdo.').count(), 0);
        assert.equal(await f.page.getByLabel('Activar memoria y personalización').count(), 0);
      } finally { await f.close(); }
    });
    await check('Purchase events display only fresh server-confirmed greetings and never auto-open the panel', async () => {
      const f = await fixture(browser);try {
        await f.open();await f.page.getByRole('button', { name: 'Cerrar ayuda', exact: true }).click();
        f.state.A.greeting = { id: 'purchase-verified-1', title: 'Tu compra está confirmada', message: 'Tus minutos ya aparecen en tu cuenta.', actions: [action] };
        await f.page.evaluate(() => window.dispatchEvent(new CustomEvent('tc-leo-celestial-event', { detail: { id: 'fake-browser-claim', reaction: 'purchase', title: 'Has ganado 999999', message: 'Texto no verificado' } })));
        await f.page.getByText('Tu compra está confirmada', { exact: true }).waitFor();assert.equal(await f.page.getByText('Has ganado 999999').count(), 0);assert.equal(await f.page.locator(panel).isVisible(), false);
        await f.open();await f.page.getByRole('button', { name: 'Cerrar ayuda', exact: true }).click();
        await f.page.evaluate(() => window.dispatchEvent(new Event('tc-client-balances-changed')));await f.page.waitForTimeout(350);assert.equal(await f.page.getByText('Tu compra está confirmada', { exact: true }).count(), 0);
      } finally { await f.close(); }
    });
    await check('A delayed response from account A never appears after switching to account B', async () => {
      const f = await fixture(browser);try {
        await f.open();f.state.holdChat = true;await f.page.getByLabel('¿En qué te ayudo?', { exact: true }).fill('Consulta privada de Ana');await f.page.getByRole('button', { name: 'Consultar a Leonaris' }).click();
        await f.page.waitForFunction(() => document.querySelector('#leonaris-question')?.disabled);while (!f.state.releaseChat) await f.page.waitForTimeout(20);
        await f.switchAccount();await f.page.getByText('Hola, Bea', { exact: true }).waitFor();assert.equal(await f.page.locator(panel).isVisible(), false);f.state.releaseChat();await f.page.waitForTimeout(250);
        await f.open();await memory(f.page);await f.page.getByText('Prefiero las explicaciones de Bea', { exact: true }).waitFor();assert.equal(await f.page.locator(guide).getByText(/Ana/).count(), 0);
        await f.page.getByRole('button', { name: 'Volver a la conversación' }).click();assert.equal(await f.page.getByLabel('¿En qué te ayudo?', { exact: true }).inputValue(), '');assert.equal(await f.page.getByRole('heading', { name: 'Respuesta para Ana' }).count(), 0);
      } finally { f.state.releaseChat?.();await f.close(); }
    });
    await check('Mobile touch dragging, readable controls and memory layout fit 320 px', async () => {
      const f = await fixture(browser, { mobile: true });try {
        await f.page.waitForTimeout(1900);await shot(f.page,'mobile-leonaris-v2');
        const session = await f.context.newCDPSession(f.page), box = await f.page.locator(character).boundingBox();
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 45, y: box.y + 45 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 55, y: 250 }] });await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });await f.page.waitForTimeout(100);
        assert.equal(await f.page.locator(panel).isVisible(), false);const moved = await f.page.locator(character).boundingBox();assert.ok(moved.x >= 8 && moved.x < 50 && moved.y < 300);
        await f.page.waitForTimeout(650);await f.open();await memory(f.page);
        const metrics = await f.page.locator(panel).evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, scroll: el.scrollWidth, width: el.clientWidth, text: [...el.querySelectorAll('p')].map(p => parseFloat(getComputedStyle(p).fontSize)), buttons: [...el.querySelectorAll('button')].filter(button => button.offsetParent).map(button => button.getBoundingClientRect().height) }));
        assert.ok(metrics.left >= 0 && metrics.right <= 320 && metrics.scroll <= metrics.width + 1, JSON.stringify(metrics));assert.ok(metrics.text.every(size => size >= 14));assert.ok(metrics.buttons.every(height => height >= 44));
        await shot(f.page, 'mobile-memory');
      } finally { await f.close(); }
    });
  } finally { await browser.close(); }
  const report = { ok: !failures.length && !errors.length && !transactions.length, checks, failures, errors, transactions };
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));console.log(JSON.stringify(report, null, 2));if (!report.ok) process.exitCode = 1;
})().catch(error => { console.error(error);process.exitCode = 1; });
