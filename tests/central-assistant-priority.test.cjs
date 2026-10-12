const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');

function fixture() {
  const events = new Map(), calls = [], exports = {}, timers = new Map();
  const synthesis = { getVoices: () => [], speak: utterance => calls.push(['speak', utterance.text]), cancel: () => calls.push(['cancel']) };
  const window = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name), speechSynthesis: synthesis };
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  class Utterance { constructor(text) { this.text = text; } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/central/assistant/useCompanionInitiative.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => name === 'react' ? React : { ASSISTANT_SECTIONS: {} }, window, document,
    SpeechSynthesisUtterance: Utterance, setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout() {}, setInterval: (fn, ms) => { timers.set(ms, fn); return ms; }, clearInterval() {}, HTMLElement: class {} });
  let component;
  function Component(props) {
    exports.useCompanionInitiative({ ready: true, open: false, busy: false, mini: false, tab: 'central', pet: 'sol', workerId: 'worker',
      preferences: { sound: true, proactive: true, humor: true }, say() {}, bubble: 'Revisemos oportunidades', ...props });
    return null;
  }
  return {
    calls,
    mount: props => renderer.act(() => { component = renderer.create(React.createElement(Component, props)); }),
    update: props => renderer.act(() => component.update(React.createElement(Component, props))),
    unlock: () => renderer.act(() => events.get('pointerdown')?.()),
    tick: ms => renderer.act(() => timers.get(ms)?.()),
    unmount: () => renderer.act(() => component.unmount()),
  };
}

test('urgent reservation interrupts generic speech and speaks once per threshold, not per countdown or hidden bubble update', () => {
  const f = fixture();
  f.mount(); f.unlock();
  assert.deepEqual(f.calls, [['speak', 'Revisemos oportunidades']]);
  const urgent = { urgent: true, urgentAnnouncement: { key: 'reservation:one:10', text: 'Reserva en 10 minutos para Ana.' } };
  f.update(urgent);
  assert.deepEqual(f.calls.slice(-2), [['cancel'], ['speak', 'Reserva en 10 minutos para Ana.']]);
  const spoken = f.calls.length;
  f.update({ ...urgent, bubble: 'Sugerencia oculta', urgentAnnouncement: { ...urgent.urgentAnnouncement, text: 'Reserva en 9 minutos para Ana.' } });
  assert.equal(f.calls.length, spoken);
  f.update({ urgent: true, urgentAnnouncement: { key: 'reservation:one:5', text: 'Reserva en 5 minutos para Ana.' } });
  assert.deepEqual(f.calls.slice(-2), [['cancel'], ['speak', 'Reserva en 5 minutos para Ana.']]);
  f.unmount();
});

test('learned quiet suggestions stay in manual data but never trigger the automatic invitation', () => {
  const f = fixture(), suggested = [];
  const muted = { id: 'incident:quiet', title: 'Old incident', learning: { quiet: true } };
  const available = { id: 'followup:available', title: 'New followup' };
  const props = { bubble: '', suggestions: [muted], suggest: c => suggested.push(c.id), preferences: { sound: false, proactive: true } };
  f.mount(props); f.tick(14000); f.tick(10000);
  assert.deepEqual(suggested, []);
  f.update({ ...props, suggestions: [muted, available] }); f.tick(10000);
  assert.deepEqual(suggested, ['followup:available']);
  assert.equal(props.suggestions.length, 1, 'manual briefing is not mutated');
  f.unmount();
});

test('urgent reservations prevent even a positively learned suggestion from interrupting', () => {
  const f = fixture(), suggested = [];
  f.mount({ bubble: '', urgent: true, suggestions: [{ id: 'client:next', learning: { quiet: false } }], suggest: c => suggested.push(c.id), preferences: { sound: false, proactive: true } });
  f.tick(14000); f.tick(10000); assert.deepEqual(suggested, []); f.unmount();
});

test('urgent priority cancels generic speech even without an announcement and respects disabled sound', () => {
  const f = fixture();
  f.mount(); f.unlock();
  f.update({ urgent: true });
  assert.deepEqual(f.calls.at(-1), ['cancel']);
  const count = f.calls.length;
  f.update({ urgent: true, bubble: 'No se debe oír' });
  assert.equal(f.calls.length, count);
  f.update({ urgent: true, urgentAnnouncement: { key: 'one', text: 'Aviso silenciado' }, preferences: { sound: false, proactive: true } });
  assert.equal(f.calls.length, count);
  f.unmount();
});
