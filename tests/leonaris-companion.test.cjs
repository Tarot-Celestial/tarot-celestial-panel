const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require: name => { if (!(name in imports)) throw new Error(name); return imports[name]; } });
  return exports;
}
const guide = load('leo-guide.ts');
const lib = load('leonaris-companion.ts', { '@/lib/leo-guide': guide });
test('explicit memories normalize whitespace and reject overlong or absent content', () => {
  assert.equal(lib.normalizeLeonarisMemory('  Me gusta\n el oráculo.  '), 'Me gusta el oráculo.');
  assert.equal(lib.normalizeLeonarisMemory('x'.repeat(401)), null);
  assert.equal(lib.normalizeLeonarisMemory('😀'.repeat(400)).length, 800);
  assert.equal(lib.normalizeLeonarisMemory('   '), null);
  assert.equal(lib.normalizeLeonarisMemory({ content: 'memory' }), null);
});
test('only bounded answers with safe existing panel actions are accepted', () => {
  const answer = { id: '12345678-1234-4234-8234-123456789abc', title: 'Hola', message: 'Te acompaño.', mode: 'guided', actions: [] };
  assert.equal(lib.validLeonarisAnswer(answer), true);
  assert.equal(lib.validLeonarisAnswer({ ...answer, id: 'other-user' }), false);
  assert.equal(lib.validLeonarisAnswer({ ...answer, message: 'x'.repeat(4001) }), false);
  assert.equal(lib.validLeonarisAnswer({ ...answer, actions: [{ label: 'Salir', path: 'https://example.com', anchor: 'content', explanation: 'x' }] }), false);
});
test('favorites use supported context only and ignore malformed or negative scores', () => {
  const sections = lib.leonarisFavoriteSections({ interest_scores: { oracle: 5, ritual: 4, outside: 9000, ranks: -8, roulette: 'bad' }, visit_counts: { ritual: 8, ranks: 2, oracle: 1 } });
  assert.equal(sections.length, 3);
  assert.equal(sections[0].context, 'ritual');
  assert.equal(sections[1].context, 'oracle');
  assert.equal(sections[2].score, 2);
  assert.equal(lib.leonarisVisitCount({ visit_counts: { oracle: 2, ranks: 3, ritual: -1, noise: 'bad' } }), 5);
});
