// Local API contracts only. Supabase/Auth are simulated; no production writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function load(file, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], URL, Request, Response, Date, console, ...globals });
  return exports;
}
function split(expression) {
  let depth = 0, start = 0; const parts = [];
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === '(') depth++;
    if (expression[i] === ')') depth--;
    if (expression[i] === ',' && depth === 0) { parts.push(expression.slice(start, i)); start = i + 1; }
  }
  parts.push(expression.slice(start)); return parts;
}
function matches(row, expression) {
  const logical = /^(and|or)\((.*)\)$/.exec(expression);
  if (logical) return logical[1] === 'and' ? split(logical[2]).every(item => matches(row, item)) : split(logical[2]).some(item => matches(row, item));
  const [, key, op, value] = /^([a-z_]+)\.(not\.is|not\.in|is|in|eq)\.(.*)$/.exec(expression) || [];
  if (!key) throw new Error('Unhandled fixture filter: ' + expression);
  const actual = row[key] ?? null;
  if (op === 'eq') return String(actual) === value;
  if (op === 'is') return value === 'null' ? actual === null : String(actual) === value;
  if (op === 'not.is') return actual !== null;
  const found = value.slice(1, -1).split(',').includes(String(actual));
  return actual !== null && (op === 'in' ? found : !found);
}
function fixture(options = {}) {
  const worker = { id: id(1), user_id: id(2), auth_user_id: id(2), role: options.role || 'central', is_active: options.active !== false, display_name: 'Fixture central' };
  const reads = [];
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ...options.env };
  const db = { auth: { getUser: async token => ({ data: { user: token === 'fixture' ? { id: id(2) } : null }, error: null }) }, from(table) {
    let fields = '', single = false, start = 0, end = Infinity, limit = Infinity; const predicates = [], orders = [], ops = [];
    const query = {
      select(value) { fields = value; return query; },
      eq(key, value) { predicates.push(row => row[key] === value); ops.push('eq:' + key); return query; },
      gte(key, value) { predicates.push(row => row[key] >= value); ops.push('gte:' + key); return query; },
      lte(key, value) { predicates.push(row => row[key] <= value); ops.push('lte:' + key); return query; },
      is(key, value) { predicates.push(row => (row[key] ?? null) === value); ops.push('is:' + key); return query; },
      in(key, values) { predicates.push(row => values.includes(row[key])); ops.push('in:' + key); return query; },
      not(key, op, value) { predicates.push(row => matches(row, `${key}.not.${op}.${value}`)); ops.push('not:' + key); return query; },
      or(value) { predicates.push(row => split(value).some(part => matches(row, part))); ops.push('or:' + value); return query; },
      order(key, settings) { orders.push([key, settings.ascending]); ops.push('order:' + key); return query; },
      range(from, to) { start = from; end = to; ops.push('range'); return query; },
      limit(value) { limit = value; return query; },
      maybeSingle() { single = true; return query; },
      then(resolve, reject) {
        reads.push({ table, fields, ops, start, end });
        if (options.joinError && table === 'captacion_leads' && fields.includes('cliente:')) return Promise.resolve({ data: null, error: { message: 'fixture relationship unavailable' } }).then(resolve, reject);
        if (options.metaError && table === 'meta_lead_events') return Promise.resolve({ data: null, error: { message: 'private failure detail' } }).then(resolve, reject);
        let rows = table === 'workers' ? [worker] : table === 'captacion_leads' ? options.rows || [] : table === 'crm_clientes' ? options.clients || [] : table === 'meta_lead_events' ? options.events || (options.event ? [options.event] : []) : [];
        rows = rows.filter(row => predicates.every(predicate => predicate(row))).sort((a, b) => {
          for (const [key, asc] of orders) { const cmp = String(a[key] ?? '').localeCompare(String(b[key] ?? '')); if (cmp) return asc ? cmp : -cmp; } return 0;
        }).slice(start, Math.min(end + 1, start + limit));
        if (!fields.includes('cliente:')) rows = rows.map(row => Object.fromEntries(fields.split(',').map(key => key.trim()).filter(key => key in row).map(key => [key, row[key]])));
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
  const brand = load('src/lib/server/brand-filter.ts', {});
  const api = load('src/app/api/captacion/list/route.ts', {
    'next/server': { NextResponse: class extends Response { static json(value, init) { return new Response(JSON.stringify(value), init); } } },
    '@supabase/supabase-js': { createClient: () => db },
    '@/lib/server/brand-filter': brand,
    '@/lib/server/captacion-attention': load('src/lib/server/captacion-attention.ts', {}),
    '@/lib/server/auth-fast': { getBearerToken: req => req.headers.get('authorization')?.replace(/^Bearer /, '') },
  }, { process: { env } });
  return { reads, worker, get: (query = 'scope=todos', token = 'fixture') => api.GET(new Request('http://localhost/api/captacion/list?' + query, { headers: token ? { authorization: 'Bearer ' + token } : {} })) };
}
const row = (n, extra = {}) => ({ id: id(n + 100), cliente_id: id(n + 1000), estado: 'nuevo', assigned_worker_id: null, created_at: '2026-10-12T00:00:00Z', closed_at: null, cliente: { id: id(n + 1000), origen: 'Facebook' }, ...extra });

test('auth and active admin/central permission are verified before lead reads', async () => {
  for (const [options, token] of [[{}, null], [{}, 'invalid'], [{ active: false }, 'fixture'], [{ role: 'tarotista' }, 'fixture']]) {
    const f = fixture(options); assert.equal((await f.get('scope=todos', token)).status, 401);
    assert.equal(f.reads.filter(read => read.table === 'captacion_leads').length, 0);
  }
});

test('all 398 permitted rows remain reachable across stable pages, beyond the old 300 limit', async () => {
  const f = fixture({ rows: Array.from({ length: 398 }, (_, n) => row(n)) });
  const first = await (await f.get('scope=todos')).json(), second = await (await f.get('scope=todos&page=1')).json();
  assert.equal(first.items.length, 250); assert.equal(first.pagination.next_page, 1);
  assert.equal(second.items.length, 148); assert.equal(second.pagination.next_page, null);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 398);
  assert.ok(f.reads.filter(read => read.table === 'captacion_leads').every(read => read.end - read.start === 249 && read.ops.includes('order:created_at') && read.ops.includes('order:id')));
});

test('central ownership and scope exclude newer foreign and closed rows before pagination', async () => {
  const rows = [...Array.from({ length: 350 }, (_, n) => row(n, { assigned_worker_id: id(99), created_at: '2026-10-14' })), ...Array.from({ length: 350 }, (_, n) => row(400 + n, { estado: 'captado', created_at: '2026-10-13' })), row(900, { assigned_worker_id: id(1) }), row(901)];
  const f = fixture({ rows }), response = await (await f.get('scope=pendientes')).json();
  assert.equal(response.items.length, 2); assert.equal(response.pagination.has_more, false);
  assert.ok(response.items.every(item => !item.assigned_worker_id || item.assigned_worker_id === id(1)));
  const read = f.reads.find(read => read.table === 'captacion_leads');
  assert.ok(read.ops.indexOf('range') > read.ops.findIndex(op => op.startsWith('or:')));
});

test('closed timestamps and captured clients map to the right workflow and pending null states remain visible', async () => {
  const f = fixture({ rows: [row(1, { closed_at: '2026-10-13' }), row(2, { estado: 'captado', closed_at: '2026-10-13' }), row(3, { estado: null }), row(4, { estado: 'no_interesado' })] });
  const closed = await (await f.get('scope=cerrados')).json(); assert.equal(closed.items.length, 3);
  assert.equal(closed.items.find(item => item.id === row(1).id).workflow_state, 'cerrado');
  assert.equal(closed.items.find(item => item.id === row(2).id).workflow_state, 'cliente');
  const pending = await (await f.get('scope=pendientes')).json(); assert.equal(pending.items.length, 1); assert.equal(pending.items[0].estado, null);
});

test('other-brand pages do not terminate the cursor before a permitted brand on the next page', async () => {
  const rows = [...Array.from({ length: 250 }, (_, n) => row(n, { created_at: '2026-10-14', cliente: { origen: 'Orion Facebook' } })), row(500)];
  const f = fixture({ rows }); const first = await (await f.get()).json(), second = await (await f.get('scope=todos&page=1')).json();
  assert.equal(first.items.length, 0); assert.equal(first.pagination.next_page, 1); assert.equal(second.items.length, 1);
});

test('fallback has the same scope and pagination and joins the permitted clients', async () => {
  const rows = Array.from({ length: 260 }, (_, n) => row(n));
  const f = fixture({ rows, joinError: true, clients: rows.map(item => ({ id: item.cliente_id, nombre: 'Fixture', origen: 'Facebook' })) });
  const result = await (await f.get('scope=pendientes&page=1')).json(); assert.equal(result.items.length, 10); assert.equal(result.items[0].cliente.nombre, 'Fixture');
});

test('diagnostics are admin-only booleans and allowlisted event fields, never secret values or error payloads', async () => {
  const options = { env: { META_ACCESS_TOKEN: 'secret-access', META_APP_SECRET: 'secret-app', META_INGEST_SECRET: 'secret-ingest', CRON_SECRET: 'secret-cron', META_FORM_IDS: ' , ' }, event: { status: 'processed', source: 'internal_ingest', received_at: '2026-10-12', last_error: 'private-phone', payload: 'private-payload' } };
  const central = fixture(options); const centralBody = await (await central.get()).json();
  assert.equal(centralBody.meta_diagnostics, undefined);
  assert.ok(central.reads.filter(read => read.table === 'meta_lead_events').every(read => read.fields === 'captacion_lead_id,meta_created_at'));
  const admin = fixture({ ...options, role: 'admin' }); const response = await admin.get(), body = await response.json();
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.equal(body.meta_diagnostics.configuration.access_token, true); assert.equal(body.meta_diagnostics.configuration.form_ids, false); assert.equal(body.meta_diagnostics.configuration.verify_token, false);
  assert.equal(body.meta_diagnostics.last_event.source, 'internal_ingest'); assert.doesNotMatch(JSON.stringify(body), /secret-|private-/);
  const unavailable = await fixture({ role: 'admin', metaError: true }).get(); assert.equal(unavailable.status, 503);
});

test('invalid page and scope inputs never execute a lead query', async () => {
  for (const query of ['page=-1', 'page=1.2', 'page=Infinity', 'scope=unknown', 'page=100001']) {
    const f = fixture(); assert.equal((await f.get(query)).status, 400); assert.equal(f.reads.some(read => read.table === 'captacion_leads'), false);
  }
});

test('attention deep links fetch only the requested authorized lead, including a historic closed one', async () => {
  const f = fixture({ rows: [row(1, { estado: 'no_interesado' }), row(2, { assigned_worker_id: id(99) }), row(3, { cliente: { origen: 'Orion' } })] });
  const selected = await (await f.get('scope=todos&lead_id=' + row(1).id)).json();
  assert.equal(selected.items.length, 1); assert.equal(selected.items[0].id, row(1).id);
  for (const n of [2, 3]) assert.equal((await (await f.get('scope=todos&lead_id=' + row(n).id)).json()).items.length, 0);
  const invalid = fixture(); assert.equal((await invalid.get('lead_id=invalid')).status, 400);
  assert.equal(invalid.reads.some(read => read.table === 'captacion_leads'), false);
});

test('recent original Meta submissions are attached only to authorized leads without changing their workflow', async () => {
  const at = hours => new Date(Date.now() - hours * 3600000).toISOString();
  const fresh = at(1), previous = at(2);
  const rows = [row(1), row(2, { estado: 'pend_cap' }), row(3, { estado: 'no_interesado', closed_at: at(72) }), row(4, { created_at: at(0) }), row(5, { assigned_worker_id: id(99) }), row(6, { cliente: { origen: 'Orion Facebook' } }), row(7), row(8)];
  const event = (n, time, extra = {}) => ({ captacion_lead_id: row(n).id, meta_created_at: time, status: 'processed', payload: 'private-data', ...extra });
  const f = fixture({ rows, events: [event(1, previous), event(1, fresh), event(2, fresh), event(3, fresh), event(4, at(48)), event(5, fresh), event(6, fresh), event(7, at(-1)), event(8, fresh, { status: 'failed' })] });
  const body = await (await f.get()).json();
  assert.equal(body.items.length, 6);
  for (const n of [1, 2, 3]) assert.equal(body.items.find(item => item.id === row(n).id).latest_meta_lead_at, fresh);
  for (const n of [4, 7, 8]) assert.equal(body.items.find(item => item.id === row(n).id).latest_meta_lead_at, null);
  assert.equal(body.items.find(item => item.id === row(2).id).workflow_state, 'pend_cap');
  assert.equal(body.items.find(item => item.id === row(3).id).workflow_state, 'cerrado');
  assert.doesNotMatch(JSON.stringify(body), /private-data/);
  const reads = f.reads.filter(read => read.table === 'meta_lead_events');
  assert.ok(reads.length > 0 && reads.every(read => read.fields === 'captacion_lead_id,meta_created_at' && read.ops.includes('eq:status')));
});

test('recent submission lookup paginates repeated events and a failed ledger cannot hide new requests', async () => {
  const fresh = new Date(Date.now() - 3600000).toISOString();
  const events = Array.from({ length: 501 }, (_, n) => ({ captacion_lead_id: row(n < 500 ? 1 : 2).id, leadgen_id: String(1000 - n), status: 'processed', meta_created_at: fresh }));
  const f = fixture({ rows: [row(1), row(2)], events });
  const body = await (await f.get()).json();
  assert.ok(body.items.every(item => item.latest_meta_lead_at === fresh));
  assert.equal(f.reads.filter(read => read.table === 'meta_lead_events').length, 2);
  const response = await fixture({ rows: [row(1)], metaError: true }).get();
  const unavailable = await response.json();
  assert.equal(response.status, 503); assert.equal(unavailable.ok, false);
  assert.equal(unavailable.items, undefined); assert.equal(unavailable.error, 'ERR_CAPTACION_LIST');
  assert.doesNotMatch(JSON.stringify(unavailable), /private/);
});

test('new submissions on old CRM rows are first globally and pagination never repeats them', async () => {
  const fresh = new Date(Date.now() - 3600000).toISOString();
  const rows = [...Array.from({ length: 1100 }, (_, n) => row(n, { created_at: '2026-10-20', next_contact_at: '2026-01-01' })), row(2000, { created_at: '2020-01-01', estado: 'pend_cap', next_contact_at: '2026-12-01' })];
  const f = fixture({ rows, events: [{ captacion_lead_id: row(2000).id, meta_created_at: fresh, status: 'processed' }] });
  const pages = [];
  for (let page = 0; page < 5; page++) pages.push(await (await f.get('scope=pendientes&page=' + page)).json());
  assert.equal(pages[0].items[0].id, row(2000).id);
  assert.equal(pages[0].items[0].new_submission_pending, true);
  assert.equal(pages[0].items[0].workflow_state, 'pend_cap');
  const ids = pages.flatMap(page => page.items.map(item => item.id));
  assert.equal(ids.length, 1101); assert.equal(new Set(ids).size, 1101);
  assert.deepEqual(pages.map(page => page.items.length), [250, 250, 250, 250, 101]);
  assert.equal(pages[4].pagination.has_more, false);
});

test('closed historical workflow reentry is visible in pending without rewriting its history', async () => {
  const fresh = new Date(Date.now() - 3600000).toISOString();
  const oldClosed = new Date(Date.now() - 72 * 3600000).toISOString();
  const managed = new Date(Date.now() - 1800000).toISOString();
  const rows = [row(1, { estado: 'no_interesado', closed_at: oldClosed, last_contact_at: oldClosed }), row(2, { estado: 'no_interesado', closed_at: managed }), row(3, { estado: 'pend_cap', last_contact_at: oldClosed })];
  const events = [1, 2, 3].map(n => ({ captacion_lead_id: row(n).id, meta_created_at: fresh, status: 'processed' }));
  const f = fixture({ rows, events });
  const pending = await (await f.get('scope=pendientes')).json();
  assert.deepEqual(pending.items.map(item => item.id).sort(), [row(1).id, row(3).id]);
  const reentry = pending.items.find(item => item.id === row(1).id);
  assert.equal(reentry.estado, 'no_interesado'); assert.equal(reentry.closed_at, oldClosed);
  assert.equal(reentry.workflow_state, 'cerrado'); assert.equal(reentry.is_closed, true);
  assert.equal(reentry.new_submission_pending, true); assert.equal(reentry.reentry_pending, true);
  const closed = await (await f.get('scope=cerrados')).json();
  assert.deepEqual(closed.items.map(item => item.id), [row(2).id]);
  assert.equal(closed.items[0].new_submission_pending, false);
});

test('priority page respects assignment and explicit brand, including fallback join', async () => {
  const fresh = new Date(Date.now() - 3600000).toISOString();
  const rows = [row(1), row(2, { assigned_worker_id: id(99) }), row(3)];
  const events = [1, 2, 3].map(n => ({ captacion_lead_id: row(n).id, meta_created_at: fresh, status: 'processed' }));
  const clients = rows.map(item => ({ id: item.cliente_id, origen: item.id === row(3).id ? 'Orion Facebook' : 'Facebook' }));
  const f = fixture({ rows, clients, events, joinError: true });
  const celestial = await (await f.get('scope=pendientes&brand=celestial')).json();
  assert.deepEqual(celestial.items.map(item => item.id), [row(1).id]);
  const orion = await (await f.get('scope=pendientes&brand=orion')).json();
  assert.equal(orion.brand, 'orion'); assert.deepEqual(orion.items.map(item => item.id), [row(3).id]);
  assert.equal((await f.get('brand=invalid')).status, 400);
});

test('more than 250 new requests are globally ordered across batches and pages before ordinary rows', async () => {
  const since = Date.now() - 3600000;
  const rows = Array.from({ length: 270 }, (_, n) => row(n, { created_at: '2020-01-01' }));
  const events = rows.map((item, n) => ({ captacion_lead_id: item.id, meta_created_at: new Date(since + n * 1000).toISOString(), status: 'processed' }));
  const f = fixture({ rows: [...rows, row(9999, { created_at: '2026-10-22' })], events });
  const first = await (await f.get('scope=pendientes')).json();
  const second = await (await f.get('scope=pendientes&page=1')).json();
  assert.equal(first.items.length, 250); assert.equal(first.items[0].id, row(269).id);
  assert.equal(second.items.length, 21); assert.equal(second.items[0].id, row(19).id);
  assert.equal(second.items.at(-1).id, row(9999).id);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 271);
  assert.ok(f.reads.some(read => read.table === 'captacion_leads' && read.fields === 'id'));
  assert.equal(f.reads.some(read => read.ops.includes('not:id')), false);
});
