const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const base = path.join(__dirname, '..');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(base, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Map, Date, console: { error() {} }, require: name => {
    if (!(name in mocks)) throw Error(`Unexpected import: ${name}`);
    return mocks[name];
  } });
  return exports;
}

test('admin rune GET rejects unauthorized reads before data access and retrieves the exact requested ficha', async () => {
  let gate = { ok: false, error: 'FORBIDDEN' };
  const queries = [];
  const route = load('src/app/api/admin/client-runes/route.ts', {
    'next/server': { NextResponse: { json: (body, opts) => ({ body, ...opts }) } },
    '@/lib/client-runes': load('src/lib/client-runes.ts', {}),
    '@/lib/admin/require-admin': { requireAdmin: async () => gate },
  });
  const request = { url: 'https://example.test/api/admin/client-runes?cliente_id=' + id(10) };
  assert.equal((await route.GET(request)).status, 403);
  gate = { ok: false, error: 'NO_AUTH' };
  assert.equal((await route.GET(request)).status, 401);
  assert.equal(queries.length, 0);
  gate = { ok: true, admin: { from(table) {
    const entry = { table, filters: [] }; queries.push(entry);
    const data = table === 'crm_clientes' ? [{ id: id(10), nombre: 'Cliente concreto' }]
      : table === 'client_runes' ? [{ id: id(50), cliente_id: id(10), enabled: false, title: 'Privada', benefit: 'Ventaja guardada', updated_at: '2026-11-06T12:00:00Z' }]
        : [];
    const q = { select() { return q; }, order() { return q; }, limit() { return q; },
      eq(...args) { entry.filters.push(['eq', ...args]); return q; },
      in(...args) { entry.filters.push(['in', ...args]); return q; },
      then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); },
    };
    return q;
  } } };
  const result = await route.GET(request);
  assert.equal(result.status, 200);
  assert.deepEqual(queries[0].filters, [['eq', 'id', id(10)]]);
  assert.equal(JSON.stringify(queries[1].filters), JSON.stringify([['in', 'cliente_id', [id(10)]]]));
  assert.deepEqual(queries[2].filters, [['eq', 'cliente_id', id(10)]]);
  assert.equal(result.body.clients[0].rune.enabled, false);
  assert.match(result.headers['Cache-Control'], /private, no-store/);
  const beforeInvalid = queries.length;
  assert.equal((await route.GET({ url: 'https://example.test/api/admin/client-runes?cliente_id=bad' })).status, 400);
  assert.equal(queries.length, beforeInvalid);
});

test('an operation receipt cannot be reused for another customer or another administrator', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table workers(id uuid primary key,user_id uuid,role text,is_active boolean);
      create table crm_clientes(id uuid primary key);
      grant select on crm_clientes to service_role;
      create function tc_has_admin_access(u uuid) returns boolean language sql as $$ select exists(select 1 from public.workers where user_id=u and role='admin' and is_active) $$;`);
    await db.exec(fs.readFileSync(path.join(base, 'supabase/migrations/20261106223000_client_runes.sql'), 'utf8'));
    await db.query("insert into workers values($1,$2,'admin',true),($3,$4,'admin',true)", [id(1), id(101), id(2), id(102)]);
    await db.query('insert into crm_clientes values($1),($2)', [id(10), id(11)]);
    await db.exec('set role service_role');
    const save = (client, worker, user) => db.query('select tc_admin_set_client_rune($1,true,$2,$3,null,$4,$5,$6) as rune', [id(client), 'Obsidiana', 'Ventaja individual', id(20), id(worker), id(user)]);
    await save(10, 1, 101);
    await assert.rejects(save(11, 1, 101), /RUNE_OPERATION_REUSED/);
    await assert.rejects(save(10, 2, 102), /RUNE_OPERATION_REUSED/);
    assert.equal((await db.query('select count(*)::int as n from client_runes')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from client_rune_events')).rows[0].n, 1);
    assert.equal((await db.query('select cliente_id from client_runes')).rows[0].cliente_id, id(10));
  } finally { await db.close(); }
});
