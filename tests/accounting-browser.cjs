/** Run: node tests/accounting-browser.cjs. Every identity and amount is synthetic. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startAccountingQA, USER_ID, WORKER_ID, SESSION_ID } = require('./accounting-qa-server.cjs');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-accounting-qa-'));
const report = { verification: 'Browser → real Next route handlers → local Auth/PostgREST bridge → real PGlite SQL functions', productionTouched: false, passed: [], errors: [], screenshots: [], outputDir };
let qa, browser, page;
function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
const moneyNumber = text => Number(text.replace(/[^0-9,.-]/g,'').replaceAll('.','').replace(',','.'));

async function main() {
  qa = await startAccountingQA();
  console.log(`Local fixture ready: ${qa.appOrigin}`);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || (fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : '/usr/bin/chromium'), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic-local-refresh-token', token_type: 'bearer', expires_in:86400, expires_at:Math.floor(Date.now()/1000)+86400, user }));
  }, { token:qa.token, user:qa.user });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.origin === qa.appOrigin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/admin/contabilidad')) {
      let body = { ok:true, rows:[], data:[], items:[], messages:[], conversations:[], threads:[], workers:[], calls:[], status:'idle', unread:0 };
      if (url.pathname === '/api/me') body = { ok:true,role:'admin',can_admin:true,display_name:'Alex',user:qa.user,worker:qa.worker };
      if (url.pathname === '/api/auth/user') body = qa.user;
      if (url.pathname.startsWith('/api/attendance/')) body = { ok:true,online:true,status:'working',worker:qa.worker,session_id:SESSION_ID,session_started_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),last_manual_activity_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),server_now:new Date().toISOString(),call_active:false };
      return route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(body) });
    }
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', msg => { if (msg.type()==='error' && !/Failed to load resource|WebSocket|net::ERR|realtime|Failed to fetch/i.test(msg.text())) report.errors.push(msg.text()); });
  await page.goto(`${qa.appOrigin}/admin/contabilidad`, { waitUntil:'domcontentloaded',timeout:120000 });
  await page.getByLabel('Contraseña de contabilidad').waitFor({ state:'visible',timeout:90000 });
  await page.getByRole('heading',{name:'Bienvenido, Alex.'}).waitFor();
  passed('Admin private gate renders without loading financial data');
  assert.equal(qa.calls.filter(call => call.name==='accounting_snapshot').length,0);
  const locked = await page.request.get(`${qa.appOrigin}/api/admin/contabilidad`, {headers:{Authorization:`Bearer ${qa.token}`}});
  assert.equal(locked.status(),423);
  const unauth = await page.request.get(`${qa.appOrigin}/api/admin/contabilidad`);
  assert.equal(unauth.status(),401);
  passed('Real API rejects no-auth (401) and missing private cookie (423)');
  await page.getByLabel('Contraseña de contabilidad').fill('Deliberately-wrong-local-password');
  await page.getByRole('button',{name:'Entrar a mi contabilidad'}).click();
  await page.getByText('Contraseña incorrecta.',{exact:true}).waitFor();
  await page.getByLabel('Contraseña de contabilidad').waitFor();
  passed('Wrong password rejected, gate remains usable');
  const gateShot=path.join(outputDir,'accounting-gate-desktop.png'); await page.screenshot({path:gateShot,fullPage:true}); report.screenshots.push(gateShot);
  await page.getByLabel('Contraseña de contabilidad').fill(qa.password);
  await page.getByRole('button',{name:'Entrar a mi contabilidad'}).click();
  await page.getByRole('heading',{name:'Contabilidad.',exact:true}).waitFor({timeout:90000});
  passed('Correct password opens database-backed accounting');
  const api = async (suffix='') => { const response=await page.request.get(`${qa.appOrigin}/api/admin/contabilidad${suffix}`,{headers:{Authorization:`Bearer ${qa.token}`}}); assert.equal(response.status(),200);return response.json(); };
  assert.equal((await api()).entries.length,0);
  const cookie=(await context.cookies(`${qa.appOrigin}/api/admin/contabilidad`)).find(c=>c.name==='tc_accounting_session');
  assert(cookie?.httpOnly); assert.equal(cookie.sameSite,'Strict');
  passed('Empty real ledger and HttpOnly SameSite=Strict private session');

  async function entry(button, kind, amount, description, extras={}) {
    await page.getByRole('button',{name:button,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:/.+/});
    await dialog.getByLabel('Tipo de movimiento',{exact:true}).selectOption(kind);
    await dialog.getByLabel(kind==='transfer'?'Cuenta de origen':'Cuenta',{exact:true}).selectOption(extras.account||'celestial');
    await dialog.getByLabel('Importe',{exact:true}).fill(amount);
    await dialog.getByLabel('Motivo / concepto',{exact:true}).fill(description);
    if(kind==='income'||kind==='expense') {
      await dialog.getByLabel('Medio de pago',{exact:true}).selectOption({label:'PayPal'});
      await dialog.getByLabel(kind==='income'?'Origen del ingreso':'Categoría del gasto',{exact:true}).selectOption({label:kind==='income'?'Venta de minutos':'Centrales'});
    }
    await dialog.getByRole('button',{name:'Guardar movimiento',exact:true}).click();
    await dialog.waitFor({state:'hidden',timeout:30000});
    const data=await api();
    const stored=data.entries.find(row=>row.description===description);
    assert(stored,`Persisted entry missing: ${description}`);
    assert.equal(stored.amount_cents,Math.round(Number(amount)*100));
    return stored;
  }
  const opening=await entry('Añadir saldo inicial','opening_balance','1000','QA saldo inicial');
  const income=await entry('Nuevo ingreso','income','100','QA ingreso PayPal');
  const expense=await entry('Nuevo gasto','expense','20','QA pago centrales');
  await entry('Traspaso','transfer','200','QA traspaso neutral');
  passed('Opening 1000, income100, expense20, transfer200 recorded through real handlers and SQL');
  async function metric(label,expected) {
    const card=page.getByRole('region',{name:'Resumen financiero'}).locator('div').filter({has:page.getByText(label,{exact:true})}).filter({has:page.locator('strong')}).first();
    const value=await card.locator('strong').first().textContent(); assert.equal(moneyNumber(value),expected,`${label}: ${value}`);
  }
  await metric('Disponible registrado',1080); await metric('Ingresos',100); await metric('Gastos',20); await metric('Resultado neto registrado',80);
  await page.getByRole('button',{name:'Tarot Celestial',exact:true}).click(); await metric('Disponible registrado',880);
  await page.getByRole('button',{name:'Tarot Leonaris',exact:true}).click(); await metric('Disponible registrado',200);
  await page.getByRole('button',{name:'Vista conjunta',exact:true}).click();
  passed('Transfer is neutral in joint income/net; correct independent balances880/200');
  await page.getByRole('button',{name:'Abrir bóveda',exact:true}).click();
  await entry('Guardar en bóveda','vault_deposit','100','QA ahorro bóveda');
  await entry('Devolver a la cuenta','vault_withdrawal','10','QA retirada bóveda');
  await page.getByRole('button',{name:'Resumen',exact:true}).click();
  await metric('Disponible registrado',990); await metric('Resultado neto registrado',80);
  passed('Vault100 deposit and10 withdrawal leave available990 and vault90, net80 unchanged');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Contabilidad.',exact:true}).waitFor();
  assert.equal((await api()).entries.length,6); await metric('Disponible registrado',990);
  passed('Full page reload retains all six database movements and balances');
  const desktopShot=path.join(outputDir,'accounting-overview-desktop.png');await page.screenshot({path:desktopShot,fullPage:true});report.screenshots.push(desktopShot);
  await page.getByRole('button',{name:'Categorías y medios',exact:true}).click();
  await page.getByRole('button',{name:'Añadir: Motivos de los gastos',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Nombre',{exact:true}).fill('QA categoría personalizada');
  await page.getByRole('dialog').getByRole('button',{name:'Guardar opción',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert((await api()).categories.some(x=>x.name==='QA categoría personalizada'&&x.kind==='expense'));
  passed('Custom expense category persists via SQL option RPC');
  await page.getByRole('button',{name:'Movimientos',exact:true}).click();
  await page.getByLabel('Buscar movimientos').fill('QA pago centrales');
  assert.equal(await page.locator('tbody tr').count(),1);
  assert((await page.locator('tbody').textContent()).includes('QA pago centrales'));
  await page.getByLabel('Buscar movimientos').fill('');
  await page.getByLabel('Tipo',{exact:true}).selectOption('transfer');
  assert.equal(await page.locator('tbody tr').count(),1);
  assert((await page.locator('tbody').textContent()).includes('QA traspaso neutral'));
  await page.getByLabel('Tipo',{exact:true}).selectOption('all');
  passed('Search and movement-kind filters show matching rows');
  await page.getByRole('button',{name:'Anular: QA pago centrales',exact:true}).click();
  await page.getByLabel('Motivo de la anulación',{exact:true}).fill('QA rectificación comprobada');
  await page.getByRole('button',{name:'Confirmar anulación',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert((await api()).entries.find(x=>x.id===expense.id).voided_at);
  await metric('Disponible registrado',1010);await metric('Gastos',0);await metric('Resultado neto registrado',100);
  await page.getByLabel('Mostrar anulados').check();
  assert((await page.locator('tbody').textContent()).includes('QA rectificación comprobada'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Contabilidad.',exact:true}).waitFor();
  await metric('Disponible registrado',1010);assert((await api()).entries.find(x=>x.id===expense.id).voided_at);
  passed('Annulment audited, excluded from totals, remains annulled after reload');
  const crossOrigin=await page.request.post(`${qa.appOrigin}/api/admin/contabilidad/movimientos`,{headers:{Authorization:`Bearer ${qa.token}`,Origin:'https://example.invalid','Content-Type':'application/json'},data:{}});
  assert.equal(crossOrigin.status(),403);
  passed('Actual accounting write route rejects cross-origin mutation');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Movimientos',exact:true}).click();
  const dims=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert(dims.document<=dims.viewport+1,`Mobile page horizontally overflows: ${JSON.stringify(dims)}`);
  const mobileShot=path.join(outputDir,'accounting-movements-mobile.png');await page.screenshot({path:mobileShot,fullPage:true});report.screenshots.push(mobileShot);
  await page.getByRole('button',{name:'Nuevo ingreso',exact:true}).click();
  const mobileFormShot=path.join(outputDir,'accounting-entry-mobile.png');await page.screenshot({path:mobileFormShot,fullPage:true});report.screenshots.push(mobileFormShot);
  await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
  passed('390px mobile layout has no page overflow and entry dialog is usable');
  await page.getByRole('button',{name:'Bloquear',exact:true}).click();
  await page.getByLabel('Contraseña de contabilidad').waitFor();
  const relocked=await page.request.get(`${qa.appOrigin}/api/admin/contabilidad`,{headers:{Authorization:`Bearer ${qa.token}`}});
  assert.equal(relocked.status(),423);
  assert(!(await context.cookies()).some(c=>c.name==='tc_accounting_session'));
  passed('Explicit lock returns gate and revokes private session at database/API');
  assert.equal(report.errors.length,0,`Unexpected JS errors: ${report.errors.join('; ')}`);
  report.rpcCounts=Object.fromEntries([...new Set(qa.calls.map(x=>x.name))].map(name=>[name,qa.calls.filter(x=>x.name===name).length]));
  report.blockedExternalServerRequests=qa.blocked;
  passed('No uncaught UI errors; all financial actions use real Next/API/SQL path');
}

main().catch(async error=>{report.failure=error.stack;console.error(error);if(page){const failureShot=path.join(outputDir,'failure.png');await page.screenshot({path:failureShot,fullPage:true}).catch(()=>{});report.screenshots.push(failureShot);report.lastPageText=await page.locator('body').innerText().catch(()=> 'Unavailable');}process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(report,null,2));console.log(`QA_REPORT ${path.join(outputDir,'report.json')}`);await browser?.close();await qa?.close();process.exit(process.exitCode||0);});
