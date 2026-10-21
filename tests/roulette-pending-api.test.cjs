const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(error) {
  const exports = {}, calls = [];
  class RouletteAccessError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const gate = { cliente: { id: 'fixture-customer' }, admin: { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: null, error };
  } } };
  const source = fs.readFileSync(path.join(__dirname, '../src/app/api/cliente/ruleta/route.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Request, Response, console: { error() {} },
    require(name) {
      if (name === 'next/server') return { NextResponse: Response };
      if (name === '@/lib/server/ruleta-access') return { RouletteAccessError, rouletteClient: async () => gate };
      throw new Error(name);
    },
  });
  const spin = { spin_id: '10000000-0000-4000-8000-000000000001', level: 1 };
  return { calls, spin, run: () => exports.POST(new Request('https://fixture.invalid/api/cliente/ruleta', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spin),
  })) };
}

test('only a definitive invalid spin identifies the pending operation as removable', async () => {
  for (const code of ['INVALID_SPIN', 'LEGACY_SPIN_ALREADY_USED']) {
    const h = harness({ code: 'P0001', message: code });
    const response = await h.run();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, code);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].args.p_spin_id, h.spin.spin_id);
    assert.equal(h.calls[0].args.p_cliente_id, 'fixture-customer');
  }
});

test('campaign pauses, access restrictions and database failures preserve recovery without fallback spins', async () => {
  for (const [message, code, status] of [
    ['ROULETTE_NO_ACTIVE_CAMPAIGN', 'P0001', 409],
    ['ROULETTE_NO_REWARDS', 'P0001', 409],
    ['RANK_BENEFIT_FORBIDDEN', 'P0001', 403],
    ['foreign key violation', '23503', 503],
  ]) {
    const h = harness({ message, code });
    const response = await h.run();
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, undefined);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].args.p_spin_id, h.spin.spin_id);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
});
