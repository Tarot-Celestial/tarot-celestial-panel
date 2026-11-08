const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { act, create } = require('react-test-renderer');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=candidate:fixture\r\n';
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const flush = async fn => act(async () => { fn?.(); await new Promise(r => setImmediate(r)); });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const incoming = () => ({ id: id(100), thread_id: id(10), caller_worker_id: id(2), callee_worker_id: id(1), caller_name: 'Central ficticia', callee_name: 'Tarotista ficticia', caller_tab_id: id(900), callee_tab_id: null, status: 'ringing', offer_sdp: sdp, answer_sdp: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 75000).toISOString() });

async function fixture(t, options = {}) {
  let snapshot, overlay, view, serial = 0, timer = 0;
  const timers = new Map(), listeners = new Map(), peers = [], streams = [], requests = [], audios = [];
  const state = { me: { id: id(1), display_name: 'Trabajadora ficticia' }, connected: true, sound: true, audioReady: false, rings: 0, micRequests: 0, call: options.incoming || null, failAfter: '', mic: null, beforeAction: null };
  class BrowserDate extends Date { static now() { return Date.now() + (options.clockSkew || 0); } }
  const stream = () => { const track = { enabled: true, stopped: false, stop() { this.stopped = true; } }; const value = { getTracks: () => [track], getAudioTracks: () => [track] }; streams.push(value); return value; };
  class Peer {
    iceGatheringState = 'complete'; connectionState = 'new'; localDescription = null; remoteDescription = null; tracks = []; closed = false;
    constructor(config) { this.config = config; peers.push(this); }
    addTrack(track) { this.tracks.push(track); }
    async createOffer() { return { type: 'offer', sdp }; }
    async createAnswer() { return { type: 'answer', sdp }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    addEventListener() {} removeEventListener() {}
    close() { this.closed = true; this.connectionState = 'closed'; }
  }
  class Audio {
    srcObject = null; autoplay = false; paused = false;
    constructor() { audios.push(this); }
    async play() { if (options.blockAudio) throw new Error('blocked'); }
    pause() { this.paused = true; }
  }
  const browser = { isSecureContext: true, RTCPeerConnection: Peer,
    setTimeout(fn, ms) { const key = ++timer; timers.set(key, { fn, ms }); return key; }, clearTimeout: key => timers.delete(key),
    setInterval(fn, ms) { const key = ++timer; timers.set(key, { fn, ms }); return key; }, clearInterval: key => timers.delete(key),
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
  };
  const request = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null; requests.push({ url, body });
    if (!body) {
      if (url.includes('config=1')) return { iceServers: [{ urls: 'stun:fixture.invalid:3478' }], relayConfigured: false, server_now: new Date().toISOString() };
      return { call: state.call ? { ...state.call } : null, server_now: new Date().toISOString() };
    }
    if (state.beforeAction) await state.beforeAction(body);
    if (body.action === 'start') state.call = { ...incoming(), id: body.call_id, thread_id: body.thread_id, caller_worker_id: state.me.id, callee_worker_id: body.target_worker_id, caller_tab_id: body.tab_id, callee_tab_id: null, status: 'ringing', offer_sdp: body.sdp };
    else if (body.action === 'answer') state.call = { ...state.call, status: 'accepted', callee_tab_id: body.tab_id, answer_sdp: body.sdp, expires_at: new Date(Date.now() + 90000).toISOString() };
    else if (body.action === 'end' || body.action === 'reject') state.call = { ...state.call, status: body.action === 'end' ? 'ended' : 'rejected', offer_sdp: null, answer_sdp: null };
    if (state.failAfter === body.action) throw new Error('Synthetic lost response');
    return { call: { ...state.call }, server_now: new Date().toISOString() };
  };
  const library = {}; vm.runInNewContext(compile('src/lib/staff-panel-calls.ts'), { exports: library, Date, Error });
  const exports = {};
  vm.runInNewContext(compile('src/providers/StaffPanelCallProvider.tsx'), {
    exports, require: name => {
      if (name === '@/providers/StaffChatProvider') return { useStaffChat: () => ({ me: state.me, sound: state.sound, audioReady: state.audioReady, testSound: async () => { state.rings++; } }) };
      if (name === '@/hooks/useAttendance') return { useAttendance: () => ({}) };
      if (name === '@/hooks/usePanelSessionAccess') return { usePanelSessionAccess: () => ({ connected: state.connected }) };
      if (name === '@/lib/staff-chat-client') return { chatRequest: request };
      if (name === '@/lib/staff-panel-calls') return library;
      if (name === '@/components/chat/StaffPanelCallOverlay') return { default: props => { overlay = props; return React.createElement('aside'); } };
      return require(name);
    }, window: browser, navigator: { mediaDevices: { getUserMedia: async () => { state.micRequests++; return state.mic ? state.mic() : stream(); } } },
    RTCPeerConnection: Peer, Audio, MediaStream: class {}, crypto: { randomUUID: () => id(1000 + ++serial) }, Date: BrowserDate, Error, console,
    clearTimeout: browser.clearTimeout, clearInterval: browser.clearInterval,
  });
  function Probe() { snapshot = exports.useStaffPanelCalls(); return null; }
  const tree = () => React.createElement(exports.StaffPanelCallProvider, null, React.createElement(Probe));
  await act(async () => { view = create(tree()); }); await flush();
  t.after(() => act(() => view.unmount()));
  return { state, streams, peers, requests, timers, audios, stream,
    get calls() { return snapshot; }, get overlay() { return overlay; },
    get visible() { return view.root.findAllByType('aside').length > 0; },
    async poll() { await flush(() => [...timers.values()].find(t => t.ms === 2500 || t.ms === 5000)?.fn()); },
    async render() { await act(async () => view.update(tree())); },
    async start() { await flush(() => snapshot.startCall({ threadId: id(10), targetWorkerId: id(2), targetName: 'Otro equipo ficticio' })); },
    async end() { await flush(() => overlay.onEnd()); },
    async answer() { await flush(() => overlay.onAnswer()); },
    async unmount() { await act(async () => view.unmount()); },
  };
}

test('incoming invitation never opens microphone or bypasses ringtone user gesture', async t => {
  const f = await fixture(t, { incoming: incoming() });
  assert.equal(f.overlay.call.status, 'ringing'); assert.equal(f.state.micRequests, 0); assert.equal(f.peers.length, 0); assert.equal(f.state.rings, 0);
  f.state.audioReady = true; await f.render(); assert.equal(f.state.rings, 1);
  await f.answer(); assert.equal(f.state.micRequests, 1); assert.equal(f.overlay.call.status, 'accepted');
  assert.equal(f.peers[0].remoteDescription.type, 'offer'); assert.ok(f.requests.some(r => r.body?.action === 'answer'));
  assert.equal(f.overlay.relayConfigured, false);
});

test('server clock keeps invitation valid with a client clock one hour ahead', async t => {
  const f = await fixture(t, { incoming: incoming(), clockSkew: 3600000 });
  assert.equal(f.overlay.call.status, 'ringing'); assert.equal(f.calls.busy, true);
  await f.answer(); assert.equal(f.state.call.status, 'accepted');
  await f.end(); assert.equal(f.state.call.status, 'ended');
});

test('caller sends audio offer once, mute toggles track, hangup releases all resources', async t => {
  const f = await fixture(t); await f.start();
  assert.equal(f.state.micRequests, 1); assert.equal(f.requests.filter(r => r.body?.action === 'start').length, 1);
  const pc = f.peers[0], track = f.streams[0].getTracks()[0];
  assert.equal(pc.localDescription.type, 'offer');
  f.state.call = { ...f.state.call, status: 'accepted', answer_sdp: sdp, callee_tab_id: id(999) }; await f.poll();
  assert.equal(pc.remoteDescription.type, 'answer');
  await flush(() => f.overlay.onMute()); assert.equal(track.enabled, false);
  await flush(() => f.overlay.onMute()); assert.equal(track.enabled, true);
  await f.end(); assert.equal(track.stopped, true); assert.equal(pc.closed, true); assert.equal(f.audios[0].srcObject, null);
  assert.equal(f.state.call.status, 'ended'); assert.equal(f.calls.busy, false);
});

test('late ringing snapshot cannot resurrect a canceled outgoing call while POST end waits', async t => {
  const f = await fixture(t); await f.start();
  const pending = deferred(); f.state.beforeAction = body => body.action === 'end' ? pending.promise : undefined;
  await f.end(); assert.equal(f.state.call.status, 'ringing'); assert.equal(f.visible, false);
  await f.poll(); assert.equal(f.visible, false); assert.equal(f.streams[0].getTracks()[0].stopped, true);
  await flush(() => pending.resolve()); assert.equal(f.state.call.status, 'ended');
  await f.poll(); assert.equal(f.visible, false); assert.equal(f.calls.busy, false);
});

test('late incoming snapshot after reject cannot reopen overlay or ring again', async t => {
  const f = await fixture(t, { incoming: incoming() }); f.state.audioReady = true; await f.render();
  const baseline = f.state.rings, pending = deferred(); f.state.beforeAction = body => body.action === 'reject' ? pending.promise : undefined;
  await f.end(); await f.poll();
  assert.equal(f.visible, false); assert.equal(f.state.rings, baseline); assert.equal(f.state.micRequests, 0);
  await flush(() => pending.resolve()); await f.poll(); assert.equal(f.state.call.status, 'rejected'); assert.equal(f.calls.busy, false);
});

test('cancel while browser permission is pending stops late microphone and sends no invitation', async t => {
  const f = await fixture(t), pending = deferred(); f.state.mic = () => pending.promise;
  await f.start(); assert.equal(f.state.micRequests, 1); await f.end();
  const late = f.stream(); await flush(() => pending.resolve(late));
  assert.equal(late.getTracks()[0].stopped, true); assert.equal(f.peers.length, 0);
  assert.equal(f.requests.some(r => r.body?.action === 'start'), false); assert.equal(f.calls.busy, false);
});

test('microphone denial leaves incoming invitation actionable without claiming an answer', async t => {
  const f = await fixture(t, { incoming: incoming() });
  f.state.mic = async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); };
  await f.answer(); assert.equal(f.state.call.status, 'ringing'); assert.match(f.overlay.error, /Permite el micrófono/);
  assert.equal(f.requests.some(r => r.body?.action === 'answer'), false);
  await f.end(); assert.equal(f.state.call.status, 'rejected');
});

test('lost start response is reconciled and canceled by the same id, never recreated', async t => {
  const f = await fixture(t); f.state.failAfter = 'start'; await f.start();
  assert.equal(f.requests.filter(r => r.body?.action === 'start').length, 1);
  assert.equal(f.requests.filter(r => r.body?.action === 'end').length, 1);
  assert.equal(f.state.call.status, 'ended'); assert.equal(f.streams[0].getTracks()[0].stopped, true);
});

test('lost answer response closes committed call rather than heartbeating without audio', async t => {
  const f = await fixture(t, { incoming: incoming() }); f.state.failAfter = 'answer'; await f.answer();
  assert.equal(f.requests.filter(r => r.body?.action === 'answer').length, 1);
  assert.equal(f.state.call.status, 'ended'); assert.equal(f.calls.busy, false);
  assert.equal(f.streams[0].getTracks()[0].stopped, true); assert.equal(f.peers[0].closed, true);
});

test('another tab ownership never opens media and blocks a second local call', async t => {
  const call = { ...incoming(), status: 'accepted', callee_tab_id: id(800), answer_sdp: sdp };
  const f = await fixture(t, { incoming: call });
  assert.equal(f.calls.busy, true); assert.equal(f.state.micRequests, 0);
  await f.start(); assert.equal(f.state.micRequests, 0); assert.equal(f.requests.some(r => r.body?.action === 'start'), false);
});

test('account switch or unmount releases active media and late old data cannot restore it', async t => {
  const f = await fixture(t); await f.start();
  f.state.me = { id: id(3), display_name: 'Otra cuenta ficticia' }; f.state.call = null; await f.render();
  assert.equal(f.streams[0].getTracks()[0].stopped, true); assert.equal(f.peers[0].closed, true); assert.equal(f.calls.busy, false);
  await f.start(); assert.equal(f.streams[1].getTracks()[0].stopped, false);
  await f.unmount(); assert.equal(f.streams[1].getTracks()[0].stopped, true); assert.equal(f.peers[1].closed, true);
});

test('autoplay rejection exposes explicit playback control and connection failure closes microphone', async t => {
  const f = await fixture(t, { blockAudio: true }); await f.start(); const pc = f.peers[0];
  await flush(() => pc.ontrack({ streams: [{ id: 'remote-fixture-stream' }] })); assert.equal(f.overlay.needsPlayback, true);
  await flush(() => { pc.connectionState = 'failed'; pc.onconnectionstatechange(); });
  assert.equal(f.streams[0].getTracks()[0].stopped, true); assert.equal(f.calls.busy, false); assert.match(f.overlay.error, /conectar el audio/);
});
