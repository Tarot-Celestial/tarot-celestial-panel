const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

function loadAccess() {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'src/lib/panel-access.ts'), 'utf8')), { exports, Error });
  return exports;
}
const access = loadAccess();

function realEffect(file, marker) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  (function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes(marker)) effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(effect, `Missing effect ${marker} in ${file}`);
  return effect;
}

const gates = [
  ['src/app/panel-central/page.tsx', 'central'],
  ['src/app/panel-tarotista/page.tsx', 'tarotista'],
  ['src/app/admin/cerebro/page.tsx', 'admin'],
];

function gateFixture(file, loadIdentity) {
  const exports = {}, state = { authorized: false, error: null }, redirects = [];
  vm.runInNewContext(compile(`exports.effect = ${realEffect(file, 'loadPanelIdentity(sb)')}`), {
    exports, Error, sb: {}, loadPanelIdentity: loadIdentity,
    panelSessionRejected: access.panelSessionRejected, panelPathForRole: access.panelPathForRole,
    redirectToLogin: reason => redirects.push(`/login?reason=${reason}`),
    window: { location: { replace: destination => redirects.push(destination) } },
    // A previous account's UI role must never authorize this account.
    sessionStorage: { getItem: key => key === 'tc_admin_role' ? 'admin' : String(Date.now()), setItem() {} },
    setAccessError: error => { state.error = error; },
    setOk: value => { state.authorized = value; }, setAuthorized: value => { state.authorized = value; },
    getMonthFromUrl: () => '2026-10', setMonth() {},
  });
  return { effect: exports.effect, state, redirects };
}

for (const [file, role] of gates) {
  test(`${role} gate preserves session but remains locked on outage, then permits a verified retry`, async () => {
    let attempts = 0;
    const fixture = gateFixture(file, async () => {
      attempts++;
      if (attempts === 1) throw new access.PanelAccessError('ACCESS_SERVICE_UNAVAILABLE', 'Servicio temporalmente no disponible', 503);
      return { ok: true, role };
    });
    fixture.effect(); await settle();
    assert.equal(attempts, 1);
    assert.equal(fixture.state.authorized, false);
    assert.match(fixture.state.error, /temporalmente/);
    assert.deepEqual(fixture.redirects, []);
    fixture.effect(); await settle();
    assert.equal(attempts, 2);
    assert.equal(fixture.state.authorized, true);
    assert.equal(fixture.state.error, null);
    assert.deepEqual(fixture.redirects, []);
  });

  test(`${role} gate still rejects invalid sessions and disabled workers`, async () => {
    for (const [code, status] of [['INVALID_SESSION', 401], ['WORKER_DISABLED', 403]]) {
      const fixture = gateFixture(file, async () => { throw new access.PanelAccessError(code, 'Acceso denegado', status); });
      fixture.effect(); await settle();
      assert.equal(fixture.state.authorized, false);
      assert.equal(fixture.redirects.length, 1);
      assert.match(fixture.redirects[0], /^\/login/);
    }
  });

  test(`${role} gate routes verified alternative roles and ignores stale results after unmount`, async () => {
    const alternative = role === 'admin' ? 'central' : 'admin';
    const fixture = gateFixture(file, async () => ({ role: alternative }));
    fixture.effect(); await settle();
    assert.equal(fixture.state.authorized, false);
    assert.deepEqual(fixture.redirects, [access.panelPathForRole(alternative)]);
    let finish;
    const disposed = gateFixture(file, () => new Promise(resolve => { finish = resolve; }));
    disposed.effect()(); finish({ role }); await settle();
    assert.equal(disposed.state.authorized, false);
    assert.deepEqual(disposed.redirects, []);
  });
}

test('tarotista ignores initial null session notifications but honors an explicit sign-out', () => {
  const exports = {}, location = { href: '/panel-tarotista' };
  let notify, unsubscribed = false;
  vm.runInNewContext(compile(`exports.effect = ${realEffect('src/app/panel-tarotista/page.tsx', 'onAuthStateChange')}`), {
    exports, window: { location },
    sb: { auth: { onAuthStateChange(callback) { notify = callback; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; } } },
  });
  const cleanup = exports.effect();
  notify('INITIAL_SESSION', null);
  assert.equal(location.href, '/panel-tarotista');
  notify('SIGNED_OUT', null);
  assert.equal(location.href, '/login');
  cleanup(); assert.equal(unsubscribed, true);
});
