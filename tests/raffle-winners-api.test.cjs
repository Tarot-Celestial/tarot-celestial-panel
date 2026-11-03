const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/api/cliente/raffle/winners/route.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const publicFields = 'position,prize_name,winning_number,selection_method,is_test';
function fixture(options = {}) {
  const calls = [];
  const tables = {
    raffles: [{ id: 'active', status: 'active', created_at: '2026-10-16' }, { id: 'closed', status: 'closed', created_at: '2026-10-01' }],
    raffle_public_winners: [...Array.from({ length: 31 }, (_, i) => ({ raffle_id: 'active', position: 31 - i, prize_name: `Prize ${31 - i}`, winning_number: i + 1, selection_method: 'roulette', is_test: false, client_id: 'private-id', phone: 'private-phone' })), { raffle_id: 'closed', position: 99, prize_name: 'Archived' }],
    ...options.tables,
  };
  const admin = {
    auth: { getUser: async token => { calls.push({ auth: token }); return { data: { user: options.invalid ? null : { id: token } }, error: options.invalid ? 'invalid' : null }; } },
    from(table) {
      calls.push({ table });
      assert.ok(['raffles', 'raffle_public_winners'].includes(table), 'must not gate winners on CRM, rank, or ticket ownership');
      let columns = [], filters = [], orders = [], cap = Infinity, single = false;
      const q = {
        select(value) { columns = value.split(','); if (table === 'raffle_public_winners') assert.equal(value, publicFields); return q; },
        eq(key, value) { filters.push(row => row[key] === value); return q; },
        order(key, { ascending = true } = {}) { orders.push({ key, ascending }); return q; },
        limit(n) { cap = n; return q; }, maybeSingle() { single = true; return q; },
        then(resolve, reject) {
          let rows = tables[table].filter(row => filters.every(filter => filter(row)));
          for (const { key, ascending } of orders) rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (ascending ? 1 : -1));
          rows = rows.slice(0, cap).map(row => Object.fromEntries(columns.map(key => [key, row[key]])));
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: options.failure === table ? { message: 'database unavailable' } : null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, console, require: name => {
    if (name === '@/lib/server/auth-worker') return { getAdminClient: () => admin };
    if (name === 'next/server') return { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), init) } };
    throw new Error(name);
  } });
  return { calls, get: token => exports.GET(new Request('https://fixture.test/api/cliente/raffle/winners', { headers: token ? { Authorization: `Bearer ${token}` } : {} })) };
}
function noCache(response) { assert.match(response.headers.get('Cache-Control'), /private, no-store/); assert.equal(response.headers.get('Vary'), 'Authorization'); }

test('every authenticated customer gets all 31 public winners without participation/rank filters', async () => {
  let expected;
  for (const customer of ['customer-with-tickets', 'customer-without-tickets', 'new-customer']) {
    const f = fixture(), response = await f.get(customer), body = await response.json();
    assert.equal(response.status, 200); noCache(response);
    assert.equal(body.winners.length, 31);
    assert.deepEqual(body.winners.map(w => w.position), Array.from({ length: 31 }, (_, i) => i + 1));
    assert.deepEqual(Object.keys(body.winners[0]), publicFields.split(','));
    assert.doesNotMatch(JSON.stringify(body), /private-id|private-phone|Archived/);
    if (expected) assert.deepEqual(body, expected); else expected = body;
    assert.deepEqual(f.calls.filter(c => c.table).map(c => c.table), ['raffles', 'raffle_public_winners']);
  }
});

test('missing or invalid sessions cannot read winners', async () => {
  for (const [options, token] of [[{}, null], [{ invalid: true }, 'invalid-token']]) {
    const f = fixture(options), response = await f.get(token);
    assert.equal(response.status, 401); noCache(response); assert.equal(f.calls.some(c => c.table), false);
  }
});

test('data errors are retryable errors rather than a false empty list', async () => {
  for (const failure of ['raffles', 'raffle_public_winners']) {
    const response = await fixture({ failure }).get('customer');
    assert.equal(response.status, 503); noCache(response); assert.equal((await response.json()).ok, false);
  }
});

test('no active raffle returns a noncached empty list, without exposing archived winners', async () => {
  const f = fixture({ tables: { raffles: [] } }), response = await f.get('customer');
  assert.equal(response.status, 200); noCache(response); assert.deepEqual(await response.json(), { ok: true, winners: [] });
  assert.equal(f.calls.some(c => c.table === 'raffle_public_winners'), false);
});
