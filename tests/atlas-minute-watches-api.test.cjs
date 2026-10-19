const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const h = { calls: [], role: 'admin', active: true, error: null, data: { watches: [], unreadCount: 0 } };
  const db = { auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: id(1) } : null } }) },
    from(table) { assert.equal(table, 'workers'); return { select() { return this; }, eq(key, value) { assert.equal(key, 'user_id'); assert.equal(value, id(1)); return this; },
      maybeSingle: async () => ({ data: { id: id(101), user_id: id(1), role: h.role, is_active: h.active } }) }; },
    rpc: async (name, args) => { h.calls.push({ name, args }); return { data: h.data, error: h.error }; } };
  const cache = {};
  function load(file) {
    file = file.replaceAll('\\', '/');
    if (cache[file]) return cache[file]; const exports = {}; cache[file] = exports;
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } };
      if (name === '@/lib/admin/require-admin') return { getServiceClient: () => db };
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith('.')) return load(path.join(path.dirname(file), `${name}.ts`));
      return require(name);
    } }); return exports;
  }
  h.route = load('src/app/api/admin/atlas/watches/route.ts');
  h.req = (body, token = 'valid') => new Request('https://example.test/api/admin/atlas/watches', { method: body === undefined ? 'GET' : 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
  return h;
}
test('watches require verified admin auth before read/write and always disable caching', async () => {
  const h = fixture();
  for (const token of ['', 'forged']) assert.equal((await h.route.GET(h.req(undefined, token))).status, 401);
  h.role = 'central'; assert.equal((await h.route.GET(h.req())).status, 403);
  h.role = 'admin'; h.active = false; assert.equal((await h.route.POST(h.req({ action: 'upsert', clientId: id(10) }))).status, 403);
  assert.equal(h.calls.length, 0); h.active = true;
  const response = await h.route.GET(h.req()); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(h.calls[0].name, 'tc_atlas_minute_watches'); assert.equal(h.calls[0].args.p_user, id(1));
});
test('watch configuration uses session identity and validates threshold without accepting strings or forged booleans', async () => {
  const h = fixture();
  for (const threshold of ['30', -1, 1001, 2.5, null]) assert.equal((await h.route.POST(h.req({ action: 'upsert', clientId: id(10), threshold }))).status, 400);
  assert.equal((await h.route.POST(h.req({ action: 'set_enabled', watchId: id(20), enabled: 'false' }))).status, 400); assert.equal(h.calls.length, 0);
  const result = await h.route.POST(h.req({ action: 'upsert', clientId: id(10), workerId: id(999), userId: id(999) })); assert.equal(result.status, 200);
  assert.equal(h.calls[0].args.p_user, id(1)); assert.equal(h.calls[0].args.p_client, id(10)); assert.equal(h.calls[0].args.p_threshold, 30);
});
test('acknowledgement and pause invoke only dedicated owned-watch RPCs and return refreshed status', async () => {
  const h = fixture();
  assert.equal((await h.route.POST(h.req({ action: 'acknowledge', alertId: id(30) }))).status, 200);
  assert.equal(h.calls[0].name, 'tc_atlas_ack_minute_alert'); assert.equal(h.calls[0].args.p_alert, id(30));
  assert.equal((await h.route.POST(h.req({ action: 'set_enabled', watchId: id(20), enabled: false }))).status, 200);
  assert.equal(h.calls[1].name, 'tc_atlas_set_minute_watch_enabled'); assert.equal(h.calls[1].args.p_enabled, false);
  assert.ok(h.calls.every(call => call.args.p_user === id(1)));
});
test('database failures remain unavailable rather than becoming false zero balances or empty successful snapshots', async () => {
  const h = fixture(); h.error = { message: 'Network down' };
  let response = await h.route.GET(h.req()); assert.equal(response.status, 503); assert.equal((await response.json()).ok, false);
  h.error = { message: 'WATCH_NOT_FOUND' }; response = await h.route.POST(h.req({ action: 'set_enabled', watchId: id(20), enabled: false })); assert.equal(response.status, 404);
  h.error = { message: 'FORBIDDEN' }; assert.equal((await h.route.GET(h.req())).status, 403);
});
test('invalid JSON, arrays, unknown actions and oversized requests never reach database mutations', async () => {
  const h = fixture();
  for (const body of [[], null, { action: 'activate_promo' }, { action: 'acknowledge', alertId: 'bad' }]) assert.equal((await h.route.POST(h.req(body))).status, 400);
  assert.equal((await h.route.POST(h.req({ note: 'x'.repeat(2100) }))).status, 413);
  const malformed = new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer valid' }, body: '{' });
  assert.equal((await h.route.POST(malformed)).status, 400); assert.equal(h.calls.length, 0);
});
