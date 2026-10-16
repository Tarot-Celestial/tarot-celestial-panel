const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ownId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-10-16T18:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const routeCode = compile('src/app/api/notifications/list/route.ts');
const reservationCode = compile('src/lib/reservas.ts');

function fixture(options = {}) {
  const calls = [], authTokens = [];
  const tables = {
    workers: options.worker === undefined ? null : options.worker,
    notifications: [{ id: 'own-notification', user_id: ownId, title: 'Aviso propio', created_at: '2026-10-16T17:00:00Z' }],
    crm_client_followups: [],
    reservas: [{ id: 'booking', cliente_nombre: 'Clienta de prueba', fecha_reserva: '2026-10-16T18:05:00', estado: 'pendiente' }],
    invoices: [],
    rendimiento_llamadas: [],
  };
  const admin = {
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const value = () => ({ data: tables[table] ?? [], error: options.queryError || null });
      const query = { then: (resolve, reject) => Promise.resolve(value()).then(resolve, reject), maybeSingle: async () => value() };
      for (const method of ['select', 'eq', 'neq', 'or', 'order', 'limit', 'gte', 'lte', 'lt', 'is']) {
        query[method] = (...args) => { call.filters.push([method, ...args]); return query; };
      }
      return query;
    },
  };
  const reservations = {};
  vm.runInNewContext(reservationCode, { exports: reservations, Date: Clock });
  const api = {};
  vm.runInNewContext(routeCode, {
    exports: api, URL, Date: Clock, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-fixture', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture' } },
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      if (name === '@/lib/reservas') return reservations;
      if (name === '@supabase/supabase-js') return { createClient: (_url, key) => key === 'service-fixture' ? admin : {
        auth: { getUser: async token => {
          authTokens.push(token);
          return { data: { user: options.authError ? null : { id: ownId } }, error: options.authError || null };
        } },
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const request = (userId = ownId, token = 'verified-fixture') => api.GET(new Request(`https://fixture.invalid/api/notifications/list${userId === null ? '' : `?user_id=${encodeURIComponent(userId)}`}`, {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  }));
  return { request, calls, authTokens };
}

test('missing session cannot read notifications by passing a user_id', async () => {
  const h = fixture();
  const response = await h.request(otherId, null);
  assert.equal(response.status, 401);
  assert.equal(h.authTokens.length, 0);
  assert.equal(h.calls.length, 0);
});

test('a forged JWT must pass getUser verification before any data access', async () => {
  const h = fixture({ authError: { status: 401, message: 'untrusted token detail' } });
  const forged = `e30.${Buffer.from(JSON.stringify({ sub: ownId })).toString('base64url')}.forged`;
  const response = await h.request(ownId, forged);
  assert.equal(response.status, 401);
  assert.deepEqual(h.authTokens, [forged]);
  assert.equal(h.calls.length, 0);
  assert.doesNotMatch(await response.text(), /untrusted token detail|forged/);
});

test('even an authenticated administrator cannot request another user_id', async () => {
  const h = fixture({ worker: { id: 'worker', role: 'admin', is_active: true } });
  const response = await h.request(otherId);
  assert.equal(response.status, 403);
  assert.deepEqual(h.authTokens, ['verified-fixture']);
  assert.equal(h.calls.length, 0);
});

test('verified owner receives the same envelope, scoped to their verified UID', async () => {
  const h = fixture();
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, 'own-notification');
  assert.ok(h.calls.find(call => call.table === 'notifications').filters.some(args => args[0] === 'eq' && args[1] === 'user_id' && args[2] === ownId));
  assert.deepEqual(h.calls.map(call => call.table), ['workers', 'notifications']);
});

test('an inactive staff account receives no operational or billing data', async () => {
  const h = fixture({ worker: { id: 'worker', role: 'admin', is_active: false } });
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls.map(call => call.table), ['workers', 'notifications']);
  assert.equal((await response.json()).data.length, 1);
});

test('active central retains operational notifications with explicit Madrid time', async () => {
  const h = fixture({ worker: { id: 'worker', role: 'central', is_active: true } });
  const response = await h.request();
  assert.equal(response.status, 200);
  const body = await response.json();
  const booking = body.data.find(item => item.id === 'virtual:reserva:booking');
  assert.match(booking.message, /20:05 \(hora de España\)/);
  assert.ok(h.calls.find(call => call.table === 'reservas').filters.some(args => args[0] === 'is' && args[1] === 'deleted_at' && args[2] === null));
  assert.ok(!h.calls.some(call => call.table === 'invoices' || call.table === 'rendimiento_llamadas'));
});

test('database and authentication internals are never returned in errors', async () => {
  const h = fixture({ queryError: { message: 'private database host and secret' } });
  const response = await h.request();
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private|database host|secret/);
  const auth = fixture({ authError: { status: 503, message: 'provider credential details' } });
  const authResponse = await auth.request();
  assert.equal(authResponse.status, 500);
  assert.equal(auth.calls.length, 0);
  assert.doesNotMatch(await authResponse.text(), /credential|provider/);
});
