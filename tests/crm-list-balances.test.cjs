// Regression fixtures only: no production records, sessions, or writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const first = { id, nombre: 'Cliente A', minutos_free_pendientes: 0, minutos_normales_pendientes: 25, deuda_pendiente: 0, rango_actual: 'plata', rango_efectivo: 'plata', updated_at: '2026-11-08T12:00:00Z' };
const second = { ...first, id: otherId, nombre: 'Cliente B', minutos_free_pendientes: 17, minutos_normales_pendientes: 8 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(text).join('');
const row = (tree, name = first.nombre) => tree.root.findAllByType('tr').find(item => item.findAllByType('td').length && text(item.findAllByType('td')[0]) === name);
const minutes = (tree, name) => row(tree, name).findAllByType('td').slice(6, 8).map(text);
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const component = compile('src/components/crm/CRMClientesPanel.tsx');
const searchRoute = compile('src/app/api/crm/clientes/buscar/route.ts');

function apiFixture(role = 'central') {
  const rows = [first, second];
  const tables = { workers: [{ id: 'worker', role }], crm_clientes: rows };
  const admin = { from(table) {
    let projection = '*', selected = tables[table] || [];
    const q = {
      select(value) { projection = value; return q; }, order() { return q; }, limit() { return q; },
      eq() { return q; }, in() { return q; }, lte() { return q; }, or() { return q; }, ilike() { return q; },
      maybeSingle: async () => ({ data: selected[0] || null, error: null }),
      then(resolve, reject) {
        // Supabase only returns requested columns: this reproduces the original omission.
        const fields = projection.split(',').map(x => x.trim());
        return Promise.resolve({ data: selected.map(row => Object.fromEntries(fields.filter(k => k in row).map(k => [k, row[k]]))), error: null }).then(resolve, reject);
      },
    }; return q;
  } };
  const deps = {
    'next/server': { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), init) } },
    '@supabase/supabase-js': { createClient: () => admin },
    '@/lib/server/auth-fast': { getAuthUserFromRequest: () => ({ data: { user: { id: 'test-user' } }, error: null }) },
    '@/lib/server/client-ranks': { calcClientRank: () => 'plata', loadRolling30ClientTotals: async () => new Map(rows.map(r => [r.id, { total: 120, compras: 2 }])) },
    '@/lib/server/client-rank-effective': { normalizeClientRank: x => x || null },
  };
  const exports = {};
  vm.runInNewContext(searchRoute, { exports, require: x => deps[x], Response, URL, console, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } } });
  return exports;
}

for (const role of ['admin', 'central']) test(`${role} search returns the actual minute columns and disables all response/fetch caches`, async () => {
  const api = apiFixture(role);
  const res = await api.GET(new Request('https://fixture.invalid/api/crm/clientes/buscar', { headers: { authorization: 'Bearer fixture' } }));
  const body = await res.json();
  assert.equal(res.status, 200); assert.equal(body.ok, true);
  assert.equal(body.clientes[0].minutos_free_pendientes, 0);
  assert.equal(body.clientes[0].minutos_normales_pendientes, 25);
  assert.equal(body.clientes[1].minutos_free_pendientes, 17);
  assert.equal(body.clientes[1].minutos_normales_pendientes, 8);
  assert.match(res.headers.get('cache-control'), /private.*no-store/);
  assert.equal(api.dynamic, 'force-dynamic'); assert.equal(api.revalidate, 0); assert.equal(api.fetchCache, 'force-no-store');
});

test('search keeps tarotistas out of the staff CRM', async () => {
  const res = await apiFixture('tarotista').GET(new Request('https://fixture.invalid/api/crm/clientes/buscar', { headers: { authorization: 'Bearer fixture' } }));
  assert.equal(res.status, 403); assert.equal((await res.json()).ok, false);
});

async function mount(mode = 'central', initial = first) {
  const h = { list: [initial, second], snapshot: initial, pendingSearch: null, pendingFicha: null, requests: [], success: null, refresh: null, failFicha: false };
  const fetch = async (url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET', 'balance regression must never mutate server data');
    h.requests.push({ url, init });
    const route = new URL(url, 'https://fixture.invalid').pathname;
    if (route === '/api/crm/clientes/buscar') {
      if (h.pendingSearch) { const pending = h.pendingSearch; h.pendingSearch = null; return pending.promise; }
      return response({ ok: true, clientes: h.list });
    }
    if (route === '/api/crm/clientes/ficha') {
      if (h.pendingFicha) { const pending = h.pendingFicha; h.pendingFicha = null; return pending.promise; }
      return response(h.failFicha ? { ok: false, error: 'fixture read failure' } : { ok: true, cliente: h.snapshot });
    }
    return response({ ok: true, etiquetas: [], tarotistas: [], leads: [], pagos: [], notas: [], summary: {} });
  };
  const noop = () => {}, blank = () => null;
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) }, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: noop };
  const searchParams = new URLSearchParams();
  const deps = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-dom': { createPortal: child => child },
    'next/navigation': { useRouter: () => ({ replace: noop }), useSearchParams: () => searchParams },
    '@/lib/supabase-browser': { supabaseBrowser: () => sb },
    '@/components/ui/KpiCard': { default: blank },
    '@/components/crm/RegistrarLlamadaModal': { default: props => { h.success = props.onSuccess; return null; } },
    '@/components/crm/ClienteSidebar': { default: blank }, '@/components/crm/ClienteTimeline': { default: blank },
    '@/components/crm/PayPalCrmPaymentModal': { default: blank }, '@/components/crm/PurchaseBenefitReceipt': { default: blank },
    '@/components/global/BrandSwitcher': { getActiveBrand: () => 'celestial' },
    'lucide-react': new Proxy({}, { get: () => blank }), '@/lib/tc-toast': { tcToast: noop },
    '@/hooks/useRouletteSignal': { useRouletteSignal: (_sb, _id, refresh) => { h.refresh = refresh; } },
    '@/lib/background-fetch': { backgroundFetch: fetch },
  };
  const exports = {};
  vm.runInNewContext(component, {
    exports, require: name => name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => key }) } : name in deps ? deps[name] : (() => { throw Error('Unexpected import ' + name); })(),
    fetch, console: { ...console, error: noop }, URLSearchParams, setTimeout: () => 1, clearTimeout: noop,
    window: { addEventListener: noop, removeEventListener: noop, setInterval: () => 1, clearInterval: noop, location: {}, scrollTo: noop },
    document: { visibilityState: 'visible', body: {} }, sessionStorage: { getItem: () => null },
  });
  await renderer.act(async () => { h.tree = renderer.create(React.createElement(exports.default, { mode })); });
  h.open = () => renderer.act(async () => row(h.tree).findAllByType('button').find(x => text(x) === 'Ver ficha').props.onClick());
  h.search = h.tree.root.findAllByType('button').find(x => text(x) === 'Cargar CRM').props.onClick;
  h.close = () => renderer.act(async () => h.tree.unmount());
  return h;
}

for (const mode of ['admin', 'central']) test(`${mode} displays canonical list balances and a ficha refresh updates only its matching row`, async () => {
  const h = await mount(mode);
  assert.deepEqual(minutes(h.tree), ['0', '25']);
  await h.open();
  h.snapshot = { ...first, minutos_free_pendientes: 7, minutos_normales_pendientes: 19 };
  await renderer.act(async () => { assert.equal(await h.refresh(), true); });
  assert.deepEqual(minutes(h.tree), ['7', '19']);
  assert.deepEqual(minutes(h.tree, second.nombre), ['17', '8']);
  assert.ok(h.requests.filter(x => x.url.includes('/buscar')).every(x => x.init.cache === 'no-store'));
  await h.close();
});

test('missing balance data is displayed as unavailable, never as a fabricated zero', async () => {
  const h = await mount('central', { ...first, minutos_free_pendientes: undefined, minutos_normales_pendientes: null });
  assert.deepEqual(minutes(h.tree), ['—', '—']); await h.close();
});

test('a pending old search cannot overwrite the newer matching ficha balance', async () => {
  const h = await mount(); await h.open();
  const pending = deferred(); h.pendingSearch = pending;
  let search;
  await renderer.act(async () => { search = h.search(); await Promise.resolve(); });
  h.snapshot = { ...first, minutos_free_pendientes: 4, minutos_normales_pendientes: 15 };
  await renderer.act(async () => { await h.refresh(); });
  await renderer.act(async () => { pending.resolve(response({ ok: true, clientes: [first, second] })); await search; });
  assert.deepEqual(minutes(h.tree), ['4', '15']); await h.close();
});

test('a later search wins when two search responses arrive in reverse order', async () => {
  const h = await mount(); const pending = deferred(); h.pendingSearch = pending;
  let oldSearch;
  await renderer.act(async () => { oldSearch = h.search(); await Promise.resolve(); });
  h.list = [{ ...first, minutos_normales_pendientes: 12 }, second];
  await renderer.act(async () => { await h.search(); });
  await renderer.act(async () => { pending.resolve(response({ ok: true, clientes: [first] })); await oldSearch; });
  assert.deepEqual(minutes(h.tree), ['0', '12']);
  assert.ok(row(h.tree, second.nombre)); await h.close();
});

test('a confirmed call updates its result row even when the ficha reload fails', async () => {
  const h = await mount(); await h.open(); h.failFicha = true;
  h.pendingSearch = deferred();
  await renderer.act(async () => { await h.success('Registrada', { clienteId: id, balances: { free_after: 2, normal_after: 11 } }); });
  assert.deepEqual(minutes(h.tree), ['2', '11']); await h.close();
});

test('an old ficha response cannot overwrite a newly confirmed call receipt', async () => {
  const h = await mount(); await h.open();
  const pending = deferred(); h.pendingFicha = pending;
  let oldRefresh;
  await renderer.act(async () => { oldRefresh = h.refresh(); await Promise.resolve(); });
  h.failFicha = true; h.pendingSearch = deferred();
  await renderer.act(async () => { await h.success('Registrada', { clienteId: id, balances: { free_after: 3, normal_after: 9 } }); });
  await renderer.act(async () => {
    pending.resolve(response({ ok: true, cliente: first }));
    assert.equal(await oldRefresh, false);
  });
  assert.deepEqual(minutes(h.tree), ['3', '9']);
  assert.ok(h.tree.root.findAllByType('button').some(x => text(x) === 'Cerrar ficha'), 'ficha stays open');
  await h.close();
});
