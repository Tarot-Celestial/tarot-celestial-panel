const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const text = node => typeof node === 'string' ? node : node.children?.map(text).join('') || '';

function fixture() {
  const exports = {}, calls = [];
  let tree, blocked = null, failure = null;
  let payload = { ok: true, checks: [], subscription: { ready: false, subscribed: false, fields: [] }, webhookConfigured: false };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/admin/SocialInboxWebhookSetup.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, console, Error, require(name) {
    return name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : require(name);
  } });
  const api = async (url, init) => {
    calls.push({ url, init });
    if (blocked) await blocked;
    if (failure) throw new Error(failure);
    return url.includes('action=subscribe') ? { ok: true } : payload;
  };
  const act = async callback => renderer.act(async () => { callback?.(); await new Promise(resolve => setImmediate(resolve)); });
  return { calls,
    get text() { return text(tree.toJSON()); },
    payload(value) { payload = value; }, failure(value) { failure = value; }, block(value) { blocked = value; },
    async mount() { await act(() => { tree = renderer.create(React.createElement(exports.default, { api })); }); },
    async typePost(value) { await act(() => { tree.root.findByProps({id:'facebook-post-import'}).props.onChange({target:{value}}); }); },
    async click(label, twice = false) { await act(() => {
      const button = tree.root.findAllByType('button').find(node => text(node) === label);
      assert.ok(button); assert.equal(button.props.disabled, false);
      button.props.onClick(); if (twice) button.props.onClick();
    }); },
    async settle() { await act(); }, async close() { await act(() => tree.unmount()); },
  };
}

test('Instagram diagnostics explicitly report the missing subscription and webhook without claiming delivery', async () => {
  const f = fixture(); await f.mount(); assert.equal(f.calls.length, 0);
  await f.click('Comprobar Instagram');
  assert.match(f.text, /Suscripción de mensajes y comentarios pendiente/);
  assert.match(f.text, /Falta configurar la verificación del webhook/);
  assert.doesNotMatch(f.text, /Suscripción guardada y comprobada|recepción confirmada/i);
  assert.ok(f.calls.every(call => !call.init?.method)); await f.close();
});

test('Facebook diagnostics preserve unverified permissions and its distinct subscription contract', async () => {
  const f = fixture(); f.payload({ ok: true, configured: true, identity: { ok: true, name: 'Página de prueba' },
    permissions: { verified: false, missing: ['pages_messaging'] }, subscriptions: { ok: true, items: [] }, probes: [{ label: 'messenger', ok: false, code: 'PERMISSION_REQUIRED' }] });
  await f.mount(); await f.click('Comprobar Facebook');
  assert.match(f.calls[0].url, /facebook/); assert.match(f.text, /Permisos sin verificar/);
  assert.match(f.text, /Permisos pendientes: pages_messaging/); assert.match(f.text, /no tiene aplicaciones suscritas/);
  assert.match(f.text, /messenger: PERMISSION_REQUIRED/); await f.close();
});

test('a new failed check clears previous success instead of displaying stale confirmations', async () => {
  const f = fixture(); f.payload({ ok: true, checks: [], subscription: { ready: true, fields: ['comments', 'messages'] }, webhookConfigured: true });
  await f.mount(); await f.click('Comprobar Instagram'); assert.match(f.text, /Suscripción de mensajes y comentarios verificada/);
  f.failure('Conexión temporalmente no disponible.'); await f.click('Comprobar Instagram');
  assert.match(f.text, /Conexión temporalmente no disponible/); assert.doesNotMatch(f.text, /Suscripción de mensajes y comentarios verificada/);
  f.failure(null); f.payload({ ok: true }); await f.click('Comprobar Instagram');
  assert.match(f.text, /no devolvió un diagnóstico válido/); await f.close();
});

test('subscription requires the explicit button and rapid repeated clicks produce one request', async () => {
  const f = fixture(); let release; f.block(new Promise(resolve => { release = resolve; }));
  await f.mount(); await f.click('Activar recepción de Instagram', true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { confirmed: true });
  release(); await f.settle();
  assert.equal(f.calls.length, 2); assert.match(f.calls[1].url, /action=diagnostics/);
  assert.match(f.text, /La red confirmó la suscripción solicitada/);
  assert.match(f.text, /Falta configurar la verificación del webhook/); await f.close();
});

test('one provider failure preserves the other result and only selected safe diagnostic fields are rendered', async () => {
  const f = fixture(); f.payload({ ok: true, checks: [], subscription: { ready: true, fields: ['messages', 'comments'] },
    webhookConfigured: true, access_token: 'never-render-secret', raw_response: { customer_message: 'never-render-customer-content' } });
  await f.mount(); await f.click('Comprobar Instagram');
  f.failure('Facebook necesita reconectarse.'); await f.click('Comprobar Facebook');
  assert.match(f.text, /Suscripción de mensajes y comentarios verificada/);
  assert.match(f.text, /Facebook necesita reconectarse/);
  assert.doesNotMatch(f.text, /never-render/);
  f.failure('No se pudo comprobar Instagram.'); await f.click('Comprobar Instagram');
  assert.doesNotMatch(f.text, /Suscripción de mensajes y comentarios verificada/);
  assert.match(f.text, /Facebook necesita reconectarse/); assert.match(f.text, /No se pudo comprobar Instagram/);
  await f.close();
});

test('targeted Facebook post import uses an explicit button, one request and a truthful continuation receipt', async () => {
  const f=fixture(); f.payload({ok:true,processed:12,continuationQueued:true}); let release;
  f.block(new Promise(resolve=>{release=resolve;})); await f.mount(); await f.typePost(' 123_456 ');
  await f.click('Importar comentarios',true); assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'/api/central/facebook?action=sync-post'); assert.equal(f.calls[0].init.method,'POST');
  assert.deepEqual(JSON.parse(f.calls[0].init.body),{postId:'123_456'});
  release();await f.settle();assert.match(f.text,/12 comentarios revisados/);assert.match(f.text,/historial restante seguirá importándose/);
  assert.doesNotMatch(f.text,/12 comentarios nuevos/);await f.close();
});

test('post import rejects URLs and clears previous success on an unsuccessful receipt', async () => {
  const f=fixture();await f.mount();await f.typePost('https://facebook.com/post');await f.click('Importar comentarios');
  assert.equal(f.calls.length,0);assert.match(f.text,/Introduce el ID/);
  f.payload({ok:true,processed:1,continuationQueued:false});await f.typePost('123_456');await f.click('Importar comentarios');assert.match(f.text,/1 comentarios revisados/);
  f.payload({ok:true});await f.click('Importar comentarios');assert.match(f.text,/No se pudo confirmar la importación/);assert.doesNotMatch(f.text,/1 comentarios revisados/);
  await f.close();
});
