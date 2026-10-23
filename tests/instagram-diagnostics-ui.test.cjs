const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');

const content = node => typeof node === 'string' ? node : node.children?.map(content).join('') || '';

function fixture({ provider = 'instagram', connected = true } = {}) {
  const requests = [], params = new URLSearchParams();
  let tree, result = { ok: true, checks: [{ label: 'Comentarios con cabecera', ok: true, count: 0 }, { label: 'Comentarios con parámetro', ok: true, count: 1 }, { label: 'Publicaciones', ok: false, code: 'META_PERMISSION' }], postId: '18107808317369936', access_token: 'must-never-render' }, blocker;
  const imports = {
    'next/navigation': { useSearchParams: () => params },
    'next/dynamic': { default: () => () => null },
    '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'test-admin-session' } } }) } }) },
    './SocialChannelAdminPanel.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) },
    './TarotVideoStudio': { default: () => null },
    'lucide-react': new Proxy({}, { get: (_, key) => props => React.createElement('span', { ...props, 'data-icon': key }) }),
  };
  const webhookExports = {};
  const webhookCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/admin/SocialInboxWebhookSetup.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(webhookCode, { exports: webhookExports, Error, console, require: name => name in imports ? imports[name] : require(name) });
  imports['./SocialInboxWebhookSetup'] = webhookExports;
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/admin/SocialChannelAdminPanel.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in imports ? imports[name] : require(name), Date, Intl, URL, URLSearchParams, console,
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      let body = { ok: true, items: [] };
      if (url.includes('/status')) body = { ok: true, connections: { [provider]: connected ? { provider, username: 'tarotcelestialof' } : null }, configured: { [provider]: true } };
      if (url.includes('action=diagnostics')) { if (blocker) await blocker; body = result; }
      return { ok: body.ok !== false, json: async () => body };
    },
  });
  const act = async callback => renderer.act(async () => { callback(); await new Promise(resolve => setImmediate(resolve)); });
  const button = label => tree.root.findAllByType('button').find(node => content(node).includes(label));
  return {
    requests, button,
    get text() { return content(tree.root); },
    get diagnostics() { return requests.filter(request => request.url.includes('action=diagnostics')); },
    async mount() { await act(() => { tree = renderer.create(React.createElement(exports.default, { provider })); }); },
    async click(label) { const target = button(label); assert.ok(target, label); assert.equal(Boolean(target.props.disabled), false); await act(() => target.props.onClick()); },
    async settle() { await act(() => {}); },
    setResult(value) { result = value; }, block(value) { blocker = value; },
    async unmount() { await act(() => tree.unmount()); },
  };
}

test('administrator explicitly checks the inbox with an authenticated GET and sees only safe result fields', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Conexión'); assert.equal(f.diagnostics.length, 0);
    await f.click('Comprobar bandeja');
    assert.equal(f.diagnostics.length, 1);
    assert.equal(f.diagnostics[0].method, 'GET');
    assert.equal(f.diagnostics[0].headers.Authorization, 'Bearer test-admin-session');
    assert.equal(f.diagnostics[0].cache, 'no-store');
    assert.match(f.text, /Correcto · 0 resultados/); assert.match(f.text, /Correcto · 1 resultado/);
    assert.match(f.text, /Error · META_PERMISSION/); assert.match(f.text, /18107808317369936/);
    assert.doesNotMatch(f.text, /must-never-render|test-admin-session/);
  } finally { await f.unmount(); }
});

test('a pending diagnosis disables its button and failure permits a fresh check', async () => {
  const f = fixture(); await f.mount(); let release;
  try {
    await f.click('Conexión'); f.block(new Promise(resolve => { release = resolve; }));
    f.setResult({ ok: false, error: 'No se pudo comprobar la conexión.' });
    await f.click('Comprobar bandeja'); assert.equal(f.button('Comprobando bandeja').props.disabled, true);
    release(); await f.settle(); assert.match(f.text, /No se pudo comprobar la conexión/);
    assert.equal(f.button('Comprobar bandeja').props.disabled, false);
    f.setResult({ ok: true, checks: [{ label: 'Publicaciones', ok: true, count: 8 }], postId: null });
    await f.click('Comprobar bandeja'); assert.match(f.text, /Correcto · 8 resultados/);
    assert.doesNotMatch(f.text, /No se pudo comprobar la conexión|Publicación comprobada:/);
  } finally { if (release) release(); await f.unmount(); }
});

test('the diagnostic action is unavailable for disconnected Instagram and absent for TikTok', async () => {
  for (const options of [{ connected: false }, { provider: 'tiktok' }]) {
    const f = fixture(options); await f.mount();
    try {
      await f.click('Conexión');
      if (options.provider === 'tiktok') assert.equal(f.button('Comprobar bandeja'), undefined);
      else assert.equal(f.button('Comprobar bandeja').props.disabled, true);
      assert.equal(f.diagnostics.length, 0);
    } finally { await f.unmount(); }
  }
});
