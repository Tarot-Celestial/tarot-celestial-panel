// Fixture-only UI checks: no real accounts, purchases, or database writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(text).join('');
const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const buyer = { id: '00000000-0000-4000-8000-000000000001', nombre: 'Compradora', prioridad_gasto_total: 125.5, prioridad_compras: 5, prioridad_ultima_actividad_at: '2026-11-15T09:15:00Z', minutos_free_pendientes: 4, minutos_normales_pendientes: 20 };
const lead = { id: '00000000-0000-4000-8000-000000000002', nombre: 'Contactada', prioridad_gasto_total: 0, prioridad_compras: 0, prioridad_ultima_actividad_at: '2026-11-15T10:00:00Z', minutos_free_pendientes: 7, minutos_normales_pendientes: 0 };
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/crm/CRMClientesPanel.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function mount(mode) {
  const h = { rows: [buyer, lead], pagination: {}, requests: [], pending: null };
  const noop = () => {}, blank = () => null;
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) }, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: noop };
  const fetch = async (url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET');
    h.requests.push(url);
    if (url.startsWith('/api/crm/clientes/buscar')) {
      if (h.pending) { const result = h.pending; h.pending = null; return result; }
      return response({ ok: true, clientes: h.rows, ...h.pagination });
    }
    return response({ ok: true, etiquetas: [{ id: 'nov', nombre: 'Noviembre 2026' }, { id: 'oct', nombre: 'Octubre 2026' }], tarotistas: [], leads: [], pagos: [], notas: [], summary: {} });
  };
  const searchParams = new URLSearchParams();
  const deps = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-dom': { createPortal: child => child },
    'next/navigation': { useRouter: () => ({ replace: noop }), useSearchParams: () => searchParams },
    '@/lib/supabase-browser': { supabaseBrowser: () => sb },
    '@/components/ui/KpiCard': { default: blank },
    '@/components/crm/RegistrarLlamadaModal': { default: blank }, '@/components/crm/ClienteSidebar': { default: blank },
    '@/components/crm/ClienteTimeline': { default: blank }, '@/components/crm/PayPalCrmPaymentModal': { default: blank },
    '@/components/crm/PurchaseBenefitReceipt': { default: blank },
    '@/components/global/BrandSwitcher': { getActiveBrand: () => 'celestial' },
    'lucide-react': new Proxy({}, { get: () => blank }), '@/lib/tc-toast': { tcToast: noop },
    '@/hooks/useRouletteSignal': { useRouletteSignal: noop }, '@/lib/background-fetch': { backgroundFetch: fetch },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, require: name => name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => key }) } : name in deps ? deps[name] : (() => { throw Error('Unexpected import ' + name); })(),
    fetch, URLSearchParams, console, setTimeout: () => 1, clearTimeout: noop,
    window: { addEventListener: noop, removeEventListener: noop, setInterval: () => 1, clearInterval: noop, location: {}, scrollTo: noop },
    document: { visibilityState: 'visible', body: {} }, sessionStorage: { getItem: () => null },
  });
  await renderer.act(async () => { h.tree = renderer.create(React.createElement(exports.default, { mode })); });
  h.button = label => h.tree.root.findAllByType('button').find(node => text(node) === label);
  h.selectTag = value => renderer.act(async () => {
    h.tree.root.findAllByType('select').find(node => node.findAllByType('option').some(option => option.props.value === 'Noviembre 2026')).props.onChange({ target: { value } });
  });
  h.search = () => h.button('Cargar CRM').props.onClick();
  h.names = () => h.tree.root.findAllByType('tr').filter(node => node.findAllByType('td').length).map(node => text(node.findAllByType('td')[0].findByType('b')));
  h.allText = () => text(h.tree.toJSON());
  h.close = () => renderer.act(async () => h.tree.unmount());
  return h;
}

for (const mode of ['admin', 'central']) test(`${mode} displays purchase priority only for the loaded tag and preserves minute cells`, async () => {
  const h = await mount(mode);
  assert.doesNotMatch(h.allText(), /Orden: mayor gasto|125,50|Sin compras confirmadas/);
  await h.selectTag('Noviembre 2026');
  assert.doesNotMatch(h.allText(), /Orden: mayor gasto/);
  await renderer.act(async () => { await h.search(); });
  assert.match(h.allText(), /Orden: mayor gasto · más compras · actividad reciente/);
  assert.match(h.allText().replace(/\s/g, ' '), /125,50 € · 5 compras/);
  assert.match(h.allText(), /Sin compras confirmadas/);
  assert.match(h.allText(), /Última actividad: 15\/11\/2026, 10:15/);
  const cells = h.tree.root.findAllByType('tr')[1].findAllByType('td');
  assert.deepEqual(cells.slice(6, 8).map(text), ['4', '20']);
  assert.deepEqual(h.names(), ['Compradora', 'Contactada']);
  await h.close();
});

test('loading more keeps server order and the original tag after the draft filter changes', async () => {
  const h = await mount('central');
  await h.selectTag('Noviembre 2026');
  h.rows = [buyer]; h.pagination = { has_more: true, next_cursor: 'priority-cursor-fixture' };
  await renderer.act(async () => { await h.search(); });
  await h.selectTag('Octubre 2026');
  h.rows = [lead]; h.pagination = { has_more: false, next_cursor: null };
  await renderer.act(async () => { await h.button('Cargar más clientes').props.onClick(); });
  const last = new URL(h.requests.filter(url => url.startsWith('/api/crm/clientes/buscar')).at(-1), 'https://fixture.invalid');
  assert.equal(last.searchParams.get('etiqueta'), 'Noviembre 2026');
  assert.equal(last.searchParams.get('cursor'), 'priority-cursor-fixture');
  assert.deepEqual(h.names(), ['Compradora', 'Contactada']);
  const indicator = h.tree.root.findAll(node => node.props.className === 'priorityTag');
  assert.equal(text(indicator[0]), 'Noviembre 2026');
  await h.close();
});

test('missing metrics remain unavailable rather than displayed as zero spend or no purchases', async () => {
  const h = await mount('admin');
  h.rows = [{ ...buyer, prioridad_gasto_total: undefined, prioridad_compras: undefined }];
  await h.selectTag('Noviembre 2026');
  await renderer.act(async () => { await h.search(); });
  assert.doesNotMatch(h.allText(), /125,50|Sin compras confirmadas|Última actividad:/);
  await renderer.act(async () => { h.button('Limpiar filtros').props.onClick(); });
  assert.doesNotMatch(h.allText(), /Orden: mayor gasto/);
  await h.close();
});

test('spending uses the registered total in euros as confirmed by the owner, without exchange conversion', async () => {
  const h = await mount('admin');
  h.rows = [{ ...buyer, prioridad_gasto_total: 325.5, prioridad_gasto_por_moneda: { USD: 200, EUR: 125.5 } }];
  await h.selectTag('Noviembre 2026');
  await renderer.act(async () => { await h.search(); });
  const rendered = h.allText().replace(/\s/g, ' ');
  assert.match(rendered, /325,50 € · 5 compras/);
  assert.doesNotMatch(rendered, /125,50 EUR|200,00 USD/);
  await h.close();
});
