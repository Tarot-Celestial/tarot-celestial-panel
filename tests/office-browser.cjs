/** Local browser → real Next handlers → synthetic Auth/PostgREST → migrated PostgreSQL (PGlite). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startAccountingQA, WORKER_ID } = require('./accounting-qa-server.cjs');
const { extraRPC, setupDatabase, panelFixtureResponse } = require('./office-preview.cjs');

async function main() {
  const output = process.env.OFFICE_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'oficina-celestial-'));
  fs.mkdirSync(output, { recursive: true });
  const qa = await startAccountingQA({appPort: 3068, dbPort: 54348, extraRPC, setupDatabase});
  let browser, page;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1040 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
    await context.addInitScript(({ token, user }) => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-fixture', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user }));
    }, { token: qa.token, user: qa.user });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
      if (url.origin !== qa.appOrigin || !url.pathname.startsWith('/api/') || /^\/api\/admin\/(oficina|contabilidad)(\/|$)/.test(url.pathname)) return route.continue();
      const body = panelFixtureResponse(url.pathname, qa) || { ok: true, rows: [], data: [], items: [], messages: [], workers: [], calls: [], unread: 0 };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    const button = name => page.getByRole('button', { name, exact: true });
    const nav = name => page.getByRole('navigation', { name: 'Vistas de Oficina' }).getByRole('button', { name });
    const request = (url, method = 'get', authorized = true) => page.request[method](qa.appOrigin + url, { headers: authorized ? { Authorization: 'Bearer ' + qa.token } : {} });
    const api = async () => { const result = await request('/api/admin/oficina'); assert.equal(result.status(), 200); return result.json(); };
    const ready = () => nav('Organigrama').waitFor({ timeout: 100000 });
    await page.goto(qa.appOrigin + '/admin/contabilidad', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await button('Oficina Celestial').waitFor({ timeout: 90000 });
    const neighbor = await button('Contabilidad').evaluate(el => el.nextElementSibling?.getAttribute('aria-label'));
    assert.equal(neighbor, 'Oficina Celestial');
    await button('Oficina Celestial').click();
    await ready();
    assert.equal((await api()).departments.length, 15);
    await page.locator('img[src="/office/plano-celestial.webp"]').evaluate(el => el.decode());
    await page.screenshot({ path: path.join(output, '01-plano-escritorio.png'), fullPage: true });
    await button('Sala de Marketing').click();
    const inspector = page.getByRole('complementary', { name: 'Ficha de departamento' });
    await inspector.getByLabel('Responsable del departamento').selectOption(WORKER_ID);
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/admin/oficina') && r.request().method() === 'GET'),
      inspector.getByRole('button', { name: 'Guardar responsable' }).click(),
    ]);
    await nav('Organigrama').click();
    await page.screenshot({ path: path.join(output, '02-organigrama.png'), fullPage: true });
    await inspector.getByRole('button', { name: 'Ver encargos' }).click();
    await button('Nuevo encargo').click();
    await page.getByLabel('Objetivo', { exact: true }).fill('Preparar campaña de prueba');
    await page.getByLabel('Responsable', { exact: true }).selectOption('atlas');
    await page.getByLabel('Prioridad', { exact: true }).selectOption('alta');
    await page.getByLabel('Plazo', { exact: true }).fill('2027-01-12T10:15');
    await page.getByLabel('Entrega esperada', { exact: true }).fill('Un borrador interno revisable');
    await button('Guardar encargo').click();
    await button('Editar encargo').waitFor();
    await button('Editar encargo').click();
    await page.getByLabel('Estado', { exact: true }).selectOption('en_curso');
    await button('Guardar encargo').click();
    await page.getByLabel('Nota de coordinación').fill('Contrastar el texto con el catálogo.');
    await button('Añadir nota').click();
    await page.getByText('Contrastar el texto con el catálogo.', { exact: true }).first().waitFor();
    await button('Añadir entregable').click();
    await page.getByLabel('Título', { exact: true }).fill('Texto para revisión');
    await page.getByLabel('Contenido de esta versión').fill('Primer borrador.');
    await page.getByLabel('Archivo de esta versión').setInputFiles({ name: 'borrador.txt', mimeType: 'text/plain', buffer: Buffer.from('Primer borrador.') });
    await button('Guardar versión').click();
    await button('Nueva versión').waitFor();
    await nav('Revisiones').click();
    await page.getByLabel('Decisión', { exact: true }).selectOption('cambios');
    await page.getByLabel('Comentario', { exact: true }).fill('Corregir el cierre.');
    await button('Guardar decisión').click();
    await page.getByText('No hay entregas pendientes de revisión').waitFor();
    await nav('Encargos').click();
    await button('Nueva versión').click();
    await page.getByLabel('Contenido de esta versión').fill('Texto con cierre revisado.');
    await button('Guardar versión').click();
    await button('Nueva versión').waitFor();
    await nav('Revisiones').click();
    await button('Guardar decisión').click();
    await page.getByText('No hay entregas pendientes de revisión').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    const data = await api();
    assert.equal(data.tasks[0].status, 'en_curso');
    assert.equal(new Date(data.tasks[0].due_at).toISOString(), '2027-01-12T09:15:00.000Z');
    assert.equal(data.tasks[0].time_zone, 'Europe/Madrid');
    assert.equal(data.departments.find(d => d.id === 'marketing').lead_worker_id, WORKER_ID);
    assert.equal(data.versions.length, 2);
    assert.equal(data.versions.find(v => v.version === 2).status, 'aprobado');
    const first = data.versions.find(v => v.version === 1);
    assert.equal(first.status, 'cambios');
    assert(data.events.some(e => e.note.includes('Contrastar')));
    const filePath = '/api/admin/oficina/archivo?id=' + first.id;
    assert.equal(await (await request(filePath)).text(), 'Primer borrador.');
    assert.equal((await request(filePath, 'get', false)).status(), 401);
    assert.equal((await request('/api/admin/oficina', 'post', false)).status(), 401);
    assert.equal((await request('/api/admin/oficina', 'get', false)).status(), 401);
    await nav('Encargos').click();
    await page.getByLabel('Prioridad', { exact: true }).selectOption('baja');
    assert.equal(await button('Editar encargo').count(), 0);
    await page.getByLabel('Prioridad', { exact: true }).selectOption('alta');
    await button('Editar encargo').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await nav('Plano').click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, '03-plano-movil.png'), fullPage: true });
    const mobileRooms = page.locator('[aria-label="Departamentos del plano"]');
    await mobileRooms.getByRole('button', { name: /Finanzas/ }).click();
    await inspector.getByRole('heading', { name: 'Finanzas' }).waitFor();
    await button('Cerebro Celestial').click();
    await page.waitForURL('**/admin/cerebro');
    await button('Contabilidad').click();
    await page.getByLabel('Contraseña de contabilidad').waitFor();
    await qa.db.exec('reset role; update public.test_admins set active=false; set role service_role;');
    for (const [url, method] of [['/api/admin/oficina', 'get'], ['/api/admin/oficina', 'post'], [filePath, 'get']]) {
      assert.equal((await request(url, method)).status(), 403);
    }
    await page.goto(qa.appOrigin + '/admin/oficina', { waitUntil: 'domcontentloaded' });
    await page.getByText('Tu sesión ya no tiene acceso a la Oficina.').waitFor();
    assert.equal(await nav('Encargos').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: navegación, 15 departamentos, responsable, encargos, filtros, nota, dos versiones, archivo, revisiones, recarga, móvil, 401 y 403. Capturas: ' + output);
  } catch (error) {
    if (page) {
      console.error('Última pantalla local:', page.url(), (await page.locator('main').innerText({timeout: 2000}).catch(() => '')).slice(-1600));
      await page.screenshot({ path: path.join(output, 'fallo-local.png'), timeout: 4000 }).catch(() => {});
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await qa.close();
  }
}

main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
