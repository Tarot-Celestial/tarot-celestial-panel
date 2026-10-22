const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const workerId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const chatId = '17875550123@s.whatsapp.net';
const incomingAt = '2026-10-22T19:00:00.000Z';
function snapshot(patch = {}) {
  return { ok: true, session: 'central', account_id: '34613550000@s.whatsapp.net', rev: '1.12',
    server_time: '2026-10-22T19:05:00.000Z', unread_total: 3, unread_chats: 1,
    items: [{ id: chatId, name: 'Contacto fixture', unread: 3, last_incoming_id: 'INCOMING-2', last_incoming_at: incomingAt }], ...patch };
}
function fixture(options = {}) {
  const calls = [], env = { WHATSAPP_SESSION_MODE: options.perWorker ? 'per-worker' : 'shared' };
  const worker = { id: workerId, user_id: userId, role: 'central', is_active: true, ...options.worker };
  const db = { auth: { async getUser(token) { calls.push({ auth: token }); return { data: { user: token === 'verified' ? { id: userId } : null }, error: null }; } },
    from(table) {
      calls.push({ table }); assert.equal(table, 'workers'); const filters = [];
      const query = { select() { return query; },
        or(value) { filters.push(row => value.split(',').some(p => { const [key, , match] = p.split('.'); return row[key] === match; })); return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; }, limit() { return query; },
        async maybeSingle() { return { data: filters.every(predicate => predicate(worker)) ? worker : null, error: options.dbError ? { message: 'private-db-detail' } : null }; },
      }; return query;
    } };
  const cache = {};
  function load(relative) {
    const full = path.join(root, relative); if (cache[full]) return cache[full];
    const exports = {}; cache[full] = exports;
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require(name) {
      if (name === '@supabase/supabase-js') return { createClient: () => db };
      if (name === 'next/server') return { NextResponse: class extends Response { static json(body, init) { return new Response(JSON.stringify(body), init); } } };
      if (name === '@/lib/captacion-whatsapp') return { CAPTACION_BENEFITS_IMAGE: '/fixture.png', buildCaptacionMessage: () => 'Fixture', captacionWhatsAppPhone: () => null };
      if (name === '@/lib/countries') return { COUNTRY_OPTIONS: [] };
      if (name === '@/lib/server/brand-filter') return { originMatchesBrand: () => true };
      if (name === '@/lib/server/whatsapp-gateway') {
        const real = load('src/lib/server/whatsapp-gateway.ts');
        return { ...real, async whatsappGatewayFetch(url, init) {
          calls.push({ gateway: url, init });
          if (options.throwGateway) throw new Error('private-gateway-detail');
          return { status: options.status || 200, json: options.json || snapshot({ session: real.whatsappSessionId(worker) }) };
        } };
      }
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
      return require(name);
    }, Date, URL, URLSearchParams, Request, Response, AbortSignal, Buffer, console, process: { env } });
    return exports;
  }
  const api = load('src/app/api/central/whatsapp/route.ts');
  return { calls, parser: load('src/lib/server/whatsapp-attention.ts'), bridge: load('src/lib/server/whatsapp-local-bridge.ts'),
    get: (token = 'verified', query = '') => api.GET(new Request('https://fixture.invalid/api/central/whatsapp?action=attention' + query, { headers: token === null ? {} : { Authorization: `Bearer ${token}` } })) };
}

test('attention authenticates verified active workers before any gateway read', async () => {
  for (const [options, token, status] of [[{}, null, 401], [{}, 'forged-jwt', 401], [{ worker: { is_active: false } }, 'verified', 403], [{ worker: { role: 'tarotista' } }, 'verified', 403], [{ worker: { user_id: 'other-user' } }, 'verified', 403], [{ dbError: true }, 'verified', 503]]) {
    const f = fixture(options), response = await f.get(token);
    assert.equal(response.status, status); assert.equal(f.calls.filter(call => call.gateway).length, 0);
    assert.doesNotMatch(await response.text(), /private-/);
  }
  const admin = fixture({ worker: { role: 'admin' } }); assert.equal((await admin.get()).status, 200);
});

test('attention exposes real message totals with private cache headers and only safe metadata', async () => {
  const data = snapshot({ qr: 'private-qr', messages: ['private-body'], token: 'private-secret' });
  data.items[0].text = 'private-incoming-body'; data.items[0].phone = 'private-phone';
  const f = fixture({ json: data }), response = await f.get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.worker_id, workerId); assert.equal(body.user_id, userId);
  assert.equal(body.unread_total, 3); assert.equal(body.unread_chats, 1); assert.equal(body.items[0].last_incoming_id, 'INCOMING-2');
  assert.deepEqual(Object.keys(body.items[0]).sort(), ['id', 'last_incoming_at', 'last_incoming_id', 'name', 'unread']);
  assert.doesNotMatch(JSON.stringify(body), /private-/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('vary'), 'Authorization');
  assert.deepEqual(f.calls.filter(call => call.gateway), [{ gateway: '/sessions/central/attention', init: undefined }]);
});

test('shared and per-worker sessions are derived from authenticated worker, never client query', async () => {
  for (const perWorker of [false, true]) {
    const f = fixture({ perWorker }), response = await f.get('verified', '&session=other&worker_id=someone-else');
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.session, perWorker ? `w-${workerId}` : 'central');
    assert.equal(f.calls.filter(call => call.gateway)[0].gateway, `/sessions/${body.session}/attention`);
  }
  assert.equal((await fixture({ perWorker: true, json: snapshot() }).get()).status, 503, 'cross-session response rejected');
});

test('disconnection, provider failures, throws and malformed summaries never masquerade as an empty inbox', async () => {
  for (const [options, expected] of [
    [{ status: 409, json: { ok: false, error: 'NOT_CONNECTED', detail: 'private-data' } }, 409],
    [{ status: 502, json: { ok: false, error: 'private-upstream' } }, 503], [{ throwGateway: true }, 503],
    [{ json: snapshot({ unread_total: 99 }) }, 503], [{ json: snapshot({ unread_chats: 2 }) }, 503],
    [{ json: snapshot({ account_id: '' }) }, 503], [{ json: snapshot({ server_time: false }) }, 503],
    [{ json: snapshot({ items: null }) }, 503], [{ json: snapshot({ items: [...snapshot().items, ...snapshot().items], unread_chats: 2, unread_total: 6 }) }, 503],
    [{ json: snapshot({ items: [{ ...snapshot().items[0], last_incoming_at: 123 }] }) }, 503],
  ]) {
    const response = await fixture(options).get(), body = await response.json();
    assert.equal(response.status, expected); assert.equal(body.ok, false);
    assert.equal(body.items, undefined); assert.equal(body.unread_total, undefined); assert.doesNotMatch(JSON.stringify(body), /private-/);
  }
});

test('historical unread without stored inbound message counts without inventing arrival; empty inbox is explicit', async () => {
  const value = snapshot({ items: [{ id: chatId, name: null, unread: 3, last_incoming_id: null, last_incoming_at: null }] });
  const response = await fixture({ json: value }).get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.unread_total, 3); assert.equal(body.items[0].last_incoming_id, null);
  const empty = await fixture({ json: snapshot({ items: [], unread_total: 0, unread_chats: 0 }) }).get();
  assert.equal(empty.status, 200); assert.equal((await empty.json()).unread_total, 0);
});

test('attention is allowed only as a bounded GET by both bridge layers', async () => {
  const { allowedCommand, executeCommand } = await import(pathToFileURL(path.join(root, 'whatsapp-gateway/bridge-worker.mjs')).href);
  const { bridge } = fixture(), id = workerId;
  for (const session of ['central', `w-${workerId}`]) {
    const value = `/sessions/${session}/attention`;
    assert.equal(bridge.allowedBridgePath(value, 'GET'), true); assert.equal(allowedCommand({ id, method: 'GET', path: value }), true);
    assert.equal(bridge.allowedBridgePath(value, 'POST'), false); assert.equal(allowedCommand({ id, method: 'POST', path: value }), false);
  }
  for (const value of ['/sessions/central/attention?include=messages', '/sessions/central/../../attention', 'https://elsewhere.invalid/attention']) {
    assert.equal(bridge.allowedBridgePath(value, 'GET'), false); assert.equal(allowedCommand({ id, method: 'GET', path: value }), false);
  }
  let calls = 0;
  const result = await executeCommand({ id, method: 'GET', path: '/sessions/central/attention', expires_at: new Date(Date.now() + 5000).toISOString() }, {
    localOrigin: 'http://127.0.0.1:8787', secret: 'test-secret', fetcher: async (url, options) => {
      calls++; assert.equal(url, 'http://127.0.0.1:8787/sessions/central/attention'); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
      return { status: 200, json: async () => snapshot() };
    },
  });
  assert.equal(calls, 1); assert.equal(result.status, 200); assert.equal(result.json.unread_total, 3);
});
