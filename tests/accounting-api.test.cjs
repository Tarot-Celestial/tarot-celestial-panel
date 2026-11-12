const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const uid = '10000000-0000-4000-8000-000000000001';
const entryId = '10000000-0000-4000-8000-000000000002';
const optionId = '10000000-0000-4000-8000-000000000003';
const income = () => ({ id: entryId, kind: 'income', account: 'celestial', currency: 'EUR', amount_cents: 1099, occurred_on: '2026-11-12', category_id: optionId, method_id: optionId, description: 'Ingreso de prueba' });
const names = {
  snapshot: 'src/app/api/admin/contabilidad/route.ts',
  entry: 'src/app/api/admin/contabilidad/movimientos/route.ts',
  void: 'src/app/api/admin/contabilidad/movimientos/anular/route.ts',
  option: 'src/app/api/admin/contabilidad/opciones/route.ts',
};

function fixture(options = {}) {
  const calls = [];
  let accessCalls = 0;
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  const admin = { async rpc(name, input) {
    calls.push({ name, input });
    if (options.error) return { data: null, error: options.error };
    if (Object.hasOwn(options, 'data')) return { data: options.data, error: null };
    if (name === 'accounting_snapshot') return { data: { entries: [], categories: [], methods: [] }, error: null };
    if (name === 'accounting_post_entry') return { data: { entry: { ...input.p_entry, created_by: input.p_actor, voided_at: null }, replayed: !!options.replayed }, error: null };
    if (name === 'accounting_void_entry') return { data: { entry: { id: input.p_id, voided_at: '2026-11-12T12:00:00Z', void_reason: input.p_reason }, replayed: !!options.replayed }, error: null };
    if (name === 'accounting_upsert_option') return { data: { option: { id: optionId, ...input.p_option } }, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  } };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { exports, Error, Date, JSON, Array, Object, Number, String, Uint8Array, TextDecoder, Request, Response, console: { error() {} }, require(name) {
      if (name === '@/lib/server/accounting-access') return {
        accountingJson: json,
        accountingWriteGuard: req => options.originDenied ? json({ ok: false, error: 'Origen no autorizado.' }, 403) : null,
        requireAccountingAccess: async () => {
          accessCalls++;
          if (options.throwAuth) throw new Error('private-auth-detail');
          return options.denied ? { ok: false, response: json({ ok: false, error: 'Acceso denegado.' }, options.denied) } : { ok: true, admin, authUserId: uid };
        },
      };
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      throw new Error(`Unexpected dependency: ${name}`);
    } }, { filename: file });
    return exports;
  }
  const request = (kind, body, raw = false) => new Request(`http://localhost/api/admin/contabilidad${kind === 'snapshot' ? '' : '/' + kind}`, {
    method: kind === 'snapshot' ? 'GET' : 'POST', headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json', Origin: 'http://localhost' },
    ...(kind === 'snapshot' ? {} : { body: raw ? body : JSON.stringify(body) }),
  });
  return { calls, get accessCalls() { return accessCalls; }, load, request, async invoke(kind, body, raw) { const module = load(names[kind]); return (kind === 'snapshot' ? module.GET : module.POST)(request(kind, body, raw)); } };
}

test('all financial endpoints require both admin session and accounting unlock before any DB call', async () => {
  for (const denied of [401, 403, 423]) for (const kind of Object.keys(names)) {
    const f = fixture({ denied });
    const response = await f.invoke(kind, income());
    assert.equal(response.status, denied);
    assert.equal(f.calls.length, 0);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

test('mutations reject CSRF before access or writes', async () => {
  for (const kind of ['entry', 'void', 'option']) {
    const f = fixture({ originDenied: true });
    assert.equal((await f.invoke(kind, income())).status, 403);
    assert.equal(f.calls.length, 0); assert.equal(f.accessCalls, 0);
  }
});

test('snapshot has fresh no-store data and no arbitrary row limit or caller-supplied identity', async () => {
  const entries = Array.from({ length: 1100 }, (_, i) => ({ id: String(i) }));
  const f = fixture({ data: { entries, categories: [], methods: [] } });
  const response = await f.invoke('snapshot'); const body = await response.json();
  assert.equal(body.entries.length, 1100); assert.ok(body.updatedAt);
  assert.equal(f.calls[0].name, 'accounting_snapshot'); assert.equal(f.calls[0].input.p_actor, uid);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('entry validates all money and cross-account fields before DB access', async () => {
  const invalid = [{ amount_cents: 10.1 }, { amount_cents: '100' }, { amount_cents: 0 }, { amount_cents: -100 }, { currency: 'GBP' }, { occurred_on: '2026-02-30' }, { kind: '__proto__' }, { id: 'not-a-uuid' }, { category_id: null }, { method_id: null }, { description: 'x' }, { kind: 'transfer', category_id: null, to_account: 'celestial' }];
  for (const patch of invalid) {
    const f = fixture(); assert.equal((await f.invoke('entry', { ...income(), ...patch })).status, 400); assert.equal(f.calls.length, 0);
  }
});

test('entry actor cannot be forged; normalized idempotency key sent unchanged and retry marked', async () => {
  const f = fixture({ replayed: true });
  const response = await f.invoke('entry', { ...income(), description: '  Entrada real  ', created_by: 'attacker', p_actor: 'attacker', voided_at: 'forged' });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(body.replayed, true);
  const call = f.calls[0]; assert.equal(call.input.p_actor, uid); assert.equal(call.input.p_entry.id, entryId);
  assert.equal(call.input.p_entry.description, 'Entrada real');
  for (const field of ['created_by', 'p_actor', 'voided_at']) assert.equal(field in call.input.p_entry, false);
});

test('one transfer is one atomic RPC, not an income and expense pair', async () => {
  const f = fixture();
  assert.equal((await f.invoke('entry', { ...income(), kind: 'transfer', category_id: null, to_account: 'leonaris' })).status, 200);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].input.p_entry.kind, 'transfer');
  assert.equal(f.calls[0].input.p_entry.to_account, 'leonaris');
});

test('no success if database did not return exact saved entry or verified void', async () => {
  for (const data of [null, {}, { entry: null }, { entry: { id: optionId } }]) {
    const f = fixture({ data }); assert.equal((await f.invoke('entry', income())).status, 503);
  }
  const f = fixture({ data: { entry: { id: entryId, voided_at: null } } });
  assert.equal((await f.invoke('void', { id: entryId, reason: 'Duplicado' })).status, 503);
});

test('void is explicit, reasoned and retains auditable result', async () => {
  for (const body of [{ id: entryId }, { id: entryId, reason: 'x' }, { id: entryId, reason: 'x'.repeat(501) }, { id: 'bad', reason: 'Duplicada' }]) {
    const f = fixture(); assert.equal((await f.invoke('void', body)).status, 400); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); const result = await (await f.invoke('void', { id: entryId, reason: '  Duplicado  ' })).json();
  assert.ok(result.entry.voided_at); assert.equal(result.entry.void_reason, 'Duplicado'); assert.equal(f.calls[0].input.p_actor, uid);
});

test('options can be added and archived only after validated inputs', async () => {
  const f = fixture();
  assert.equal((await f.invoke('option', { kind: 'method', name: '  PayPal  ', active: false })).status, 200);
  assert.equal(f.calls[0].input.p_option.name, 'PayPal'); assert.equal(f.calls[0].input.p_option.active, false);
  for (const body of [{ kind: 'x', name: 'Other' }, { kind: 'income', name: 'a' }, { kind: 'method', name: 'Test', active: 'false' }]) {
    const bad = fixture(); assert.equal((await bad.invoke('option', body)).status, 400); assert.equal(bad.calls.length, 0);
  }
});

test('malformed, oversized and primitive request bodies are rejected safely', async () => {
  for (const body of ['null', '[]', '42', '{broken', JSON.stringify({ x: 'x'.repeat(17000) })]) {
    const f = fixture(); assert.equal((await f.invoke('entry', body, true)).status, 400); assert.equal(f.calls.length, 0);
  }
});

test('known conflicts are actionable, unknown DB/auth errors never leak private details', async () => {
  for (const [message, status] of [['OPERATION_CONFLICT', 409], ['INSUFFICIENT_VAULT', 409], ['FORBIDDEN', 403], ['INVALID_ENTRY', 400]]) {
    const f = fixture({ error: { message } }); assert.equal((await f.invoke('entry', income())).status, status);
  }
  const secret = 'DATABASE_PASSWORD_DO_NOT_LEAK';
  const f = fixture({ error: { code: 'secret-code', message: secret } }); const r = await f.invoke('snapshot');
  assert.equal(r.status, 503); assert.equal((await r.text()).includes(secret), false);
  const auth = fixture({ throwAuth: true }); const a = await auth.invoke('snapshot');
  assert.equal(a.status, 503); assert.equal((await a.text()).includes('private-auth-detail'), false);
});
