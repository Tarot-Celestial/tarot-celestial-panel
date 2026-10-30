// Actual CRM component, entirely simulated HTTP/auth/realtime. No production records.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const source = fs.readFileSync(path.join(__dirname, '../src/components/crm/CRMClientesPanel.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const clientId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const initial = { id: clientId, nombre: 'Cliente simulada A', apellido: '', rango_actual: 'plata', rango_efectivo: 'plata', rango_automatico: 'plata', rango_intervencion: null, rango_gasto_mes_anterior: 112, rango_compras_mes_anterior: 8, rango_actual_desde: '2026-10-01', rango_actual_hasta: '2026-10-30', minutos_free_pendientes: 10, minutos_normales_pendientes: 20, puntos: 5, updated_at: '2026-10-29T12:00:00Z', free_passes: null };
const canonical = { ...initial, rango_actual: 'bronce', rango_efectivo: 'bronce', rango_automatico: 'bronce', rango_gasto_mes_anterior: 56, rango_compras_mes_anterior: 4 };
const other = { ...initial, id: otherId, nombre: 'Cliente simulada B', rango_actual: 'oro', rango_efectivo: 'oro', rango_automatico: 'oro', rango_gasto_mes_anterior: 700, rango_compras_mes_anterior: 9 };
const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(text).join('');
const row = (tree, name) => tree.root.findAllByType('tr').find(item => item.findAllByType('td').length && text(item.findAllByType('td')[0]) === name);
const card = tree => tree.root.findAllByType('div').find(item => text(item) === '🏅 Rango mensual del cliente').parent.parent.parent;
const minuteField = (tree, label) => tree.root.findAllByProps({ className: 'tc-sub' }).find(item => text(item) === label).parent.findByType('input');
async function open(h, name) {
  const button = row(h.tree, name).findAllByType('button').find(item => text(item) === 'Ver ficha');
  await renderer.act(async () => button.props.onClick());
}
async function mount({ first = initial, second = other } = {}) {
  const h = { requests: [], snapshots: new Map([[first.id, first], [second.id, second]]), pending: null, refresh: null };
  const fetch = async (url, init = {}) => {
    assert.ok(!init.method || init.method === 'GET', 'This regression must never write');
    h.requests.push(url);
    const pathname = new URL(url, 'https://fixture.invalid').pathname;
    if (pathname === '/api/crm/clientes/ficha') {
      const id = new URL(url, 'https://fixture.invalid').searchParams.get('id');
      if (h.pending) { const pending = h.pending; h.pending = null; return pending.promise; }
      return response({ ok: true, cliente: h.snapshots.get(id) });
    }
    if (pathname === '/api/crm/clientes/buscar') return response({ ok: true, clientes: [first, second] });
    if (pathname === '/api/crm/clientes/notas/listar') return response({ ok: true, notas: [{ id: 'fixture-note', texto: 'Nota histórica simulada', created_at: '2026-10-29T10:00:00Z' }] });
    return response({ ok: true, etiquetas: [], tarotistas: [], leads: [], pagos: [], summary: {} });
  };
  const noop = () => {};
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) }, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: noop };
  const searchParams = new URLSearchParams();
  const blank = () => null;
  const imports = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-dom': { createPortal: child => child },
    'next/navigation': { useRouter: () => ({ replace: noop }), useSearchParams: () => searchParams },
    '@/lib/supabase-browser': { supabaseBrowser: () => sb },
    '@/components/ui/KpiCard': { default: blank }, '@/components/crm/RegistrarLlamadaModal': { default: blank },
    '@/components/crm/ClienteSidebar': { default: blank }, '@/components/crm/ClienteTimeline': { default: blank },
    '@/components/crm/PayPalCrmPaymentModal': { default: blank },
    '@/components/global/BrandSwitcher': { getActiveBrand: () => 'celestial' },
    'lucide-react': new Proxy({}, { get: () => blank }), '@/lib/tc-toast': { tcToast: noop },
    '@/hooks/useRouletteSignal': { useRouletteSignal: (_sb, _id, refresh) => { h.refresh = refresh; } },
    '@/lib/background-fetch': { backgroundFetch: fetch },
  };
  const exports = {};
  const window = { addEventListener: noop, removeEventListener: noop, setInterval: () => 1, clearInterval: noop, location: {}, scrollTo: noop };
  vm.runInNewContext(code, { exports, require: name => name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => key }) } : name in imports ? imports[name] : (() => { throw Error('Unexpected import ' + name); })(), fetch, console, window, document: { visibilityState: 'visible', body: {} }, sessionStorage: { getItem: () => null }, URLSearchParams, setTimeout: () => 1, clearTimeout: noop });
  await renderer.act(async () => { h.tree = renderer.create(React.createElement(exports.default, { mode: 'central' })); });
  h.unmount = () => renderer.act(async () => h.tree.unmount());
  return h;
}

test('server rank refresh updates card, badge and list despite unchanged timestamp, preserving minute and note drafts', async () => {
  const h = await mount(); await open(h, initial.nombre);
  assert.match(text(card(h.tree)), /Plata.*112,00.*Compras 30 días8/);
  await renderer.act(async () => {
    minuteField(h.tree, 'Min free pendientes').props.onChange({ target: { value: '99' } });
    minuteField(h.tree, 'Min normales pendientes').props.onChange({ target: { value: '88' } });
    h.tree.root.findByProps({ placeholder: 'Escribe una nueva nota del cliente...' }).props.onChange({ target: { value: 'Borrador todavía sin guardar' } });
  });
  const noteReads = h.requests.filter(url => url.includes('/notas/')).length;
  h.snapshots.set(clientId, { ...canonical, notas: 'Otro texto recibido del servidor' });
  await renderer.act(async () => { assert.equal(await h.refresh(), true); });
  assert.match(text(card(h.tree)), /Bronce.*56,00.*Compras 30 días4/);
  assert.doesNotMatch(text(card(h.tree)), /112,00|Plata/);
  assert.match(text(row(h.tree, initial.nombre).findAllByType('td')[5]), /Bronce/);
  assert.match(text(row(h.tree, other.nombre).findAllByType('td')[5]), /Oro/);
  assert.equal(minuteField(h.tree, 'Min free pendientes').props.value, '99');
  assert.equal(minuteField(h.tree, 'Min normales pendientes').props.value, '88');
  assert.equal(h.tree.root.findByProps({ placeholder: 'Escribe una nueva nota del cliente...' }).props.value, 'Borrador todavía sin guardar');
  assert.match(text(h.tree.toJSON()), /Nota histórica simulada/);
  assert.equal(h.requests.filter(url => url.includes('/notas/')).length, noteReads);
  await h.unmount();
});

test('late rank response for the previously visible client changes neither current card nor result rows', async () => {
  const h = await mount(); await open(h, initial.nombre);
  const pending = deferred(); h.pending = pending;
  let refreshing;
  await renderer.act(async () => { refreshing = h.refresh(); await Promise.resolve(); });
  await open(h, other.nombre);
  await renderer.act(async () => { pending.resolve(response({ ok: true, cliente: canonical })); assert.equal(await refreshing, false); });
  assert.match(text(card(h.tree)), /Oro.*700,00.*Compras 30 días9/);
  assert.match(text(row(h.tree, initial.nombre).findAllByType('td')[5]), /Plata/);
  assert.match(text(row(h.tree, other.nombre).findAllByType('td')[5]), /Oro/);
  await h.unmount();
});

test('a newer refresh wins over an older response for the same client', async () => {
  const h = await mount(); await open(h, initial.nombre);
  const pending = deferred(); h.pending = pending;
  let stale;
  await renderer.act(async () => { stale = h.refresh(); await Promise.resolve(); });
  h.snapshots.set(clientId, canonical);
  await renderer.act(async () => { assert.equal(await h.refresh(), true); });
  await renderer.act(async () => { pending.resolve(response({ ok: true, cliente: initial })); assert.equal(await stale, false); });
  assert.match(text(card(h.tree)), /Bronce.*56,00.*Compras 30 días4/);
  assert.match(text(row(h.tree, initial.nombre).findAllByType('td')[5]), /Bronce/);
  await h.unmount();
});

test('rank refresh clears a removed manual intervention from the result row', async () => {
  const h = await mount({ first: { ...initial, has_manual_override: true, override_type: 'permanent', override_reason: 'Fixture override', rango_intervencion: { id: 'fixture-override', rank: 'plata', intervention_type: 'permanent' } } });
  await open(h, initial.nombre);
  assert.match(text(row(h.tree, initial.nombre).findAllByType('td')[5]), /Admin/);
  h.snapshots.set(clientId, { ...canonical, rango_intervencion: null });
  await renderer.act(async () => { assert.equal(await h.refresh(), true); });
  const rankCell = text(row(h.tree, initial.nombre).findAllByType('td')[5]);
  assert.match(rankCell, /Bronce/); assert.doesNotMatch(rankCell, /Admin|Temporal|Plata/);
  await h.unmount();
});

test('the server effective rank and its manual intervention stay distinct from automatic spend rank', async () => {
  const h = await mount(); await open(h, initial.nombre);
  h.snapshots.set(clientId, { ...canonical, rango_actual: 'plata', rango_efectivo: 'plata', rango_intervencion: { id: 'fixture-override', rank: 'plata', intervention_type: 'permanent', starts_at: '2026-10-29T00:00:00Z', ends_at: null, reason: 'Fixture assignment' } });
  await renderer.act(async () => { assert.equal(await h.refresh(), true); });
  assert.match(text(card(h.tree)), /Plata.*56,00.*Compras 30 días4/);
  const rankCell = row(h.tree, initial.nombre).findAllByType('td')[5];
  assert.match(text(rankCell), /PlataAdmin/);
  assert.match(rankCell.findByProps({ className: 'tc-chip' }).props.title, /Rango efectivo: Plata\nRango automático: Bronce/);
  await h.unmount();
});

test('a mismatched response identity cannot overwrite rank or ordinary balances', async () => {
  const h = await mount(); await open(h, initial.nombre);
  h.snapshots.set(clientId, { ...other, minutos_free_pendientes: 999 });
  await renderer.act(async () => { assert.equal(await h.refresh(), false); });
  assert.match(text(card(h.tree)), /Plata.*112,00/);
  assert.equal(minuteField(h.tree, 'Min free pendientes').props.value, '10');
  await h.unmount();
});
