const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/app/cliente/dashboard/page.tsx'), 'utf8');
const start = source.indexOf('  useEffect(() => {\n    if (!cliente?.id || cliente.onboarding_completado === true) {');
const end = source.indexOf('  useEffect(() => {\n    async function checkPasswordStatus()', start);
assert.ok(start !== -1 && end > start, 'The onboarding verification effect must be present');
const effectSource = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

async function runCheck({ completed = false, verified = true, fail = false, wrongClient = false, delay = false } = {}) {
  const state = { cliente: { id: 'client-1', onboarding_completado: completed }, open: true, message: '', requests: [] };
  let cleanup;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const scope = {
    cliente: state.cliente,
    useEffect: callback => { cleanup = callback(); },
    setShowOnboarding: value => { state.open = value; },
    setMsg: value => { state.message = value; },
    setCliente: update => { state.cliente = update(state.cliente); },
    sb: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } },
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      if (delay) await pending;
      return {
        ok: !fail,
        json: async () => ({
          ok: !fail,
          cliente_id: wrongClient ? 'client-2' : 'client-1',
          onboarding_completado: verified,
        }),
      };
    },
    AbortSignal,
    Date,
  };
  vm.createContext(scope);
  vm.runInContext(effectSource, scope);
  await new Promise(resolve => setImmediate(resolve));
  return { state, cleanup, release, settle: async () => { release(); await new Promise(resolve => setImmediate(resolve)); } };
}

test('a saved profile cannot reopen onboarding after a reload', async () => {
  const result = await runCheck({ verified: true });
  assert.equal(result.state.open, false);
  assert.equal(result.state.cliente.onboarding_completado, true);
  assert.equal(result.state.requests.length, 1);
  assert.match(result.state.requests[0].url, /verify=onboarding/);
  assert.equal(result.state.requests[0].options.cache, 'no-store');
});

test('an independently confirmed incomplete profile opens onboarding', async () => {
  const result = await runCheck({ verified: false });
  assert.equal(result.state.open, true);
  assert.equal(result.state.cliente.onboarding_completado, false);
});

test('a completed dashboard profile never needs an extra check', async () => {
  const result = await runCheck({ completed: true });
  assert.equal(result.state.open, false);
  assert.equal(result.state.requests.length, 0);
});

test('failed or mismatched verification does not force a client to register again', async () => {
  for (const options of [{ fail: true }, { wrongClient: true }]) {
    const result = await runCheck(options);
    assert.equal(result.state.open, false);
    assert.match(result.state.message, /comprobar si tu perfil/);
  }
});

test('an obsolete verification cannot reopen a wizard after account change', async () => {
  const result = await runCheck({ delay: true, verified: false });
  result.cleanup();
  await result.settle();
  assert.equal(result.state.open, false);
});
