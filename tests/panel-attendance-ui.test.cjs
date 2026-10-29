const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), Renderer = require('react-test-renderer');

function load(file, mocks, globals) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => mocks[name] || require(name), process: { env: {} }, ...globals });
  return exports;
}
function clock() {
  let now = Date.parse('2026-10-28T22:00:00Z');
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const timers = new Map(), listeners = new Map(); let id = 0;
  const window = {
    setInterval(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearInterval(key) { timers.delete(key); },
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(key) { timers.delete(key); },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
  };
  return { Date: FakeDate, window, timers, set(value) { now = value; }, now: () => now,
    fire(name, value) { for (const fn of listeners.get(name) || []) fn(value); },
    tick(ms) { for (const timer of timers.values()) if (timer.ms === ms) timer.fn(); },
  };
}

test('gate blocks content and body portals; unlocking restores portal and keyboard availability', async () => {
  const time = clock();
  class Element { constructor() { this.inert = false; this.tagName = 'DIV'; } contains(other) { return other === this; } blur() { this.blurred = true; } }
  const portal = new Element(), previousFocus = new Element(); let content, gate;
  const document = { body: { children: [portal] }, activeElement: previousFocus };
  let refreshes = 0;
  let attendance = { online: false, status: 'offline', sessionId: null, loading: false, error: null,
    refreshAttendance: async () => { refreshes++; }, changeAttendance: async () => {}, keepAttendanceActive: async () => {} };
  const Component = load('src/components/attendance/PanelAccessGate.tsx', {
    'next/navigation': { usePathname: () => '/admin/cerebro' }, '@/hooks/useAttendance': { useAttendance: () => attendance },
    '@/lib/supabase-browser': {}, '@/lib/attendance/panel-session': { isPanelPath: value => value.startsWith('/admin') },
    './PanelAccessGate.module.css': { default: {} },
  }, { ...time, document, HTMLElement: Element, MutationObserver: class { observe() {} disconnect() {} } }).default;
  let tree;
  await Renderer.act(async () => {
    tree = Renderer.create(React.createElement(Component, {}, React.createElement('button', {}, 'Editar')),
      { createNodeMock(node) {
        if (node.props['data-panel-workspace']) { content = new Element(); content.inert = true; document.body.children.push(content); return content; }
        if (node.props.role === 'dialog') { gate = new Element(); document.body.children.push(gate); return gate; }
        return null;
      } });
  });
  assert.equal(tree.root.findByProps({ 'data-panel-workspace': true }).props.inert, '');
  assert.equal(portal.inert, true); assert.equal(previousFocus.blurred, true);
  assert.equal(tree.root.findAllByType('button').filter(node => node.children.includes('Conectado')).length, 1);
  attendance = { ...attendance, online: true, status: 'working', sessionId: 'session-a', serverNow: new Date(time.now()).toISOString(), expiresAt: new Date(time.now() + 600000).toISOString() };
  // The host renderer removes inert before passive effect cleanup. This catches
  // restoring the wrapper's old true value after React has already unlocked it.
  content.inert = false;
  await Renderer.act(async () => tree.update(React.createElement(Component, {}, React.createElement('button', {}, 'Editar'))));
  assert.equal(tree.root.findByProps({ 'data-panel-workspace': true }).props.inert, undefined);
  assert.equal(portal.inert, false); assert.equal(content.inert, false);
  time.set(time.now() + 600000);
  await Renderer.act(async () => time.tick(1000));
  assert.equal(tree.root.findByProps({ 'data-panel-workspace': true }).props.inert, '');
  assert.equal(refreshes, 1);
  await Renderer.act(async () => tree.unmount());
});

test('polling and reload never become activity; trusted interaction and a matching other tab do', async () => {
  const time = clock(), start = time.now(), writes = [], requests = [];
  const listeners = new Map();
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  let state = { ok: true, worker: { id: 'worker-a', role: 'tarotista' }, online: true, status: 'working', session_id: 'session-a',
    session_started_at: new Date(start).toISOString(), last_manual_activity_at: new Date(start).toISOString(), last_activity_at: new Date(start).toISOString(),
    expires_at: new Date(start + 600000).toISOString(), server_now: new Date(start).toISOString() };
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) },
    from: () => ({ select() { return this; }, eq: async () => ({ count: 0 }) }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} };
  const fetch = async (url, options) => {
    if (options?.method === 'POST') requests.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ ...state, server_now: new Date(time.now()).toISOString() }) };
  };
  const provider = load('src/providers/OpsProvider.tsx', {
    'next/navigation': { usePathname: () => '/panel-tarotista' }, '@/lib/supabase-browser': { supabaseBrowser: () => sb },
    '@/lib/attendance/panel-session': { isPanelPath: () => true, PANEL_HEARTBEAT_MS: 30000 },
  }, { ...time, document, fetch, localStorage: { setItem: (key, value) => writes.push([key, value]) } });
  let context, tree;
  function Child() { context = provider.useOps(); return null; }
  await Renderer.act(async () => { tree = Renderer.create(React.createElement(provider.OpsProvider, {}, React.createElement(Child))); });
  await Renderer.act(async () => time.tick(1500));
  time.set(start + 180000);
  await Renderer.act(async () => context.refreshAttendance());
  await Renderer.act(async () => time.tick(30000));
  assert.equal(requests.at(-1).activity_at, new Date(start).toISOString());
  await Renderer.act(async () => time.fire('pointermove', { isTrusted: false }));
  await Renderer.act(async () => time.fire('scroll', { isTrusted: true }));
  await Renderer.act(async () => time.tick(30000));
  assert.equal(requests.at(-1).activity_at, new Date(start).toISOString());
  await Renderer.act(async () => time.fire('keydown', { isTrusted: true }));
  await Renderer.act(async () => time.tick(30000));
  assert.equal(requests.at(-1).activity_at, new Date(time.now()).toISOString());
  time.set(start + 200000);
  time.fire('storage', { key: 'tc-panel-activity-v1:worker-a', newValue: JSON.stringify({ session: 'old-session', at: time.now() }) });
  await Renderer.act(async () => time.tick(30000));
  assert.equal(requests.at(-1).activity_at, new Date(start + 180000).toISOString());
  time.fire('storage', { key: 'tc-panel-activity-v1:worker-a', newValue: JSON.stringify({ session: 'session-a', at: time.now() }) });
  await Renderer.act(async () => time.tick(30000));
  assert.equal(requests.at(-1).activity_at, new Date(time.now()).toISOString());
  state={...state,consultation_started_at:new Date(time.now()).toISOString(),consultation_until:new Date(time.now()+3600000).toISOString(),consultation_source:'self_reported_external_call'};
  await Renderer.act(async () => context.changeAttendance('consultation_start'));
  assert.equal(requests.at(-1).event_type,'consultation_start');assert.equal(requests.at(-1).session_id,'session-a');
  assert.equal(context.attendance.workerRole,'tarotista');assert.equal(context.attendance.consultationSource,'self_reported_external_call');
  assert.equal(context.attendance.consultationUntil,state.consultation_until);
  state = { ...state, online: false, status: 'offline', session_id: null };
  time.set(start + 210000);
  await Renderer.act(async () => time.fire('storage', { key: 'tc-panel-state-v1:worker-a', newValue: '{}' }));
  const count = requests.length;
  await Renderer.act(async () => time.tick(30000));
  assert.equal(requests.length, count);
  assert.ok(writes.some(([key]) => key === 'tc-panel-activity-v1:worker-a'));
  await Renderer.act(async () => tree.unmount());
});

test('tarotista manual consultation controls use explicit actions, warn at 90 seconds and lock on expiry without Auth logout',async()=>{
  const time=clock(),start=time.now(),actions=[];let signOuts=0,refreshes=0;
  const measuredStyles=new Map();let measuredHeight=108;
  class Element { constructor(){this.inert=false;this.tagName='DIV';this.style={setProperty:(key,value)=>measuredStyles.set(key,value),removeProperty:key=>measuredStyles.delete(key)};} contains(other){return other===this;} blur(){} getBoundingClientRect(){return {height:measuredHeight};} }
  const document={body:{children:[]},activeElement:null};
  let attendance={online:true,status:'working',workerRole:'tarotista',sessionId:'session-a',serverNow:new Date(start).toISOString(),expiresAt:new Date(start+600000).toISOString(),
    consultationStartedAt:null,consultationUntil:null,consultationSource:null,error:null,loading:false,
    changeAttendance:async action=>{actions.push(action);},refreshAttendance:async()=>{refreshes++;},keepAttendanceActive:async()=>{actions.push('keep');}};
  const helper=load('src/lib/attendance/panel-session.ts',{},{});
  const Component=load('src/components/attendance/PanelAccessGate.tsx',{
    'next/navigation':{usePathname:()=>'/panel-tarotista'},'@/hooks/useAttendance':{useAttendance:()=>attendance},
    '@/lib/supabase-browser':{supabaseBrowser:()=>({auth:{signOut:async()=>{signOuts++;}}})},
    '@/lib/attendance/panel-session':helper,'./PanelAccessGate.module.css':{default:{}},
  },{...time,document,HTMLElement:Element,MutationObserver:class{observe(){}disconnect(){}}}).default;
  const render=()=>React.createElement(Component,{},React.createElement('button',{},'Abrir pestaña'));
  let tree;await Renderer.act(async()=>{tree=Renderer.create(render(),{createNodeMock:()=>new Element()});});
  const button=label=>tree.root.findAllByType('button').find(node=>node.children.includes(label));
  const workspace=tree.root.findByProps({'data-panel-workspace':true});
  assert.equal(workspace.children[0].props.role,'status','consultation reserves its own row before the panel content');
  assert.equal(workspace.children[1].children[0],'Abrir pestaña');
  assert.equal(measuredStyles.get('--panel-consultation-height'),'108px','sticky header is offset by the measured controls height');
  measuredHeight=164;time.fire('resize');
  assert.equal(measuredStyles.get('--panel-consultation-height'),'164px','wrapped mobile controls reserve their actual height');
  await Renderer.act(async()=>button('Estoy en consulta (60 min)').props.onClick());
  assert.deepEqual(actions,['consultation_start']);
  attendance={...attendance,consultationStartedAt:new Date(start).toISOString(),consultationUntil:new Date(start+3600000).toISOString(),consultationSource:'self_reported_external_call',expiresAt:new Date(start+3600000).toISOString()};
  await Renderer.act(async()=>tree.update(render()));
  assert.ok(button('Terminar consulta'));assert.ok(button('Ampliar 60 min'));
  assert.match(JSON.stringify(tree.toJSON()),/Declarada por ti hasta/);
  time.set(start+3510000);await Renderer.act(async()=>time.tick(1000));
  assert.match(JSON.stringify(tree.toJSON()),/Tu consulta declarada está por terminar/);
  assert.equal(actions.length,1);
  await Renderer.act(async()=>button('Ampliar 60 min').props.onClick());
  assert.deepEqual(actions,['consultation_start','consultation_start']);
  await Renderer.act(async()=>button('Terminar consulta').props.onClick());
  assert.equal(actions.at(-1),'consultation_end');
  // A lost response does not let the browser invent a renewed deadline.
  time.set(start+3601000);await Renderer.act(async()=>time.tick(1000));
  assert.equal(tree.root.findByProps({'data-panel-workspace':true}).props.inert,'');
  assert.match(JSON.stringify(tree.toJSON()),/Han terminado los 60 minutos/);
  assert.ok(button('Conectado'));assert.equal(signOuts,0);assert.equal(refreshes,1);
  assert.equal(tree.root.findAllByProps({role:'status'}).length,0,'locked workspace cannot keep an actionable consultation banner');
  assert.equal(measuredStyles.has('--panel-consultation-height'),false,'locking releases the header offset');
  await Renderer.act(async()=>tree.unmount());
});
