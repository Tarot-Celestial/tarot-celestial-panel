// Local interactive fixture only. Launches no browser and contacts no live service.
// Open the two printed URLs with CUA. Actual provider/UI + real RTCPeerConnections;
// local signaling, synthetic WebAudio tracks and muted speakers, never a real microphone.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const modules = {
  '@/lib/staff-panel-calls': 'src/lib/staff-panel-calls.ts',
  '@/components/chat/StaffPanelCallOverlay': 'src/components/chat/StaffPanelCallOverlay.tsx',
  '@/providers/StaffPanelCallProvider': 'src/providers/StaffPanelCallProvider.tsx',
  '@/components/chat/StaffPanelCallButton': 'src/components/chat/StaffPanelCallButton.tsx',
};
const script = Object.entries(modules).map(([name, file]) => `definitions[${JSON.stringify(name)}]=function(exports,require){\n${ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText}\n};`).join('\n');
const css = fs.readFileSync(path.join(root, 'src/components/chat/StaffPanelCall.module.css'), 'utf8');
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA · Llamadas internas</title><style>
body{background:#100d1d;color:#eee6ff;font-family:system-ui;margin:0;padding:24px}main{max-width:850px;margin:auto}button{font:inherit;cursor:pointer;background:#35254e;color:white;border:1px solid #9277b2;border-radius:12px;padding:12px;margin:5px}button:disabled{opacity:.4}.fixtureBox{background:#21172e;border:1px solid #715384;border-radius:18px;padding:20px;margin:18px 0}code{word-break:break-word}p{line-height:1.5}pre{white-space:pre-wrap} ${css}
</style><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>
const definitions={},cache={};
const qa={actor:new URLSearchParams(location.search).get('role')==='tarotista'?'${id(2)}':'${id(1)}',connected:true,streams:[],peers:[],requests:[],micRequests:0,rings:0};
window.__staffCallFixture=qa;
const RealPeer=window.RTCPeerConnection;
window.RTCPeerConnection=class extends RealPeer{constructor(c){super(c);qa.peers.push(this);}};
const RealAudio=window.Audio;
window.Audio=class extends RealAudio{constructor(){super();this.volume=0;}};
navigator.mediaDevices.getUserMedia=async()=>{
 qa.micRequests++;
 const context=new AudioContext(), oscillator=context.createOscillator(),gain=context.createGain(),dest=context.createMediaStreamDestination();
 oscillator.frequency.value=qa.actor==='${id(1)}'?440:660;gain.gain.value=.05;oscillator.connect(gain);gain.connect(dest);oscillator.start();await context.resume();
 const stream=dest.stream;
 stream.getTracks().forEach(track=>{const stop=track.stop.bind(track);track.stop=()=>{stop();try{oscillator.stop();}catch{}void context.close();};});
 qa.streams.push(stream);return stream;
};
function require(name){
 if(name==='react')return React;
 if(name==='react/jsx-runtime')return {jsx:(type,props,key)=>React.createElement(type,{...props,key}),jsxs:(type,props,key)=>React.createElement(type,{...props,key}),Fragment:React.Fragment};
 if(name==='lucide-react')return new Proxy({}, {get:(_t,label)=>(props)=>React.createElement('span',{'aria-hidden':true},String(label)==='Phone'?'☎':String(label)==='PhoneOff'?'✕':'◉')});
 if(name.endsWith('.module.css'))return {default:new Proxy({}, {get:(_t,key)=>key})};
 if(name==='@/providers/StaffChatProvider')return {useStaffChat:()=>({me:{id:qa.actor,role:qa.actor==='${id(1)}'?'central':'tarotista',display_name:qa.actor==='${id(1)}'?'Central ficticia':'Tarotista ficticia'},sound:false,audioReady:true,testSound:async()=>{qa.rings++;}})};
 if(name==='@/hooks/useAttendance')return {useAttendance:()=>({})};
 if(name==='@/hooks/usePanelSessionAccess')return {usePanelSessionAccess:()=>({connected:qa.connected})};
 if(name==='@/lib/staff-chat-client')return {chatRequest:async(url,init={})=>{qa.requests.push({url,action:init.body?JSON.parse(init.body).action:null});const response=await fetch(url,{...init,headers:{...init.headers,'x-fixture-worker':qa.actor}});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error),{code:data.error});return data;}};
 if(cache[name])return cache[name];if(!definitions[name])throw new Error('Fixture missing module '+name);const exports={};cache[name]=exports;definitions[name](exports,require);return exports;
}
${script}
const {StaffPanelCallProvider,useStaffPanelCalls}=require('@/providers/StaffPanelCallProvider');
const CallButton=require('@/components/chat/StaffPanelCallButton').default;
function Controls(){const calls=useStaffPanelCalls();return React.createElement('section',{className:'fixtureBox'},React.createElement('p',null,'Estado local: '+(calls.busy?'Ocupado':'Disponible')),React.createElement(CallButton,{threadId:'${id(10)}',targetWorkerId:qa.actor==='${id(1)}'?'${id(2)}':'${id(1)}',targetName:qa.actor==='${id(1)}'?'Tarotista ficticia':'Central ficticia'}));}
function App(){
 const [tick,setTick]=React.useState(0),[mounted,setMounted]=React.useState(true),[stats,setStats]=React.useState([]);
 React.useEffect(()=>{const timer=setInterval(async()=>{const results=[];for(const pc of qa.peers){let received=0,sent=0,packets=0;try{(await pc.getStats()).forEach(r=>{if(r.type==='inbound-rtp'&&r.kind==='audio'){received+=r.bytesReceived||0;packets+=r.packetsReceived||0;}if(r.type==='outbound-rtp'&&r.kind==='audio')sent+=r.bytesSent||0;});}catch{}results.push({connection:pc.connectionState,received,sent,packets});}setStats(results);setTick(v=>v+1);},1000);return()=>clearInterval(timer);},[]);
 const title=qa.actor==='${id(1)}'?'Central ficticia':'Tarotista ficticia';
 return React.createElement('main',null,
  React.createElement('h1',null,title+' · QA de audio'),
  React.createElement('p',null,'Prueba local aislada. Audio sintético y altavoces silenciados. No se abre el micrófono real, no se escribe en Supabase y no se llama a nadie del equipo.'),
  React.createElement('p',null,React.createElement('a',{href:'/?role=central',target:'_blank',style:{color:'#e7c87d'}},'Abrir Central ficticia'),' · ',React.createElement('a',{href:'/?role=tarotista',target:'_blank',style:{color:'#e7c87d'}},'Abrir Tarotista ficticia')),
  React.createElement('button',{onClick:()=>{qa.connected=!qa.connected;setTick(v=>v+1);}},qa.connected?'Desconectar panel de prueba':'Conectar panel de prueba'),
  React.createElement('button',{onClick:()=>setMounted(v=>!v)},mounted?'Desmontar proveedor':'Montar proveedor'),
  mounted?React.createElement(StaffPanelCallProvider,null,React.createElement(Controls)):null,
  React.createElement('section',{className:'fixtureBox','aria-label':'Evidencia de transporte'},
   React.createElement('h2',null,'Evidencia de transporte real'),
   React.createElement('p',null,'Solicitudes de audio sintético: '+qa.micRequests),
   React.createElement('p',null,'Pistas: '+(qa.streams.map(s=>s.getAudioTracks().map(t=>t.readyState+(t.enabled?'':' (silenciada)')).join(', ')).join(' / ')||'ninguna')),
   stats.map((s,i)=>React.createElement('p',{key:i},'Peer '+(i+1)+': '+s.connection+' · Audio enviado: '+s.sent+' bytes · Audio recibido: '+s.received+' bytes · Paquetes recibidos: '+s.packets)),
   React.createElement('p',null,'Acciones enviadas: '+qa.requests.filter(r=>r.action).map(r=>r.action).join(', ')),
   React.createElement('small',null,'Actualización de contadores: '+tick)));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script></html>`;

const calls = new Map();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture.invalid');
  const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/react.js' || url.pathname === '/react-dom.js') {
    const module = url.pathname === '/react.js' ? 'react' : 'react-dom';
    res.setHeader('Content-Type', 'text/javascript'); return fs.createReadStream(path.join(root, 'node_modules', module, 'umd', module + '.development.js')).pipe(res);
  }
  if (url.pathname === '/chat') {
    res.setHeader('Content-Type', 'text/html');
    delete require.cache[require.resolve('./staff-chat-browser-fixture.cjs')];
    return res.end(require('./staff-chat-browser-fixture.cjs').renderHTML());
  }
  if (url.pathname !== '/api/chat/calls') { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
  const actor = req.headers['x-fixture-worker'];
  if (![id(1), id(2)].includes(actor)) return send({ error: 'NO_AUTH' }, 401);
  if (req.method === 'GET') {
    if (url.searchParams.get('config') === '1') return send({ iceServers: [], relayConfigured: false });
    const call = url.searchParams.has('call_id') ? calls.get(url.searchParams.get('call_id')) : [...calls.values()].reverse().find(c => ['ringing', 'accepted'].includes(c.status) && Date.parse(c.expires_at) > Date.now());
    return send({ call: call && [call.caller_worker_id, call.callee_worker_id].includes(actor) ? call : null });
  }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 60000) return send({ error: 'TOO_LARGE' }, 400); }
  let body; try { body = JSON.parse(raw); } catch { return send({ error: 'INVALID_JSON' }, 400); }
  if (body.expected_actor_id !== actor) return send({ error: 'IDENTITY_CHANGED' }, 409);
  let call = calls.get(body.call_id);
  if (body.action === 'start') {
    if ([...calls.values()].some(c => ['ringing', 'accepted'].includes(c.status) && Date.parse(c.expires_at) > Date.now())) return send({ error: 'CALL_BUSY' }, 409);
    call = { id: body.call_id, thread_id: body.thread_id, caller_worker_id: actor, callee_worker_id: body.target_worker_id, caller_name: actor === id(1) ? 'Central ficticia' : 'Tarotista ficticia', callee_name: actor === id(1) ? 'Tarotista ficticia' : 'Central ficticia', caller_tab_id: body.tab_id, callee_tab_id: null, status: 'ringing', created_at: new Date().toISOString(), accepted_at: null, ended_at: null, expires_at: new Date(Date.now() + 75000).toISOString(), offer_sdp: body.sdp, answer_sdp: null };
    calls.set(call.id, call);
  } else {
    if (!call || ![call.caller_worker_id, call.callee_worker_id].includes(actor)) return send({ error: 'FORBIDDEN' }, 403);
    if (body.action === 'answer') {
      if (call.callee_worker_id !== actor || call.callee_tab_id && call.callee_tab_id !== body.tab_id) return send({ error: 'CALL_ALREADY_ANSWERED' }, 409);
      Object.assign(call, { status: 'accepted', answer_sdp: body.sdp, callee_tab_id: body.tab_id, accepted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90000).toISOString() });
    } else if (body.action === 'end' || body.action === 'reject') Object.assign(call, { status: body.action === 'end' ? 'ended' : 'rejected', ended_at: new Date().toISOString(), offer_sdp: null, answer_sdp: null });
    else if (body.action === 'heartbeat') call.expires_at = new Date(Date.now() + 90000).toISOString();
  }
  return send({ call });
});
server.listen(Number(process.env.STAFF_CALL_QA_PORT || 0), '127.0.0.1', () => {
  const port = server.address().port;
  console.log(JSON.stringify({ central: `http://127.0.0.1:${port}/?role=central`, tarotista: `http://127.0.0.1:${port}/?role=tarotista`, scope: 'Local only, actual React provider/UI and WebRTC, synthetic audio, no Supabase' }));
});
process.on('SIGINT', () => { server.close(); process.exit(0); });
