const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

// All names, money and activity in this suite are simulated fixtures.
const FIXED_NOW = '2026-10-20T17:00:00Z';
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
  static now() { return Date.parse(FIXED_NOW); }
}
const styles = new Proxy({}, { get: (_, key) => String(key) });
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (Array.isArray(node) ? node : node?.children || []).map(text).join('');
const flush = async fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const submit = { preventDefault() {} };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function evaluate(relative, imports = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in imports ? imports[name] : require(name), Date: FixtureDate, Intl, AbortController, DOMException, Error, console, Map, Set, URL, Blob, ...globals });
  return exports;
}
const shared = evaluate('src/lib/central-statistics.ts');
const metric = shared.metric;

function worker(id, display_name, overrides = {}) {
  return {
    id, display_name, role: 'central', is_active: true,
    metrics: Object.fromEntries(shared.CENTRAL_METRICS.map(key => [key, metric(0, 0)])),
    hours: { worked_minutes: 120, ordinary_minutes: 90, outside_schedule_minutes: 30, break_minutes: null, previous_worked_minutes: null, coverage_start: '2026-10-15T12:00:00Z', unclassified_minutes: 0, pending_weekend_days: [], extra_amount: null, adjustment_minutes: 0, estimate_only: true },
    xp: { total: 300, level: 2, progress_percent: 50, next_level_xp: 600 },
    config: { version_id: 'v1', effective_from: '2026-10-15T12:00:00Z', timezone: 'America/Guayaquil', monthly_salary_eur: 400, overtime_hourly_rate_eur: null, weekday_start: '15:00', weekday_end: '23:00', weekend_start: '09:00', weekend_end: '15:00' },
    weekend_days: [], coverage: ['Datos simulados para pruebas.'], day_breakdown: [], adjustments: [], ...overrides,
  };
}
function data(month = '2026-10') {
  const maria = worker('maria-fixture', 'María Simulada');
  maria.metrics.captures_confirmed = metric(3, 0);
  maria.metrics.payments_count = metric(2, 1);
  maria.metrics.payments_amount = metric(40, 10);
  const ana = worker('ana-fixture', 'Ana Simulada', { xp: { total: 2000, level: 6, progress_percent: 70, next_level_xp: 2500 } });
  ana.metrics.captures_confirmed = metric(8, 4);
  return {
    ok: true, month, timezone: 'America/Guayaquil',
    period: { current_start: `${month}-01T05:00:00Z`, current_end: `${month}-20T17:00:00Z`, previous_start: '2026-09-01T05:00:00Z', previous_end: '2026-09-20T17:00:00Z', is_partial: true, label: 'Periodo simulado actual', previous_label: 'Periodo simulado anterior' },
    workers: [worker('admin-fixture', 'Admin Simulado', { role: 'admin' }), maria, ana],
    totals: { payments_amount: 40, payments_count: 2, web_payments_amount: 12, web_payments_count: 1, unattributed_payments_amount: 0, unattributed_payments_count: 0 },
    coverage: ['Datos simulados para pruebas.'], templates: { morning: { start: '07:00', end: '15:00', timezone: 'America/Guayaquil', assigned: false } },
  };
}
const button = (view, label) => view.root.findAllByType('button').find(b => text(b) === label);
const form = (view, buttonLabel) => view.root.findAllByType('form').find(f => f.findAllByType('button').some(b => text(b) === buttonLabel));
const field = (formNode, label) => formNode.findAllByType('label').find(l => text(l) === label).findByType('input');
const card = (view, label) => view.root.findAllByType('article').find(a => a.findAllByType('span').some(s => s.props.className === 'metricLabel' && text(s) === label));

async function setup(t, options = {}) {
  const state = { posts: [], reads: [], saves: [], refreshes: 0, uuidCount: 0, ...options };
  const payload = options.payload || data();
  const timers = new Map(); let nextTimer = 0;
  const window = { setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; } };
  const modules = evaluate('src/components/admin/CentralStatisticsPanel.tsx', {
    '@/lib/central-statistics': shared,
    '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-only' } } }) } }) },
    './CentralStatisticsPanel.module.css': { default: styles },
  }, {
    window, clearTimeout: id => timers.delete(id), crypto: { randomUUID: () => `operation-${++state.uuidCount}` },
    fetch: async (url, init) => {
      const month = new URL(url, 'https://fixture.invalid').searchParams.get('month');
      if (init.method === 'POST') { const body = JSON.parse(init.body); state.posts.push(body); return state.post ? state.post(body, month) : response({ ok: true }); }
      state.reads.push({ month, signal: init.signal });
      return state.read ? state.read(month) : response({ ...payload, month });
    },
  });
  let view;
  const props = { data: payload, onRefresh: () => state.refreshes++, onSave: async action => { state.saves.push(action); if (state.save) await state.save(action); } };
  await act(async () => { view = create(React.createElement(options.wrapper ? modules.default : modules.CentralStatisticsView, options.wrapper ? { month: payload.month } : props)); });
  t.after(() => act(() => view.unmount()));
  const click = async label => { const found = button(view, label); assert.ok(found, `Button ${label} exists`); await flush(() => found.props.onClick()); };
  const select = async name => { const found = view.root.findAllByType('button').find(b => b.props.className === 'personButton' && text(b).includes(name)); assert.ok(found); await flush(() => found.props.onClick()); };
  const update = async next => flush(() => view.update(React.createElement(options.wrapper ? modules.default : modules.CentralStatisticsView, options.wrapper ? { month: next.month } : { ...props, data: next })));
  return { view, state, payload, click, select, update, timers };
}

test('defaults to an active central, selecting a person changes metrics and XP without modifying assignments', async t => {
  const f = await setup(t);
  assert.equal(text(card(f.view, 'Captaciones confirmadas').findByType('strong')), '3');
  assert.ok(text(f.view.toJSON()).includes('Nivel 2'));
  await f.select('Ana Simulada');
  assert.equal(text(card(f.view, 'Captaciones confirmadas').findByType('strong')), '8');
  assert.ok(text(f.view.toJSON()).includes('Nivel 6'));
  assert.equal(f.state.saves.length, 0);
  assert.equal(f.view.root.findAllByProps({ className: 'personButton', 'aria-pressed': true }).length, 1);
});

test('unknown metrics and true zero remain distinguishable and a zero comparison never renders Infinity', async t => {
  const payload = data();
  payload.workers[1].metrics.captures_confirmed = metric(null, 2);
  payload.workers[1].metrics.recoveries = metric(0, 0);
  payload.workers[1].metrics.xp_earned = metric(3, 0);
  const f = await setup(t, { payload });
  assert.equal(text(card(f.view, 'Captaciones confirmadas').findByType('strong')), 'Sin registro');
  assert.ok(text(card(f.view, 'Captaciones confirmadas')).includes('Sin base comparable'));
  assert.equal(text(card(f.view, 'Recuperaciones').findByType('strong')), '0');
  assert.ok(text(card(f.view, 'Recuperaciones')).includes('Sin cambio'));
  assert.ok(text(card(f.view, 'XP ganado en el periodo')).includes('+3 · sin base %'));
  assert.doesNotMatch(text(f.view.toJSON()), /Infinity|NaN/);
});

test('progress, hours and settings switch independently while preserving the selected person', async t => {
  const f = await setup(t);
  await f.select('Ana Simulada');
  await f.click('Jornada y extras');
  assert.equal(card(f.view, 'Captaciones confirmadas'), undefined);
  assert.ok(text(f.view.toJSON()).includes('Jornada por día'));
  assert.ok(text(f.view.toJSON()).includes('Por revisar'));
  await f.click('Horario y revisión');
  assert.ok(text(f.view.toJSON()).includes('Horario de Ana Simulada'));
  assert.equal(f.view.root.findAllByType('form').length, 3);
  await f.click('Progreso');
  assert.equal(text(card(f.view, 'Captaciones confirmadas').findByType('strong')), '8');
  await f.click('Actualizar');
  assert.equal(f.state.refreshes, 1);
});

test('weekend choices are mutually exclusive within a week, do not affect other weeks, and save only future days', async t => {
  const payload = data(); payload.workers[1].weekend_days = ['2026-10-03'];
  const f = await setup(t, { payload }); await f.click('Horario y revisión');
  const weekends = () => form(f.view, 'Guardar próximos fines de semana');
  const checkbox = label => weekends().findAllByType('label').find(l => text(l) === label).findByType('input');
  assert.equal(checkbox('sábado 3 · cerrado').props.disabled, true);
  await flush(() => checkbox('sábado 24').props.onChange({ target: { checked: true } }));
  assert.equal(checkbox('sábado 24').props.checked, true);
  await flush(() => checkbox('domingo 25').props.onChange({ target: { checked: true } }));
  assert.equal(checkbox('sábado 24').props.checked, false);
  assert.equal(checkbox('domingo 25').props.checked, true);
  await flush(() => checkbox('sábado 31').props.onChange({ target: { checked: true } }));
  assert.equal(checkbox('domingo 25').props.checked, true);
  await flush(() => weekends().props.onSubmit(submit));
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.saves[0])), { action: 'weekends', month: '2026-10', days: ['2026-10-25', '2026-10-31'], worker_id: 'maria-fixture' });
});

test('the planning month preserves local choices but submits only the month being edited', async t => {
  const payload = data(); payload.workers[1].weekend_days = ['2026-10-24', '2026-11-15'];
  const f = await setup(t, { payload }); await f.click('Horario y revisión');
  const month = () => f.view.root.findByProps({ type: 'month' });
  const weekends = () => form(f.view, 'Guardar próximos fines de semana');
  const checkbox = label => weekends().findAllByType('label').find(l => text(l) === label).findByType('input');
  assert.equal(month().props.min, '2026-10'); assert.equal(month().props.max, '2027-10');
  await flush(() => month().props.onChange({ target: { value: '2026-11' } }));
  assert.equal(checkbox('domingo 15').props.checked, true);
  await flush(() => checkbox('sábado 7').props.onChange({ target: { checked: true } }));
  await flush(() => month().props.onChange({ target: { value: '2026-10' } }));
  assert.equal(checkbox('sábado 24').props.checked, true);
  await flush(() => month().props.onChange({ target: { value: '2026-11' } }));
  assert.equal(checkbox('sábado 7').props.checked, true);
  await flush(() => weekends().props.onSubmit(submit));
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.saves[0])), { action: 'weekends', month: '2026-11', days: ['2026-11-15', '2026-11-07'], worker_id: 'maria-fixture' });
  await flush(() => month().props.onChange({ target: { value: '2026-10' } }));
  assert.equal(checkbox('sábado 24').props.checked, true);
});

test('loading the morning schedule is a draft until saved and an empty overtime tariff remains null', async t => {
  const f = await setup(t); await f.click('Horario y revisión');
  await f.click('Cargar horario de mañana · 07:00–15:00');
  const settings = () => form(f.view, 'Guardar nueva versión del horario');
  assert.equal(field(settings(), 'Lunes a viernes · entrada').props.value, '07:00');
  assert.equal(field(settings(), 'Lunes a viernes · salida').props.value, '15:00');
  assert.equal(f.state.saves.length, 0);
  await flush(() => settings().props.onSubmit(submit));
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.saves[0])), { action: 'settings', monthly_salary_eur: 400, overtime_hourly_rate_eur: null, weekday_start: '07:00', weekday_end: '15:00', weekend_start: '09:00', weekend_end: '15:00', worker_id: 'maria-fixture' });
});

test('a settings failure stays visible and changing person resets the draft to that person', async t => {
  const f = await setup(t, { save: async () => { throw new Error('No se guardó el horario simulado'); } });
  await f.click('Horario y revisión');
  const settings = () => form(f.view, 'Guardar nueva versión del horario');
  await flush(() => field(settings(), 'Sueldo mensual de referencia (€)').props.onChange({ target: { value: '700' } }));
  await flush(() => settings().props.onSubmit(submit));
  assert.match(text(f.view.root.findByProps({ role: 'alert' })), /No se guardó/);
  assert.equal(field(settings(), 'Sueldo mensual de referencia (€)').props.value, '700');
  await f.select('Ana Simulada');
  assert.equal(field(settings(), 'Sueldo mensual de referencia (€)').props.value, '400');
  assert.equal(f.view.root.findAllByProps({ role: 'alert' }).length, 0);
});

test('rounded connection minutes carry into the hour rather than displaying 60 minutes', async t => {
  const payload = data(); payload.workers[1].hours.worked_minutes = 59.6;
  const f = await setup(t, { payload }); await f.click('Jornada y extras');
  assert.equal(text(card(f.view, 'Conexión registrada').findByType('strong')), '1 h 00 min');
});

test('a stale month response cannot replace the newly selected month', async t => {
  const old = deferred();
  const f = await setup(t, { wrapper: true, read: month => month === '2026-10' ? old.promise : response(data(month)) });
  await f.update(data('2026-09'));
  assert.equal(f.state.reads[0].signal.aborted, true);
  await flush(() => old.resolve(response(data('2026-10'))));
  assert.ok(text(f.view.toJSON()).includes('2026-09'));
  assert.ok(!text(f.view.toJSON()).includes('detalle de 2026-10'));
});

test('saving an old month must not cancel or reload the new month after the user changes period', async t => {
  const pending = deferred();
  const f = await setup(t, { wrapper: true, post: () => pending.promise });
  await f.click('Horario y revisión');
  await flush(() => form(f.view, 'Guardar nueva versión del horario').props.onSubmit(submit));
  assert.equal(f.state.posts.length, 1);
  await f.update(data('2026-09'));
  await flush(() => pending.resolve(response({ ok: true })));
  assert.equal(f.state.reads.at(-1).month, '2026-09');
  assert.ok(text(f.view.toJSON()).includes('2026-09'));
  assert.ok(!text(f.view.toJSON()).includes('No hay datos cargados'));
});

test('a definitive rejected save permits corrected input instead of permanently locking the old payload', async t => {
  let rejected = true;
  const f = await setup(t, { wrapper: true, post: () => rejected ? response({ ok: false, error: 'VALIDATION_FAILED', message: 'Horario no válido' }, 422) : response({ ok: true }) });
  await f.click('Horario y revisión');
  const settings = () => form(f.view, 'Guardar nueva versión del horario');
  await flush(() => settings().props.onSubmit(submit));
  assert.equal(f.state.posts.length, 1);
  rejected = false;
  await flush(() => field(settings(), 'Lunes a viernes · entrada').props.onChange({ target: { value: '14:00' } }));
  await flush(() => settings().props.onSubmit(submit));
  assert.equal(f.state.posts.length, 2);
  assert.equal(f.state.posts[1].weekday_start, '14:00');
  assert.notEqual(f.state.posts[0].operation_id, f.state.posts[1].operation_id);
});

test('a lost save response retains its operation id and does not permit a different payload to duplicate the operation', async t => {
  let failed = true;
  const f = await setup(t, { wrapper: true, post: () => { if (failed) throw new Error('Simulated response lost after sending'); return response({ ok: true }); } });
  await f.click('Horario y revisión');
  const settings = () => form(f.view, 'Guardar nueva versión del horario');
  await flush(() => settings().props.onSubmit(submit));
  assert.equal(f.state.posts.length, 1);
  await flush(() => field(settings(), 'Lunes a viernes · entrada').props.onChange({ target: { value: '14:00' } }));
  await flush(() => settings().props.onSubmit(submit));
  assert.equal(f.state.posts.length, 1);
  assert.match(text(f.view.root.findByProps({ role: 'alert' })), /mismos datos/);
  await flush(() => field(settings(), 'Lunes a viernes · entrada').props.onChange({ target: { value: '15:00' } }));
  failed = false;
  await flush(() => settings().props.onSubmit(submit));
  assert.equal(f.state.posts.length, 2);
  assert.deepEqual(f.state.posts[0], f.state.posts[1]);
  assert.equal(f.state.uuidCount, 1);
  assert.match(text(f.view.toJSON()), /Cambio guardado/);
});

test('the earliest correction date follows Ecuador rather than the UTC date of tracking activation', async t => {
  const payload = data(); payload.workers[1].hours.coverage_start = '2026-10-20T02:00:00Z';
  const f = await setup(t, { payload }); await f.click('Horario y revisión');
  const correction = form(f.view, 'Registrar corrección auditada');
  assert.equal(field(correction, 'Fecha de Ecuador').props.min, '2026-10-19');
});
