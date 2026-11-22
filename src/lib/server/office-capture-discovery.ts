import "server-only";
import { hasAdminAccess } from "./admin-access";
import { parseWhatsAppAttention } from "./whatsapp-attention";
import { whatsappGatewayConfig, whatsappGatewayFetch, whatsappSessionId } from "./whatsapp-gateway";
import { asksToStop } from "./office-social-policy";

const direct = /^(?:[1-9]\d{7,14}@s\.whatsapp\.net|[1-9]\d{0,29}@lid)$/;
type GatewayChat = {id:string; name?:string; isGroup:boolean; lastText?:string; lastFromMe?:boolean; lastTs?:number};
type Source = {thread_key:string; source_id:string; source_at:string; body:string; name:string|null; business_interest:boolean; last_own_id:string|null};
type ConnectionState = "connected"|"not_configured"|"offline"|"unavailable"|"not_authorized";
type Health = {state:ConnectionState; ingested:number};
const health = (state:ConnectionState, ingested=0):Health => ({state,ingested});

// This is a shared phone. A generic greeting, a price or a medical consultation
// alone cannot turn a personal conversation into a sales opportunity.
export function whatsAppBusinessInterest(text:string) {
  const plain = text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const service = /\b(?:tarot(?:ista)?s?|oraculo|lectura de (?:las )?cartas|tirada de (?:las )?cartas|tarot reading)\b/;
  const request = /\b(?:quiero|quisiera|queria|podria|puedo|necesito|interesa|gustaria|informacion|info|cuanto|cuesta|precio|reservar|disponib\w*|consultar|llamar|anuncio|publicidad|want|book|interested|cost|price)\b/;
  return service.test(plain) && request.test(plain) && !asksToStop(text);
}

function sample<T>(items:T[], now:number, limit:number) {
  if (items.length<=limit) return items;
  const start = (Math.floor(now/300_000)*limit)%items.length;
  return Array.from({length:limit},(_,i)=>items[(start+i)%items.length]);
}

async function discoverWhatsApp(db:any):Promise<Health> {
  const config = whatsappGatewayConfig();
  if (!config.configured) return health("not_configured");
  let session = "central";
  if (config.mode==="per-worker") {
    const settings = await db.from("office_capture_settings").select("actor_user_id").eq("id",true).maybeSingle();
    if (settings.error) return health("unavailable");
    if (!settings.data?.actor_user_id || !await hasAdminAccess(db,settings.data.actor_user_id)) return health("not_authorized");
    const worker = await db.from("workers").select("id").eq("user_id",settings.data.actor_user_id).eq("is_active",true).maybeSingle();
    if (worker.error || !worker.data?.id) return health("not_authorized");
    session=whatsappSessionId(worker.data);
  }
  const path="/sessions/"+session;
  const snapshot=await whatsappGatewayFetch(path+"/attention");
  if (snapshot.status!==200) {
    return health(["LOCAL_GATEWAY_OFFLINE","NOT_CONNECTED"].includes(snapshot.json?.error) ? "offline":"unavailable");
  }
  const attention=parseWhatsAppAttention(snapshot.json,session);
  const listing=await whatsappGatewayFetch(path+"/chats");
  if (listing.status!==200 || !listing.json?.ok || !Array.isArray(listing.json.chats)) return health("unavailable");
  const own=attention.account_id.replace(/:\d+@/,"@"), now=Date.now();
  const unread=new Map<string,{last_incoming_id:string|null;last_incoming_at:string|null}>(attention.items.map((i:any)=>[i.id,i]));
  const chats=(listing.json.chats as GatewayChat[]).filter(c=>c && c.isGroup===false && direct.test(c.id) && c.id!==own);
  // Leave room for read conversations. Marking a chat read in Central is not a reply.
  const recent=chats.filter(c=>!unread.has(c.id) && c.lastFromMe===false &&
    (Number(c.lastTs)*1000>now-86400_000 || whatsAppBusinessInterest(c.lastText || "")));
  const selection=[...sample(chats.filter(c=>unread.has(c.id)),now,4),...sample(recent,now,4)];
  if (!selection.length) return health("connected");
  const saved=await db.from("office_capture_opportunities").select("thread_key").eq("channel","whatsapp").eq("account_id",attention.account_id)
    .eq("session_id",session).in("thread_key",selection.map(c=>c.id));
  if (saved.error) return health("unavailable");
  const known=new Set<string>((saved.data || []).map((row:{thread_key:string})=>row.thread_key));
  const sources:Source[]=[];
  let partial=false;
  for (let offset=0;offset<selection.length;offset+=4) {
    await Promise.all(selection.slice(offset,offset+4).map(async chat=>{
      const result=await whatsappGatewayFetch(path+"/chats/"+encodeURIComponent(chat.id)+"/messages?limit=30");
      if (result.status!==200 || result.json?.chat?.id!==chat.id || result.json.chat.isGroup!==false || !Array.isArray(result.json.messages)) {partial=true;return;}
      const messages=result.json.messages;
      const expected=unread.get(chat.id);
      if (expected && !messages.some((m:any)=>m.fromMe===false && m.chatJid===chat.id && m.id===expected.last_incoming_id &&
        Number(m.ts)*1000===Date.parse(expected.last_incoming_at || ""))) return;
      const lastOwn=messages.filter((m:any)=>m.chatJid===chat.id && m.fromMe===true && typeof m.id==="string").at(-1)?.id || null;
      let qualified=known.has(chat.id);
      for (const m of messages) {
        if (m?.fromMe!==false || m.chatJid!==chat.id || m.kind!=="text" || typeof m.text!=="string" || !m.text.trim() ||
          typeof m.id!=="string" || !m.id || m.id.length>200 || !Number.isSafeInteger(m.ts) || m.ts<=0 || m.ts*1000>now) continue;
        const interested=whatsAppBusinessInterest(m.text);
        qualified ||= interested;
        if (qualified || asksToStop(m.text)) sources.push({thread_key:chat.id,source_id:m.id,source_at:new Date(m.ts*1000).toISOString(),
          body:m.text.slice(0,4000),name:chat.name?.slice(0,120) || null,business_interest:interested,last_own_id:lastOwn});
      }
    }));
  }
  const status=await whatsappGatewayFetch(path+"/status");
  if (status.status!==200 || status.json?.session!==session || status.json.state!=="connected" || status.json.me?.id!==attention.account_id) return health("unavailable");
  let count=0;
  for (let offset=0;offset<sources.length;offset+=100) {
    const {data,error}=await db.rpc("office_capture_record_whatsapp",{p_account:attention.account_id,p_session:session,p_rows:sources.slice(offset,offset+100)});
    if (error) return health("unavailable",count);
    count+=Number(data || 0);
  }
  return health(partial?"unavailable":"connected",count);
}

export async function discoverOfficeCapture(db:any) {
  const database=await db.rpc("office_capture_discover");
  if (database.error) throw new Error("OFFICE_CAPTURE_DISCOVERY_UNAVAILABLE");
  const whatsapp=await discoverWhatsApp(db).catch(()=>health("unavailable"));
  return {database:{processed:Number(database.data?.processed || 0)},whatsapp};
}
