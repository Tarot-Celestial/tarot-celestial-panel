// Contract tests with simulated Supabase/Auth. These never read or write production.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-10-22T20:00:00.000Z');
const at = hours => new Date(NOW - hours * 3600000).toISOString();
class Clock extends Date { static now() { return NOW; } }
function load(file, imports, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name], Date: Clock, URL, Request, Response, ...globals });
  return exports;
}
function fixture(options = {}) {
  const reads = [], authTokens = [];
  const worker = { id: id(1), user_id: id(2), role: 'central', is_active: true, ...options.worker };
  const tables = { workers: [worker], meta_lead_events: options.events || [], captacion_leads: options.leads || [], crm_clientes: options.clients || [] };
  const db = {
    auth: { async getUser(token) {
      authTokens.push(token);
      if (options.authThrows) throw new Error('private auth failure');
      return { data: { user: token === 'verified' ? { id: id(2) } : null }, error: null };
    } },
    from(table) {
      let fields = '', single = false, start = 0, end = Infinity, limit = Infinity;
      const predicates = [], orders = [], ops = [];
      const query = {
        select(value) { fields = value; return query; },
        eq(key, value) { predicates.push(row => row[key] === value); ops.push(['eq', key, value]); return query; },
        gte(key, value) { predicates.push(row => row[key] >= value); ops.push(['gte', key, value]); return query; },
        lte(key, value) { predicates.push(row => row[key] <= value); ops.push(['lte', key, value]); return query; },
        in(key, values) { predicates.push(row => values.includes(row[key])); ops.push(['in', key, values]); return query; },
        or(expression) {
          predicates.push(row => expression.split(',').some(part => {
            const [key, op, value] = part.split('.');
            return op === 'is' && value === 'null' ? row[key] == null : String(row[key]) === value;
          }));
          ops.push(['or', expression]); return query;
        },
        order(key, settings) { orders.push([key, settings.ascending]); ops.push(['order', key]); return query; },
        range(from, to) { start = from; end = to; ops.push(['range', from, to]); return query; },
        limit(value) { limit = value; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          reads.push({ table, fields, ops, start, end });
          if (options.throwTable === table) return Promise.reject(new Error('private thrown payload')).then(resolve, reject);
          if (options.failTable === table) return Promise.resolve({ data: null, error: { message: 'private database payload with phone' } }).then(resolve, reject);
          if (options.nullTable === table) return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          const rows = tables[table].filter(row => predicates.every(predicate => predicate(row))).sort((a, b) => {
            for (const [key, asc] of orders) { const result = String(a[key] ?? '').localeCompare(String(b[key] ?? '')); if (result) return asc ? result : -result; } return 0;
          }).slice(start, Math.min(end + 1, start + limit)).map(row => Object.fromEntries(fields.split(',').map(key => key.trim()).filter(key => key in row).map(key => [key, row[key]])));
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const brand = load('src/lib/server/brand-filter.ts', {});
  const api = load('src/app/api/captacion/attention/route.ts', {
    'next/server': { NextResponse: class extends Response { static json(body, init) { return new Response(JSON.stringify(body), init); } } },
    '@supabase/supabase-js': { createClient: () => db },
    '@/lib/server/brand-filter': brand,
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' } } });
  return { reads, authTokens, get: (query = '', token = 'verified') => api.GET(new Request(`http://localhost/api/captacion/attention?${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })) };
}
const lead = (n, extra = {}) => ({ id: id(100 + n), cliente_id: id(1000 + n), origen: 'facebook_ads', assigned_worker_id: null, last_contact_at: null, contacted_at: null, closed_at: null, ...extra });
const client = (n, extra = {}) => ({ id: id(1000 + n), nombre: `Contacto ${n}`, apellido: 'Fixture', origen: 'Facebook', telefono: 'private-phone', email: 'private-email', ...extra });
const event = (n, hours = 1, extra = {}) => ({ leadgen_id: String(n), captacion_lead_id: lead(n).id, status: 'processed', meta_created_at: at(hours), created_at: at(0), payload: 'private-payload', ...extra });

test('verified identity and active central/admin access precede every event or lead read', async () => {
  for (const [options, token] of [[{}, null], [{}, 'forged-jwt'], [{ worker: { is_active: false } }, 'verified'], [{ worker: { role: 'tarotista' } }, 'verified'], [{ worker: { user_id: id(99) } }, 'verified']]) {
    const f = fixture(options), response = await f.get('', token);
    assert.equal(response.status, 401);
    assert.equal(f.reads.some(read => ['meta_lead_events', 'captacion_leads', 'crm_clientes'].includes(read.table)), false);
    assert.deepEqual(f.authTokens, token ? [token] : []);
  }
});

test('central receives only assigned or unassigned matching-brand records with allowlisted metadata', async () => {
  const options = { events: [1, 2, 3, 4].map(n => event(n)), leads: [lead(1), lead(2, { assigned_worker_id: id(1) }), lead(3, { assigned_worker_id: id(99) }), lead(4)], clients: [client(1), client(2), client(3), client(4, { origen: 'Orion Facebook' })] };
  const f = fixture(options), response = await f.get('brand=celestial'), body = await response.json();
  assert.equal(body.ok, true); assert.deepEqual(body.items.map(item => item.id).sort(), [lead(1).id, lead(2).id]);
  assert.deepEqual(Object.keys(body.items[0]).sort(), ['cliente_id', 'id', 'latest_meta_lead_at', 'nombre']);
  assert.equal(body.items[0].nombre, 'Contacto 1 Fixture'); assert.equal(body.worker_id, id(1)); assert.equal(body.user_id, id(2)); assert.equal(body.brand, 'celestial'); assert.equal(body.server_time, at(0));
  assert.match(response.headers.get('cache-control'), /private.*no-store/); assert.equal(response.headers.get('vary'), 'Authorization');
  assert.doesNotMatch(JSON.stringify(body), /private-|assigned_worker|origen/);
  assert.ok(f.reads.find(read => read.table === 'captacion_leads').ops.some(op => op[0] === 'or' && op[1].includes('assigned_worker_id')));
  const namesRead = f.reads.find(read => read.table === 'crm_clientes');
  assert.equal(namesRead.fields, 'id,nombre,apellido,origen'); assert.equal(namesRead.ops.find(op => op[0] === 'in')[2].includes(client(3).id), false);
});

test('orion selection is explicit, CRM origin has priority, and fallback origin agrees with list', async () => {
  const f = fixture({ events: [1, 2, 3].map(n => event(n)), leads: [lead(1, { origen: 'Orion Facebook' }), lead(2), lead(3, { origen: 'Orion Facebook' })], clients: [client(1), client(2, { origen: 'Orion Facebook' })] });
  const body = await (await f.get('brand=orion')).json();
  assert.deepEqual(body.items.map(item => item.id).sort(), [lead(2).id, lead(3).id]);
  assert.equal(body.items.find(item => item.id === lead(3).id).nombre, 'Nuevo contacto');
  assert.equal(body.brand, 'orion');
  const bad = fixture(); assert.equal((await bad.get('brand=unexpected')).status, 400); assert.equal(bad.reads.some(read => read.table === 'meta_lead_events'), false);
});

test('admin can see other assignments while preserving brand filtering', async () => {
  const f = fixture({ worker: { role: 'admin' }, events: [event(1), event(2)], leads: [lead(1, { assigned_worker_id: id(99) }), lead(2)], clients: [client(1), client(2, { origen: 'Orion Facebook' })] });
  const body = await (await f.get()).json(); assert.deepEqual(body.items.map(item => item.id), [lead(1).id]);
});

test('only processed original Meta dates in the last 24h qualify, including repeat submissions', async () => {
  const f = fixture({ events: [event(1, 3), event(1, 1, { leadgen_id: 'latest' }), event(2, 48), event(3, 1, { status: 'failed' }), event(4, -1), event(5, 24), event(6, 24.0001), event(7, 1, { captacion_lead_id: null })], leads: [1, 2, 3, 4, 5, 6].map(n => lead(n)), clients: [1, 2, 3, 4, 5, 6].map(n => client(n)) });
  const body = await (await f.get()).json();
  assert.deepEqual(body.items.map(item => item.id), [lead(1).id, lead(5).id]);
  assert.equal(body.items[0].latest_meta_lead_at, at(1));
  const read = f.reads.find(read => read.table === 'meta_lead_events');
  assert.equal(read.fields, 'captacion_lead_id,meta_created_at');
  assert.ok(read.ops.some(op => op[0] === 'gte' && op[1] === 'meta_created_at' && op[2] === at(24)));
  assert.ok(read.ops.some(op => op[0] === 'lte' && op[1] === 'meta_created_at'));
});

test('management at or after submission dismisses it; old management and old closed status do not', async () => {
  const f = fixture({ events: [1, 2, 3, 4, 5, 6].map(n => event(n)), leads: [lead(1, { last_contact_at: at(0.5) }), lead(2, { contacted_at: at(1) }), lead(3, { closed_at: at(0.25) }), lead(4, { last_contact_at: at(2) }), lead(5, { estado: 'no_interesado', closed_at: at(200), last_contact_at: at(200) }), lead(6, { estado: 'pend_cap', contacted_at: at(50) })], clients: [1, 2, 3, 4, 5, 6].map(n => client(n)) });
  const body = await (await f.get()).json(); assert.deepEqual(body.items.map(item => item.id), [lead(4).id, lead(5).id, lead(6).id]);
});

test('500-row event pages deduplicate repeated arrivals and 250-ID batches retain every eligible customer', async () => {
  const events = [...Array.from({ length: 510 }, (_, n) => event(1, 1, { leadgen_id: `repeat-${String(n).padStart(4, '0')}` })), ...Array.from({ length: 260 }, (_, n) => event(n + 2, 2))];
  const f = fixture({ events, leads: Array.from({ length: 261 }, (_, n) => lead(n + 1)), clients: Array.from({ length: 261 }, (_, n) => client(n + 1)) });
  const body = await (await f.get()).json();
  assert.equal(body.items.length, 261); assert.equal(new Set(body.items.map(item => item.id)).size, 261);
  const pages = f.reads.filter(read => read.table === 'meta_lead_events');
  assert.equal(pages.length, 2); assert.deepEqual(pages.map(read => [read.start, read.end]), [[0, 499], [500, 999]]);
  assert.ok(pages.every(read => read.ops.some(op => op[0] === 'order' && op[1] === 'leadgen_id')));
  const batches = f.reads.filter(read => read.table === 'captacion_leads');
  assert.deepEqual(batches.map(read => read.ops.find(op => op[0] === 'in')[2].length), [250, 11]);
});

test('empty event results return genuine empty success without reading customer tables', async () => {
  const f = fixture(), body = await (await f.get()).json(); assert.equal(body.ok, true); assert.deepEqual(body.items, []);
  assert.equal(f.reads.some(read => ['captacion_leads', 'crm_clientes'].includes(read.table)), false);
});

test('read errors, malformed responses, and thrown failures return sanitized 503 instead of empty success', async () => {
  const base = { events: [event(1)], leads: [lead(1)], clients: [client(1)] };
  for (const options of [{ failTable: 'workers' }, { failTable: 'meta_lead_events' }, { failTable: 'captacion_leads' }, { failTable: 'crm_clientes' }, { nullTable: 'meta_lead_events' }, { throwTable: 'meta_lead_events' }, { authThrows: true }]) {
    const response = await fixture({ ...base, ...options }).get(), body = await response.json();
    assert.equal(response.status, 503); assert.deepEqual(body, { ok: false, error: 'ATTENTION_UNAVAILABLE' });
    assert.doesNotMatch(JSON.stringify(body), /private|phone|payload/);
  }
});
