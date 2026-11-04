// Visual-state contracts only. No browser, network, user data or credits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const exportsObject = {};
const source = fs.readFileSync(path.join(__dirname, '../src/lib/oracle-guide-state.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject });
const { resolveOracleGuideAction } = exportsObject;
const state = (changes = {}) => ({ stage: 'result', loading: false, error: false, busy: '', oracleOpen: true, typing: false, speaking: false, moment: null, ...changes });

test('drafting is an attentive pose, never a submitted question or an answer', () => {
  assert.equal(resolveOracleGuideAction(state({ typing: true })), 'listening');
  assert.equal(resolveOracleGuideAction(state({ typing: true, moment: 'answer' })), 'listening');
  assert.equal(resolveOracleGuideAction(state()), 'rest');
});

test('a pending question supersedes a prior answer and ends only when the request state changes', () => {
  const pending = state({ busy: 'Consultando el Oráculo…', typing: true, moment: 'answer' });
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(resolveOracleGuideAction(pending), 'channeling');
  assert.equal(resolveOracleGuideAction({ ...pending, busy: '', typing: false, moment: 'answer' }), 'answer');
  assert.equal(resolveOracleGuideAction({ ...pending, busy: '', error: true }), 'recover');
});

test('reloads and failures never announce a stale successful answer', () => {
  assert.equal(resolveOracleGuideAction(state({ loading: true, moment: 'answer' })), 'idle');
  assert.equal(resolveOracleGuideAction(state({ error: true, moment: 'answer' })), 'recover');
  assert.equal(resolveOracleGuideAction(state({ error: true, busy: 'Consultando el Oráculo…' })), 'recover');
  assert.equal(resolveOracleGuideAction(state({ busy: 'Preparando pago…', moment: 'answer' })), 'idle');
});

test('closing the oracle returns to the reading or card selection, not the previous chat gesture', () => {
  assert.equal(resolveOracleGuideAction(state({ oracleOpen: false, moment: 'answer', typing: true })), 'reading');
  assert.equal(resolveOracleGuideAction(state({ oracleOpen: false, stage: 'select', moment: null })), 'offer');
  assert.equal(resolveOracleGuideAction(state({ oracleOpen: false, stage: 'ready', moment: null })), 'idle');
});

test('visual pending states distinguish shuffled cards, a reveal and a question', () => {
  assert.equal(resolveOracleGuideAction(state({ oracleOpen: false, busy: 'Barajando las cartas…' })), 'shuffle');
  assert.equal(resolveOracleGuideAction(state({ oracleOpen: false, busy: 'Revelando tu carta…' })), 'reveal');
  assert.equal(resolveOracleGuideAction(state({ oracleOpen: false, busy: 'Completando lectura…' })), 'reading');
});
