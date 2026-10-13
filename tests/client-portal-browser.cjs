// Local-only UI integration QA. Fake session; all APIs and external hosts intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const baseURL = process.env.TC_PORTAL_QA_URL || 'http://127.0.0.1:3020';
const origin = new URL(baseURL).origin;
const smokeOnly = process.env.TC_PORTAL_QA_MODE === 'route-smoke';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
const output = process.env.TC_PORTAL_QA_OUTPUT || path.resolve(__dirname, '../../outputs/astral-cards-qa');
const checks = [], failures = [], errors = [], consoleErrors = [], screenshots = [], blocked = new Set(), calls = new Set(), imageFailures = [], metrics = {};
fs.mkdirSync(output, { recursive: true });
const customerId = '00000000-0000-4000-8000-000000000001';
const wallet = { effective_rank: 'diamante', minutes_free: 193, minutes_normal: 40, coins: 1200, oracle_credits: 4, spins: { total: 0 }, refreshed_at: new Date().toISOString() };
const client = { id: customerId, nombre: 'Cliente', apellido: 'de prueba', email: 'cliente@example.invalid', rango_actual: 'diamante', puntos: 1200, minutos_free_pendientes: 193, minutos_normales_pendientes: 40, onboarding_completado: true };
const roulette = { ok: true, cliente_id: customerId, available_spins: 0, next_level: 1, level_2_from: 27, level_3_from: 49, diamond_access: true, campaign: null, catalogue: [], history: [], entitlements: [] };
for (let i = 1; i <= 5; i++) { roulette[`level_${i}_spins`] = 0; roulette[`next_spin_${i}`] = null; }
function apiData(name, fixture) {
  if (name === '/api/cliente/me') return { ok: true, cliente: client, wallet, recompensas: [{ id: 'fake-reward', nombre: 'Recompensa de prueba', puntos_coste: 100, minutos_otorgados: 5 }], packs: [], cliente_notificaciones: [], rank_info: { label: 'Diamante', benefits: ['Consulta tus ventajas en Rangos', 'Un espacio celestial para explorar'] }, rank_progress: { current_label: 'Diamante', progress_percent: 100 }, rank_benefits: { ritual_access: fixture.ritualAccess } };
  if (name === '/api/cliente/ritual') return { ok: true, ritual_access: fixture.ritualAccess, rank: 'diamante', ritual: null, history: [] };
  if (name === '/api/cliente/state') return { ok: true, state: wallet };
  if (name === '/api/cliente/ruleta') return roulette;
  if (name === '/api/cliente/oraculo') return { ok: true, credits: 4, freeAvailable: true, freeDailyAvailable: true, packs: [], freeState: { remainingSeconds: 0 } };
  if (name === '/api/cliente/leo') return { ok: true, profile: { hidden: false, muted: true }, facts: { coins: 1200, minutes: 233, oracleCredits: 4, activePromotion: null } };
  if (name === '/api/cliente/rangos') return { ok: true, cliente_id: customerId, currency: 'USD', window_days: 30, refreshed_at: new Date().toISOString(), state: { effective: 'diamante', automatic: 'diamante', total: 200, purchases: 3, has_override: false, override_ends_at: null }, ranks: [['bronce', 'Bronce', .01], ['plata', 'Plata', 50], ['oro', 'Oro', 100], ['diamante', 'Diamante', 200]].map(([key, label, min_spend]) => ({ key, label, min_spend, active: true, benefits: ['Ventaja de prueba'], package_benefits: [] })), daily_bonus: null, daily_bonus_available: true, warnings: [] };
  if (name === '/api/cliente/rank-benefits') return { ok: true, cliente_id: customerId, bonuses: [] };
  if (name === '/api/cliente/auth/password/status') return { ok: true, hasPassword: true };
  if (name === '/api/cliente/promotions/active') return { ok: true, promotion: null };
  if (name === '/api/cliente/notificaciones') return { ok: true, unread_count: 0, data: [] };
  return { ok: true, data: [] };
}
async function contextFor(browser, options, fixture = { ritualAccess: true }) {
  const context = await browser.newContext({ serviceWorkers: 'block', ...options });
  await context.addInitScript(({ customerId }) => {
    const now = Math.floor(Date.now() / 1000);
    const token = `${btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: customerId, aud: 'authenticated', role: 'authenticated', exp: now + 86400 }))}.fake-test-signature`;
    localStorage.setItem('sb-example-auth-token-cliente', JSON.stringify({ access_token: token, refresh_token: 'fake-refresh-token', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user: { id: customerId, aud: 'authenticated', role: 'authenticated', email: 'cliente@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { customerId });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (!url.pathname.startsWith('/api/')) return route.continue();
      calls.add(`${route.request().method()} ${url.pathname}`);
      if (/canjear|checkout|confirmar-compra|comprar/.test(url.pathname)) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"ok":false,"error":"QA forbids transactions"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiData(url.pathname, fixture)) });
    }
    blocked.add(url.hostname);
    if (url.hostname === 'example.supabase.co') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.abort('blockedbyclient');
  });
  if (context.routeWebSocket) await context.routeWebSocket(/supabase\./, socket => socket.close());
  return context;
}
async function pageFor(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && decodeURIComponent(response.url()).includes('/images/portal/')) imageFailures.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${baseURL}/cliente/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('[data-client-home="portal"]').waitFor({ timeout: 90000 });
  await page.locator('#saldo-minutes strong').filter({ hasText: '233' }).waitFor();
  await page.locator('[data-experience-art="oracle"][data-art-status="ready"]').waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('[data-client-home] img[alt="Tarot Celestial"]'); return image?.complete && image.naturalWidth > 0; });
  await page.locator('[data-client-home] img[alt="Tarot Celestial"]').evaluate(image => image.decode());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return page;
}
async function capture(page, name) {
  const file = path.join(output, `portal-${name}.png`);
  await page.screenshot({ path: file }); screenshots.push(file);
  console.log(`Screenshot ready: ${file}`);
}
async function check(name, fn) {
  if (smokeOnly && !name.startsWith('Route smoke:')) return;
  try { await fn(); checks.push(name); console.log(`PASS: ${name}`); }
  catch (error) { failures.push({ name, message: error.message, stack: error.stack }); console.log(`FAIL: ${name}: ${error.message}`); }
}
async function healthyPage(page, operation) {
  let onError;
  const failure = new Promise((_, reject) => { onError = error => reject(new Error(`Browser runtime error: ${error.message}`)); page.once('pageerror', onError); });
  try { return await Promise.race([operation(), failure]); }
  finally { page.off('pageerror', onError); }
}
const rail = '[data-experience-rail]', viewport = '[data-experience-viewport]', cards = '[data-experience-card]';
async function overflow(page) {
  const value = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(value.html <= value.width + 1 && value.body <= value.width + 1, JSON.stringify(value)); return value;
}
async function showRail(page) { await page.locator(rail).scrollIntoViewIfNeeded(); await page.waitForTimeout(200); }
async function railStart(page) { await page.locator(viewport).evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' })); await page.waitForTimeout(250); }
async function railMetrics(page) {
  return page.locator(viewport).evaluate(el => ({ left: el.scrollLeft, width: el.clientWidth, scrollWidth: el.scrollWidth, cards: [...el.querySelectorAll('[data-experience-card]')].map(card => ({ id: card.dataset.experienceCard, running: card.dataset.running, width: card.getBoundingClientRect().width, animations: card.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSAnimation).map(animation => ({ name: animation.animationName, state: animation.playState, time: Number(animation.currentTime) })) })) }));
}
async function worldAnimations(page) {
 return page.locator('[data-celestial-portal]').evaluate(element => element.getAnimations({subtree:true}).filter(a => a instanceof CSSAnimation).map(a => ({name:a.animationName,state:a.playState,time:Number(a.currentTime)})));
}
async function frozenWorld(page) {
 const before=await worldAnimations(page);await page.waitForTimeout(350);const after=await worldAnimations(page);
 assert.equal(after.length,before.length);
 after.forEach((a,i)=>{assert.notEqual(a.state,'running');assert.ok(Math.abs(a.time-before[i].time)<30, a.name+' kept running');});
 return after;
}
async function frozen(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('[data-experience-card]')].every(el => el.dataset.running === 'false'));
  await page.waitForTimeout(200); const before = await railMetrics(page); await page.waitForTimeout(350); const after = await railMetrics(page);
  for (let i = 0; i < after.cards.length; i++) after.cards[i].animations.forEach((animation, j) => {
    assert.notEqual(animation.state, 'running'); assert.ok(Math.abs(animation.time - before.cards[i].animations[j].time) < 30, JSON.stringify({ card: after.cards[i].id, before: before.cards[i].animations[j], after: animation }));
  }); return after;
}

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.EDGE_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const desktop = await contextFor(browser, { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await pageFor(desktop); await capture(page, 'desktop');
    const mobile = await contextFor(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const phone = await pageFor(mobile); await capture(phone, 'mobile');
    await check('Desktop and mobile preserve real balances and prevent body overflow', async () => {
      for (const [key, p] of [['desktop', page], ['mobile', phone]]) {
        assert.equal((await p.locator('#saldo-minutes strong').innerText()).replace(/\D/g, ''), '233');
        assert.match(await p.locator('#saldo-minutes p').innerText(), /193(?: min)? gratis[\s\S]*40(?: min)? normales/);
        assert.equal((await p.locator('#saldo-coins strong').innerText()).replace(/\D/g, ''), '1200');
        metrics[key] = { overflow: await overflow(p), logo: await p.locator('[data-client-home] img[alt="Tarot Celestial"]').evaluate(image => ({ complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, currentSrc: image.currentSrc })) };
      }
    });
    await check('Grouped navigation exposes every expected destination, Escape returns focus and outside click closes', async () => {
      const nav = page.getByRole('navigation', { name: 'Secciones del panel de cliente' });
      for (const [label, id, paths] of [
        ['Consultar', 'consultar', ['tarotistas', 'precios-ofertas']],
        ['Mi camino', 'camino', ['rangos', 'ritual']],
        ['Experiencias', 'experiencias', ['oraculo', 'ruleta', 'sorteo']],
        ['Mi cuenta', 'cuenta', ['perfil', 'notificaciones', 'resenas']],
      ]) {
        const button = nav.getByRole('button', { name: label, exact: true }); await button.click();
        assert.equal(await button.getAttribute('aria-expanded'), 'true');
        for (const target of paths) assert.ok(await nav.locator(`#client-nav-${id} a[href="/cliente/${target}"]`).isVisible());
        await page.keyboard.press('Escape'); assert.equal(await button.getAttribute('aria-expanded'), 'false'); assert.ok(await button.evaluate(el => el === document.activeElement));
      }
      const trigger = nav.getByRole('button', { name: 'Consultar', exact: true }); await trigger.click(); await page.locator('#celestial-welcome').click(); assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    });
    await check('Rail contains six real destinations, loaded artwork and accessible arrows with real end states', async () => {
      await showRail(page); await railStart(page); await capture(page, 'desktop-rail');
      assert.deepEqual(await page.locator(cards).evaluateAll(els => els.map(el => el.dataset.experienceCard)), ['oracle', 'ritual', 'benefits', 'raffle', 'roulette', 'readers']);
      const prev = page.getByRole('button', { name: 'Ver experiencias anteriores' }); const next = page.getByRole('button', { name: 'Ver experiencias siguientes' });
      assert.ok(await prev.isDisabled()); assert.ok(await next.isEnabled());
      for (let i = 0; i < 8 && await next.isEnabled(); i++) { await next.click(); await page.waitForTimeout(600); }
      await page.waitForFunction(() => document.querySelectorAll('[data-experience-art][data-art-status="ready"]').length === 6);
      assert.ok(await next.isDisabled()); assert.ok(await prev.isEnabled());
      const end = await railMetrics(page); assert.ok(end.left > 0); assert.ok(end.scrollWidth - end.width - end.left < 3);
      await prev.click(); await page.waitForTimeout(600); assert.ok((await railMetrics(page)).left < end.left);
      await railStart(page); metrics.desktop.rail = await railMetrics(page);
      const size = await prev.boundingBox(); assert.ok(size.width >= 44 && size.height >= 44);
    });
    await check('Mouse drag scrolls the rail without activating a card link', async () => {
      await showRail(page); await railStart(page); const box = await page.locator('[data-experience-card="oracle"]').boundingBox(); const before = page.url();
      await page.mouse.move(box.x + box.width * .8, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 15, box.y + 100, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(500);
      assert.equal(page.url(), before); assert.ok((await railMetrics(page)).left > 50); await railStart(page);
      await page.locator('[data-experience-card="oracle"]').focus(); assert.ok(await page.locator('[data-experience-card="oracle"]').evaluate(el => el === document.activeElement));
      metrics.desktop.afterDrag = await railMetrics(page);
    });
    await check('Large arrows stay beside cards and leave their text and artwork clear', async () => {
      for(const p of [page,phone]) {
        await showRail(p); await railStart(p);
        const area=await p.locator(viewport).boundingBox();
        const left=await p.getByRole('button',{name:'Ver experiencias anteriores'}).boundingBox();
        const right=await p.getByRole('button',{name:'Ver experiencias siguientes'}).boundingBox();
        const minimum=p===page?64:48;
        assert.ok(left.width>=minimum&&left.height>=minimum);
        assert.ok(right.width>=minimum&&right.height>=minimum);
        const borderAllowance=p===page?2:26;
        assert.ok(left.x+left.width<=area.x+borderAllowance, 'Previous arrow intrudes beyond the card edge');
        assert.ok(right.x>=area.x+area.width-borderAllowance, 'Next arrow intrudes beyond the card edge');
        assert.ok(left.x>=0 && right.x+right.width<=p.viewportSize().width+1,'Arrow is clipped by screen');
        const art=await p.locator('[data-experience-card="oracle"] [data-experience-portal]').boundingBox();
        const targetY=p===page?area.y+area.height/2:art.y+art.height/2;
        assert.ok(Math.abs(left.y+left.height/2-targetY)<32, 'Arrow must align with the card or its artwork');
        await overflow(p);
      }
    });
    await check('Isolated objects float on clean cards and all six artworks load', async () => {
      await showRail(page); await railStart(page);
      const object=page.locator('[data-experience-card="oracle"] [data-experience-float]');
      await page.waitForFunction(()=>document.querySelector('[data-experience-card="oracle"]')?.dataset.running==='true');
      const before=await object.evaluate(el=>getComputedStyle(el).transform);
      await page.waitForTimeout(650);
      const after=await object.evaluate(el=>getComputedStyle(el).transform);
      assert.notEqual(before,after,'Object should float independently');
      for(const id of ['oracle','ritual','benefits','raffle','roulette','readers']){
        const item=page.locator('[data-experience-card="'+id+'"]');
        await item.scrollIntoViewIfNeeded();
        await item.locator('[data-art-status="ready"]').waitFor();
        const img=item.locator('[data-experience-float] img');
        assert.ok(await img.evaluate(el=>el.complete&&el.naturalWidth>0));
        assert.ok((await img.getAttribute('src')).includes('objects'));
      }
      await railStart(page); await capture(page,'desktop-clean-cards');await capture(phone,'mobile-clean-cards');
    });
    await check('Small phones keep titles and side controls readable at 320px', async () => {
      await phone.setViewportSize({width:320,height:844});await showRail(phone);await railStart(phone);
      await overflow(phone);
      const item=phone.locator('[data-experience-card="oracle"]');
      const cardBox=await item.boundingBox(), title=await item.locator('h3').boundingBox();
      const float=await item.locator('[data-experience-float]').boundingBox();
      assert.ok(title.x>=cardBox.x&&title.x+title.width<=cardBox.x+cardBox.width+1);
      assert.ok(title.y>=float.y+float.height-8,'Title overlaps object');
      assert.ok((await item.innerText()).includes('Explorar'));
      await capture(phone,'mobile-320-clean-cards');
      await phone.setViewportSize({width:390,height:844});await showRail(phone);
    });
    await check('Astral cards retain readable text sizes and strong contrast on desktop and small phones', async () => {
      for (const [name,p,width] of [['desktop',page,1440],['mobile',phone,390],['small-phone',phone,320]]) {
        await p.setViewportSize({width,height:name==='desktop'?1000:844});await showRail(p);await railStart(p);
        const readings=await p.evaluate(() => {
          const color=value=>{const n=value.match(/[\d.]+/g).map(Number);return [...n.slice(0,3),n.length>3?n[3]:1];};
          const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          return [...document.querySelectorAll('[data-experience-content]')].map(content=>{
            const bg=color(getComputedStyle(content).backgroundColor);
            // White behind translucent content is the conservative case for light lettering.
            const painted=bg.slice(0,3).map(v=>v*bg[3]+255*(1-bg[3]));
            const samples=[['[data-experience-detail]',14],['p',16],['[data-experience-action]',15]].map(([selector,min])=>{
              const el=content.querySelector(selector),style=getComputedStyle(el),fg=color(style.color),l1=luminance(fg),l2=luminance(painted);
              return {text:el.textContent,size:parseFloat(style.fontSize),min,contrast:(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)};
            });
            return {id:content.closest('[data-experience-card]').dataset.experienceCard,samples};
          });
        });
        assert.equal(readings.length,6);
        for(const card of readings) for(const sample of card.samples){assert.ok(sample.size>=sample.min,`${name} ${card.id}: ${sample.size}px`);assert.ok(sample.contrast>=4.5,`${name} ${card.id}: contrast ${sample.contrast}`);}
        for(const selector of ['#saldo-minutes p','#saldo-minutes a','#saldo-coins p']) assert.ok(await p.locator(selector).evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=14),`${name} ${selector} is too small`);
        assert.equal(await p.locator('[data-experience-portal]').count(),6);
        metrics['readability-'+name]=readings;await overflow(p);
      }
      await phone.setViewportSize({width:390,height:844});
    });
    await check('Doubling the text size preserves card content and all wallet values', async () => {
      for(const p of [page,phone]) {
        const handles=await p.locator('[data-client-home] h1,[data-client-home] h2,[data-client-home] h3,[data-client-home] p,[data-client-home] a,[data-client-home] button,[data-client-home] small,[data-client-home] strong,[data-client-home] span').elementHandles();
        const originals=await p.evaluate(elements=>elements.map(el=>({style:el.getAttribute('style'),font:parseFloat(getComputedStyle(el).fontSize)})),handles);
        try {
          await p.evaluate(({elements,originals})=>elements.forEach((el,i)=>el.style.setProperty('font-size',(originals[i].font*2)+'px','important')),{elements:handles,originals});
          await showRail(p);await railStart(p);await overflow(p);
          const clipping=await p.locator(cards).evaluateAll(elements=>elements.map(card=>{
            const box=card.getBoundingClientRect(),content=card.querySelector('[data-experience-content]');
            return {id:card.dataset.experienceCard,height:box.height,clipped:[...content.children].some(el=>{const r=el.getBoundingClientRect();return r.bottom>box.bottom+1||r.right>box.right+1||r.left<box.left-1||el.scrollWidth>el.clientWidth+1;})};
          }));
          assert.ok(clipping.every(card=>!card.clipped),JSON.stringify(clipping));
          assert.match(await p.locator('#saldo-minutes').innerText(),/193[\s\S]*40/);
          await capture(p,p===page?'desktop-text-200':'mobile-text-200');
        } finally {
          await p.evaluate(({elements,originals})=>elements.forEach((el,i)=>{if(originals[i].style===null)el.removeAttribute('style');else el.setAttribute('style',originals[i].style);}),{elements:handles,originals});
        }
      }
    });
    await check('Waterfalls and cloud layers animate while sharing the scenery plane', async () => {
      assert.ok(await page.locator('[data-portal-waterfall]').count()>=2);
      assert.ok(await page.locator('[data-portal-cloud]').count()>=2);
      assert.ok(await page.locator('[data-portal-scene] [data-portal-waterfall]').count()>=2);
      const moving=await worldAnimations(page);
      await page.waitForTimeout(400);const moved=await worldAnimations(page);
      assert.ok(moved.some((a,i)=>a.state==='running'&&a.time>moving[i].time+100));
      metrics.scenery={waterfalls:await page.locator('[data-portal-waterfall]').count(),clouds:await page.locator('[data-portal-cloud]').count(),animations:moved.length};
    });
    await check('Manual pause freezes rail particles and resume restores visible-card animation', async () => {
      await showRail(page); await page.waitForFunction(() => [...document.querySelectorAll('[data-experience-card]')].some(el => el.dataset.running === 'true'));
      await page.getByRole('button', { name: 'Pausar universo', exact: true }).click();
      assert.equal(await page.locator('[data-celestial-portal]').getAttribute('data-motion'), 'paused'); metrics.paused = await frozen(page); metrics.pausedWorld=await frozenWorld(page);
      await page.getByRole('button', { name: 'Reanudar universo', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-experience-card]')].some(el => el.dataset.running === 'true'));
      assert.ok((await railMetrics(page)).cards.some(card => card.running === 'true' && card.animations.some(animation => animation.state === 'running')));
    });
    await check('Offscreen cards stop animation and document visibility pauses the portal', async () => {
      if (await page.getByRole('button', { name: 'Reanudar universo', exact: true }).count()) await page.getByRole('button', { name: 'Reanudar universo', exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 500 }); await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(350); metrics.offscreen = await frozen(page);
      await showRail(page);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => document.querySelector('[data-celestial-portal]')?.dataset.motion === 'paused'); await frozen(page);
      await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => document.querySelector('[data-celestial-portal]')?.dataset.motion === 'running'); await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await check('Mobile native swipe scrolls the rail without navigating and preserves page width', async () => {
      await showRail(phone); await railStart(phone); await capture(phone, 'mobile-rail');
      const box = await phone.locator('[data-experience-card="oracle"]').boundingBox(); const y = Math.max(100, Math.min(650, box.y + 130)); const before = phone.url();
      const session = await mobile.newCDPSession(phone);
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 310, y }] });
      for (let i = 1; i <= 10; i++) { await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 310 - i * 22, y }] }); await phone.waitForTimeout(16); }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await phone.waitForTimeout(700); await session.detach();
      assert.equal(phone.url(), before); metrics.mobile.rail = await railMetrics(phone); assert.ok(metrics.mobile.rail.left > 100); await overflow(phone);
    });
    await check('Existing reward confirmation opens and cancels without submitting a redemption', async () => {
      const redeem = page.locator('#canjear-coins').getByRole('button', { name: 'Canjear', exact: true }); await redeem.click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor(); await capture(page, 'redeem-dialog');
      assert.match(await dialog.innerText(), /100/); await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      assert.ok(![...calls].some(call => /canjear|checkout|confirmar-compra|comprar/.test(call)));
    });
    const reduced = await contextFor(browser, { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); const still = await pageFor(reduced);
    await check('Reduced motion presents a static portal, no motion control and no moving card particles', async () => {
      assert.equal(await still.locator('[data-celestial-portal]').getAttribute('data-motion'), 'paused'); assert.equal(await still.getByRole('button', { name: /Pausar universo|Reanudar universo/ }).count(), 0);
      await showRail(still); metrics.reduced = await frozen(still); await frozenWorld(still); await overflow(still); await capture(still, 'reduced');
    });
    const locked = await contextFor(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { ritualAccess: false }); const withoutRitual = await pageFor(locked);
    await check('No ritual access removes ritual cards and menu entries while retaining other experiences', async () => {
      assert.equal(await withoutRitual.locator('[data-experience-card="ritual"]').count(), 0); assert.equal(await withoutRitual.locator(cards).count(), 5);
      assert.ok(await withoutRitual.getByRole('link', { name: /Descubrir mis beneficios/ }).isVisible());
      const nav = withoutRitual.getByRole('navigation', { name: 'Secciones del panel de cliente' }); await nav.getByRole('button', { name: 'Mi camino', exact: true }).click();
      assert.equal(await nav.locator('a[href="/cliente/ritual"]').count(), 0); assert.ok(await nav.locator('a[href="/cliente/rangos"]').isVisible());
      await withoutRitual.keyboard.press('Escape'); await overflow(withoutRitual); await capture(withoutRitual, 'without-ritual');
    });
    await check('Route smoke: home to Rangos to Ruleta to home replaces the portal and retains one universe canvas between subpages', () => healthyPage(page, async () => {
      await page.evaluate(() => scrollTo(0, 0));
      const nav = page.getByRole('navigation', { name: 'Secciones del panel de cliente' });
      assert.equal(await page.locator('[data-celestial-universe]').count(), 0);
      await nav.getByRole('button', { name: 'Mi camino', exact: true }).click();
      await nav.locator('a[href="/cliente/rangos"]').click();
      await page.waitForURL('**/cliente/rangos', { timeout: 120000 });
      console.log('Route smoke: Rangos navigation reached');
      await page.locator('[data-celestial-universe][data-renderer="webgl"] canvas').waitFor({ timeout: 90000 });
      assert.equal(await page.locator('[data-celestial-portal]').count(), 0);
      const canvas = await page.locator('[data-celestial-universe] canvas').elementHandle();
      await nav.getByRole('button', { name: 'Experiencias', exact: true }).click();
      await nav.locator('a[href="/cliente/ruleta"]').click();
      await page.waitForURL('**/cliente/ruleta', { timeout: 120000 });
      console.log('Route smoke: Ruleta navigation reached');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('[data-celestial-universe] canvas').count(), 1);
      assert.ok(await canvas.evaluate(el => el.isConnected && el === document.querySelector('[data-celestial-universe] canvas')), 'The universe canvas must survive navigation between subpages');
      assert.equal(await page.locator('[data-celestial-portal]').count(), 0);
      await nav.locator('a[href="/cliente/dashboard"]').click();
      await page.waitForURL('**/cliente/dashboard', { timeout: 120000 });
      await page.locator('[data-client-home="portal"]').waitFor();
      await page.locator('[data-celestial-portal][data-motion="running"]').waitFor();
      assert.equal(await page.locator('[data-celestial-universe]').count(), 0);
      assert.equal(await canvas.evaluate(el => el.isConnected), false);
      assert.equal(await page.locator('[data-celestial-portal]').count(), 1);
      assert.equal((await page.locator('#saldo-minutes strong').innerText()).replace(/\D/g, ''), '233');
      await overflow(page); metrics.routeSmoke = { destinations: ['dashboard', 'rangos', 'ruleta', 'dashboard'], retainedCanvas: true, canvasDisposedOnHome: true };
      assert.deepEqual(errors, []); assert.deepEqual(imageFailures, []);
    }));
    await check('No runtime errors or failed portal assets', async () => { assert.deepEqual(errors, []); assert.deepEqual(imageFailures, []); assert.deepEqual(consoleErrors, []); });
  } catch (error) { failures.push({ name: 'Harness setup or unhandled flow', message: error.message, stack: error.stack }); console.error(error.stack); }
  finally { await browser.close(); const reportPath = path.join(output, smokeOnly ? 'portal-route-smoke-results.json' : 'portal-qa-results.json'); const report = { localOnly: true, baseURL, completedAt: new Date().toISOString(), checks, failures, metrics, errors, consoleErrors, imageFailures, screenshots, interceptedApis: [...calls], blockedExternalHosts: [...blocked] }; fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ checks: checks.length, failures: failures.map(({ name, message }) => ({ name, message })), screenshots, report: reportPath }, null, 2)); if (failures.length) process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
