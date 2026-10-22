import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export function whatsappBridgeAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {auth:{persistSession:false}});
}
export function allowedBridgePath(path: string, method: string) {
  const prefix = '^/sessions/[A-Za-z0-9_-]{1,64}/';
  return method === 'GET'
    ? new RegExp(prefix+'(?:status|attention|chats|chats/(?:[A-Za-z0-9_.:@-]|%40|%3A)+/messages\\?limit=[0-9]{1,3}|captacion/[0-9a-f-]{36})$','i').test(path)
    : method === 'POST' && new RegExp(prefix+'(?:start|logout|send|captacion|chats/(?:[A-Za-z0-9_.:@-]|%40|%3A)+/read)$','i').test(path);
}
export async function whatsappBridgeFetch(path: string, init: {method?:'GET'|'POST';body?:unknown}) {
  const method=init.method||'GET';
  if (!allowedBridgePath(path,method)) return {status:400,json:{ok:false,error:'INVALID_GATEWAY_PATH'}};
  const admin=whatsappBridgeAdmin(), id=randomUUID();
  const result=await admin.rpc('tc_whatsapp_bridge_enqueue',{p_id:id,p_method:method,p_path:path,p_payload:init.body??null});
  if(result.error) return {status:503,json:{ok:false,error:'BRIDGE_UNAVAILABLE'}};
  if(!result.data) return {status:503,json:{ok:false,error:'LOCAL_GATEWAY_OFFLINE'}};
  const deadline=Date.now()+24000;
  while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,400));
    const response=await admin.from('whatsapp_bridge_commands').select('state,response_status,result').eq('id',id).maybeSingle();
    if(response.error) break;
    if(response.data?.state==='completed') {
      await admin.from('whatsapp_bridge_commands').delete().eq('id',id);
      return {status:response.data.response_status||502,json:response.data.result||{ok:false,error:'INVALID_GATEWAY_RESPONSE'}};
    }
  }
  // Never enqueue a second command after an ambiguous timeout.
  return {status:502,json:{ok:false,error:'GATEWAY_TIMEOUT'}};
}
