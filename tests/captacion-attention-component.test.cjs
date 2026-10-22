const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const { act } = renderer;
function compile(file) { return ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText; }
const guide = {}, attention = {};
vm.runInNewContext(compile('src/lib/central-assistant.ts'), { exports: guide, Intl, Date });
vm.runInNewContext(compile('src/lib/captacion-attention.ts'), { exports: attention, Date });
const content = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(content).join('') : node ? content(node.children) : '';

test('urgent capture monitoring works before assistant load, wakes a minimized pet, preserves counts and stacks reservations', async () => {
  const exports = {}, snapshots = [], navigations = [], stored = new Map(), intervals = new Map(), timeout = new Map();
  let monitorOptions, serial = 0, tree;
  const items = [{ id: 'lead-test', cliente_id: 'client-test', nombre: 'Daisy', latest_meta_lead_at: new Date().toISOString() }];
  let pending = { items: [], notice: null, error: '', brand: 'celestial', refresh() {}, dismiss() { pending = { ...pending, notice: null }; } };
  const motion = { ref: { current: null }, highlight: null, dragging: false, moving: false, dragProps: {}, positionLabel: '', point() {}, dock() {} };
  const reservations = { reminder: { key: 'reserve', id: 'r', clientId: 'other', clientName: 'Reserva existente', tarotistName: 'Luna', minutesRemaining: 1, scheduledAt: new Date().toISOString() }, error: '', refresh() {}, dismiss() {} };
  const window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const document = { hidden: false, querySelector: () => null, querySelectorAll: () => [] };
  const addTimeout = (fn, ms) => { timeout.set(++serial, { fn, ms }); return serial; };
  vm.runInNewContext(compile('src/features/central/assistant/CentralCompanion.tsx'), {
    exports, window, document, console, Date, Intl, AbortController, AbortSignal,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    sessionStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) },
    setTimeout: addTimeout, clearTimeout: id => timeout.delete(id),
    setInterval: (fn, ms) => { intervals.set(++serial, { fn, ms }); return serial; }, clearInterval: id => intervals.delete(id),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    fetch: async () => { throw new Error('Assistant profile unavailable in this fixture'); },
    require(name) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
      if (name === '@/lib/central-assistant') return guide;
      if (name === '@/lib/captacion-attention') return attention;
      if (name === '@/lib/central-atlas') return { purchaseCelebrationMessage: () => '' };
      if (name === '@/lib/recovery-mission') return { recoveryMissionPhase: () => null };
      if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
      if (name === './useCaptacionAttention') return { useCaptacionAttention: options => { monitorOptions = options; return pending; } };
      if (name === './useReservationReminders') return { useReservationReminders: () => reservations };
      if (name === './useCompanionMotion') return { useCompanionMotion: () => motion };
      if (name === './useCompanionInitiative') return { useCompanionInitiative: () => ({ gesture: '', entertain() {}, hush() {} }) };
      if (name === './useRecoveryMission') return { useRecoveryMission: () => ({ mission: null }) };
      if (name === './useAtlasTasks') return { useAtlasTasks: () => ({ jobs: [] }) };
      if (name === './CompanionLearning') return { __esModule: true, default: () => null, useCompanionLearning: () => ({ summary: null }) };
      if (name === './CompanionCharacter') return { __esModule: true, default: props => React.createElement('character', props) };
      if (name === './AtlasTaskInbox') return { __esModule: true, default: () => null };
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      throw new Error(name);
    },
  });
  const props = { tab: 'crm', workerId: 'worker', captacionEnabled: true, onCaptacionAttentionChange: value => snapshots.push(value), onNavigate: value => navigations.push(value) };
  const update = async () => act(async () => { tree.update(React.createElement(exports.default, props)); });
  await act(async () => { tree = renderer.create(React.createElement(exports.default, props)); });
  try {
    assert.equal(monitorOptions.enabled, true, 'profile load failure must not disable operational alerts');
    assert.equal(monitorOptions.blocked, undefined, 'an existing reservation must not delay a new capture alert');
    const minimize = tree.root.findAllByType('button').find(node => node.props.title === 'Minimizar mascota');
    await act(async () => minimize.props.onClick());
    assert.ok(tree.root.findAllByType('button').some(node => node.props.title === 'Ampliar mascota'));
    pending = { ...pending, items, notice: { key: 'arrival', announcedAt: Date.now(), items } };
    await act(async () => monitorOptions.onReminder()); await update();
    assert.ok(tree.root.findAllByType('button').some(node => node.props.title === 'Minimizar mascota'), 'arrival expands the minimized companion');
    assert.match(content(tree.toJSON()), /Captación urgente/);
    assert.match(content(tree.toJSON()), /Reserva existente/);
    assert.equal(tree.root.findAllByType('aside').length, 2, 'urgent capture and reservation remain simultaneously accessible');
    assert.equal(snapshots.at(-1).count, 1);
    const close = tree.root.findAllByType('button').find(node => node.props['aria-label'] === 'Cerrar aviso hasta el próximo minuto');
    await act(async () => close.props.onClick()); await update();
    assert.equal(snapshots.at(-1).count, 1, 'closing the notice preserves the sidebar queue');
    pending = { ...pending, error: 'Sin actualizar' }; await update();
    assert.equal(snapshots.at(-1).count, 1); assert.equal(snapshots.at(-1).error, 'Sin actualizar');
    pending = { ...pending, notice: { key: 'repeat', announcedAt: Date.now(), items }, error: '' }; await update();
    const attend = tree.root.findAllByType('button').find(node => content(node).startsWith('Atender ahora'));
    await act(async () => attend.props.onClick());
    assert.deepEqual(navigations, ['captacion']); assert.equal(stored.get(attention.CAPTACION_FOCUS_LEAD), 'lead-test');
    assert.equal(snapshots.at(-1).count, 1, 'opening the contact does not claim it was managed');
  } finally { await act(async () => tree.unmount()); }
  assert.equal(snapshots.at(-1).count, 0); assert.equal(intervals.size, 0);
});
