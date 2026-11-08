// Interactive visual fixture: actual React components, strictly synthetic data.
// Exported for the local calls fixture HTTP server. Never launches a browser.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const files=['src/components/chat/StaffDirectChatPanel.tsx','src/components/chat/StaffChatComposer.tsx','src/components/chat/StaffChatAppearance.tsx','src/components/chat/StaffChatAttachment.tsx','src/components/chat/StaffChatOperations.tsx','src/components/chat/StaffPanelCallButton.tsx','src/lib/staff-chat-appearance.ts','src/lib/staff-chat-media.ts','src/lib/staff-chat-operations.ts','src/lib/activity-codes.ts'];
const cssFiles=['src/components/chat/StaffDirectChatPanel.module.css','src/components/chat/StaffChatOperations.module.css','src/components/chat/StaffPanelCall.module.css'];
exports.renderHTML=function(){
 const css=cssFiles.map((file,i)=>fs.readFileSync(path.join(root,file),'utf8').replace(/\.([A-Za-z_][\w-]*)/g,(_,name)=>'.m'+i+'_'+name)).join('\n');
 const definitions=files.map(file=>`definitions[${JSON.stringify('/'+file)}]=function(exports,require){${ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}\n};\n`).join('');
 return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA · Chat del equipo</title><style>*{box-sizing:border-box}body{margin:0;background:#10131f;font-family:Arial,system-ui,sans-serif;color:#eee}button,input,textarea,select{font:inherit}button{cursor:pointer}main{max-width:1500px;margin:24px auto;padding:0 20px}.fixtureNotice{display:flex;justify-content:space-between;align-items:center;gap:12px;color:#b5bfd0;font-size:12px;margin-bottom:16px}.fixtureNotice a{color:#acdfce}h1{font-size:16px;color:#e6e7ee;margin:0 0 6px}.fixtureTools{display:flex;gap:10px}.fixtureTools button{padding:8px 12px;border:1px solid #8c7eae;background:#252036;color:white;border-radius:9px}@media(max-width:760px){main{margin:8px auto;padding:0 8px}.fixtureNotice{align-items:flex-start;flex-direction:column}}${css}</style><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>
const definitions={},cache={},cssFiles=${JSON.stringify(cssFiles.map(f=>'/'+f))};
const h=React.createElement,ctx=React.createContext(null),params=new URLSearchParams(location.search),tarotist=params.get('role')==='tarotista';
const now=Date.now(),iso=min=>new Date(now-min*60000).toISOString();
const contacts=tarotist?[{id:'central',display_name:'María · Prueba',role:'central',team:'agua',state:'online'},{id:'supervisor',display_name:'Alex · Prueba',role:'admin',team:null,state:'online'}]:[{id:'tarotista',display_name:'Analia · Prueba',role:'tarotista',team:'agua',state:'online'},{id:'zafira',display_name:'Zafira · Prueba',role:'tarotista',team:'fuego',state:'online'},{id:'josefa',display_name:'Josefa · Prueba',role:'tarotista',team:'fuego',state:'break'},{id:'central',display_name:'María · Prueba',role:'central',team:'agua',state:'online'}];
const actor=tarotist?'tarotista':'supervisor',name=tarotist?'Analia · Prueba':'Alex · Prueba';
const record={id:'call-fixture',first_name:'Lucía',blocks:[{code:'FREE',minutes:10},{code:'CLIENTE',minutes:20}],total:30,revision:1,occurred_at:iso(6),appeal:null};
const seed=[{id:'m1',sender_worker_id:'central',sender_display_name:'María · Prueba',text:'Buenos días, Analia ☀️ ¿Lista para empezar?',created_at:iso(18)},{id:'m2',sender_worker_id:'tarotista',sender_display_name:'Analia · Prueba',text:'¡Buenos días! Sí, ya estoy preparada 💜',created_at:iso(17)},{id:'m3',sender_worker_id:'central',sender_display_name:'María · Prueba',text:'Consulta registrada',kind:'consultation',consultation:record,created_at:iso(6)},{id:'m4',sender_worker_id:'supervisor',sender_display_name:'Alex · Prueba',text:'Gracias, equipo. Aquí podéis revisar los minutos y avisarnos si hay algo que corregir.',created_at:iso(4)},{id:'m5',sender_worker_id:'tarotista',sender_display_name:'Analia · Prueba',text:'Perfecto, todo correcto. Gracias ✨',created_at:iso(3)}];
const qa={messages:{t0:seed.map(m=>({...m,thread_id:'t0'}))},profiles:{tarotista:{worker_id:'tarotista',avatar_kind:'character',character:'moon',revision:1},central:{worker_id:'central',avatar_kind:'character',character:'flower',revision:1},supervisor:{worker_id:'supervisor',avatar_kind:'character',character:'owl',revision:1}},preferences:{},attachments:{},requests:[],pauses:[]};window.__staffChatFixture=qa;
function ownAppearance(thread){return{ok:true,profile:qa.profiles[actor]||{worker_id:actor,avatar_kind:'initials',revision:0},profiles:qa.profiles,preference:qa.preferences[thread]||{wallpaper:'aurora',background_url:null,revision:0}};}
class ChatRequestError extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
async function request(url,init={}){
 const parsed=new URL(url,location.origin),body=init.body instanceof FormData?init.body:init.body?JSON.parse(init.body):null;qa.requests.push({url,method:init.method||'GET'});
 if(parsed.pathname==='/api/chat/preferences'){
  const thread=body instanceof FormData?body.get('thread_id'):body?.thread_id||parsed.searchParams.get('thread_id')||'';
  if(body){const scope=body instanceof FormData?body.get('scope'):body.scope,revision=Number(body instanceof FormData?body.get('revision'):body.revision);const file=body instanceof FormData?body.get('file'):null;
   if(scope==='profile')qa.profiles[actor]={worker_id:actor,avatar_kind:file?'photo':body.avatar_kind,character:file?null:body.character,photo_url:file?URL.createObjectURL(file):null,revision:revision+1};
   else qa.preferences[thread]={wallpaper:file?'custom':body.wallpaper,background_url:file?URL.createObjectURL(file):null,revision:revision+1};
  }return ownAppearance(thread);
 }
 if(parsed.pathname==='/api/chat/messages'&&!body)return{ok:true,messages:qa.messages[parsed.searchParams.get('thread_id')]||[],has_more:false,next_cursor:null};
 if(parsed.pathname==='/api/chat/messages'){const message={...body,id:crypto.randomUUID(),sender_worker_id:actor,sender_display_name:name,created_at:new Date().toISOString(),attachment:body.attachment_id?qa.attachments[body.attachment_id]:null};(qa.messages[body.thread_id]??=[]).push(message);return{ok:true,message};}
 if(parsed.pathname==='/api/chat/media/read')return{ok:true,url:qa.attachments[parsed.searchParams.get('attachment_id')]?.previewUrl,expires_in:60};
 if(parsed.pathname==='/api/chat/threads')return{ok:true,thread:{id:'t'+contacts.findIndex(c=>c.id===body.contact_worker_id)}};
 if(parsed.pathname==='/api/chat/operations'){
  if(body){if(body.action==='bathroom'||body.action==='request_lunch'||body.action==='request_break')qa.pauses=[{id:'pause-fixture',thread_id:body.thread_id,worker_id:actor,worker_name:name,kind:body.action==='bathroom'?'bathroom':body.action==='request_lunch'?'lunch':'break',status:body.action==='bathroom'?'active':'pending',revision:1,created_at:new Date().toISOString()}];
   if(body.action==='return'||body.action==='cancel_pause'||body.action==='reject_break')qa.pauses=[];
   if(body.action==='approve_break')qa.pauses.forEach(p=>p.status='active');
   if(body.action==='appeal')record.appeal={id:'appeal-fixture',reason:body.reason,status:'pending',revision:1,call_revision:record.revision};
   if(body.action==='resolve_appeal'&&record.appeal){record.appeal.status='resolved';record.appeal.resolution=body.reason;}
  }return{ok:true,pauses:qa.pauses,can_manage:!tarotist,is_tarotist:tarotist,latest_consultation:null,pending_appeals:[]};
 }
 return{ok:true};
}
const icons={Phone:'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7l.5 2.8-2 2a16 16 0 0 0 6 6l2-2 2.8.5a2 2 0 0 1 1.6 1.9',Send:'m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',Search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',X:'M6 6l12 12M18 6 6 18',Bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',Smile:'M8 14s1 2 4 2 4-2 4-2M8 9h.01M16 9h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',Palette:'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3-5-6-9-6ZM8 7h.01M6 11h.01M14 6h.01M17 8h.01',Mic:'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',ChevronLeft:'m15 18-6-6 6-6',ImagePlus:'M3 3h18v18H3ZM3 16l5-5 4 4 3-3 6 6M15 7h4M17 5v4',Sticker:'M20 13V3H3v18h10l7-8ZM13 21v-8h7',Check:'m4 12 5 5L20 6'};
function require(name,from='/'){
 if(name==='react')return React;if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>h(type,{...props,key}),jsxs:(type,props,key)=>h(type,{...props,key}),Fragment:React.Fragment};
 if(name==='lucide-react')return new Proxy({},{get:(_,icon)=>({size=18,...props})=>h('svg',{...props,width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:icons[icon]||'M12 3v18M3 12h18M6 6l12 12M18 6 6 18'}))});
 if(name==='@/providers/StaffChatProvider')return{useStaffChat:()=>React.useContext(ctx)};
 if(name==='@/providers/StaffPanelCallProvider')return{useStaffPanelCalls:()=>({enabled:true,busy:false,startCall:async()=>alert('Vista previa local: las llamadas se comprueban en la otra pestaña de QA.')})};
 if(name==='@/hooks/useAttendance')return{useAttendance:()=>({})};if(name==='@/hooks/usePanelSessionAccess')return{usePanelSessionAccess:()=>({connected:true,verificationPending:false})};
 if(name==='@/lib/staff-chat-client')return{chatRequest:request,ChatRequestError};if(name==='@/lib/supabase-browser')return{supabaseBrowser:()=>({})};
 let key=name.startsWith('@/')?'/src/'+name.slice(2):name.startsWith('.')?from.slice(0,from.lastIndexOf('/')+1)+name:name;
 key=new URL(key,'http://fixture.invalid').pathname;
 if(key.endsWith('.module.css')){const i=cssFiles.indexOf(key);return{default:new Proxy({},{get:(_,c)=>'m'+i+'_'+c})};}
 if(!definitions[key])key=definitions[key+'.tsx']?key+'.tsx':key+'.ts';
 if(cache[key])return cache[key];if(!definitions[key])throw Error('Missing fixture module '+key);const exports={};cache[key]=exports;definitions[key](exports,n=>require(n,key));
 if(key==='/src/lib/staff-chat-media.ts')exports.uploadStaffChatMedia=async(draft)=>{qa.attachments[draft.clientUploadId]={id:draft.clientUploadId,kind:draft.kind,mime_type:draft.mimeType,file_name:draft.file.name,size_bytes:draft.file.size,previewUrl:URL.createObjectURL(draft.file)};return draft.clientUploadId;};
 return exports;
}
${definitions}
const Panel=require('/src/components/chat/StaffDirectChatPanel.tsx').default;
function App(){const [,redraw]=React.useState(0);const value={me:{id:actor,role:tarotist?'tarotista':'admin',display_name:name,can_admin:!tarotist},mode:tarotist?'tarotista':'admin',contacts,threads:contacts.map((contact,i)=>({id:'t'+i,contact,central_worker_id:tarotist?contact.id:'central',central_display_name:'María · Prueba',tarotist_worker_id:tarotist?'tarotista':contact.id,unread_count:i===1?2:0,last_message_preview:i===0?'Perfecto, todo correcto. Gracias ✨':'Iniciar conversación'})),loading:false,error:'',live:true,sound:false,volume:60,audioReady:true,notificationPermission:'default',refresh:async()=>redraw(x=>x+1),setSound:()=>{},setVolume:()=>{},testSound:async()=>{},enableNotifications:async()=>{},setVisibleThread:()=>{},incoming:null,openRequest:null};
 return h('main',null,h('div',{className:'fixtureNotice'},h('div',null,h('h1',null,'Chat del equipo · Vista previa local'),'Datos ficticios. Ningún envío, consulta, archivo o permiso sale de esta prueba.'),h('div',{className:'fixtureTools'},h('a',{href:'/chat?role=admin'},'Ver administración'),h('a',{href:'/chat?role=tarotista'},'Ver tarotista'))),h(ctx.Provider,{value},h(Panel,{compact:params.get('compact')==='1'})));}
ReactDOM.createRoot(document.getElementById('root')).render(h(App));
</script></html>`;
};
