const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/cliente/planet-textures.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const turn = () => new Promise(resolve => setImmediate(resolve));
const bitmap = () => ({ width: 4096, height: 4096, closed: 0, close() { this.closed++; } });
const response = id => ({ ok: true, blob: async () => ({ id }) });
function helpers(fetch, createImageBitmap) {
  const exports = {};
  vm.runInNewContext(source, { exports, require, fetch, createImageBitmap, AbortController, DOMException });
  return exports;
}

test('two hemispheres install as one 8K detail set and dispose every bitmap/texture once', async () => {
  const images = [bitmap(), bitmap()];
  const loader = helpers(async id => response(Number(id)), async blob => images[blob.id]);
  const detail = await loader.loadPlanetDetail(['0', '1'], new AbortController().signal, 16);
  assert.equal(detail.width, 8192);
  assert.equal(detail.textures.length, 2);
  let disposed = 0;
  for (const texture of detail.textures) {
    assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping);
    assert.equal(texture.flipY, false);
    assert.equal(texture.anisotropy, 4);
    texture.addEventListener('dispose', () => disposed++);
  }
  detail.dispose(); detail.dispose();
  assert.equal(disposed, 2);
  assert.deepEqual(images.map(image => image.closed), [1, 1]);
});

test('a failed second hemisphere releases the first without installing partial detail', async () => {
  const first = bitmap();
  let rejectSecond;
  const loader = helpers(id => id === 'first' ? Promise.resolve(response(id)) : new Promise((_, reject) => { rejectSecond = reject; }), async () => first);
  const loading = loader.loadPlanetDetail(['first', 'second'], new AbortController().signal, 1);
  const rejected = assert.rejects(loading, /missing hemisphere/);
  await turn();
  assert.equal(first.closed, 0);
  rejectSecond(new Error('missing hemisphere'));
  await rejected;
  assert.equal(first.closed, 1);
});

test('navigation during the second decode releases both halves, including the late bitmap', async () => {
  const images = [bitmap(), bitmap()];
  let finishSecond;
  const request = new AbortController();
  const loader = helpers(async id => response(Number(id)), blob => blob.id === 0 ? Promise.resolve(images[0]) : new Promise(resolve => { finishSecond = resolve; }));
  const loading = loader.loadPlanetDetail(['0', '1'], request.signal, 1);
  const rejected = assert.rejects(loading, { name: 'AbortError' });
  await turn();
  request.abort(); finishSecond(images[1]);
  await rejected;
  assert.deepEqual(images.map(image => image.closed), [1, 1]);
});
