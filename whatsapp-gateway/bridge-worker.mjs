import {setTimeout as pause} from 'node:timers/promises';

const UUID_PATTERN='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE=new RegExp(`^${UUID_PATTERN}$`,'i');
// Leave headroom beneath the server's 2 MiB JSON request limit. A batch can
// contain four replies, including multibyte text and JSON escaping overhead.
const MAX_RESULT_BYTES=448*1024;
const MAX_BATCH_BYTES=1900*1024;
const oversizedResult=id=>({id,status:502,json:{ok:false,error:'LOCAL_GATEWAY_RESPONSE_TOO_LARGE'}});
const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');

export function boundedResults(results){
  const batch=[];
  for(const result of results.slice(0,4)){
    let bounded;
    try{bounded=jsonBytes(result)>MAX_RESULT_BYTES?oversizedResult(result.id):result;}
    catch{bounded=oversizedResult(result.id);}
    if(jsonBytes({results:[...batch,bounded]})>MAX_BATCH_BYTES)bounded=oversizedResult(result.id);
    batch.push(bounded);
  }
  return batch;
}

// Only pre-defined gateway routes can be requested remotely. Never execute code,
// open arbitrary URLs, or forward the bridge secret anywhere else.
export function allowedCommand(command){
  if(!command||typeof command.id!=='string'||!UUID_RE.test(command.id)||typeof command.path!=='string')return false;
  const prefix='^/sessions/[A-Za-z0-9_-]{1,64}/';
  return command.method==='GET'
    ?new RegExp(prefix+'(?:status|chats|chats/(?:[A-Za-z0-9_.:@-]|%40|%3A)+/messages\\?limit=[0-9]{1,3}|captacion/'+UUID_PATTERN+')$','i').test(command.path)
    :command.method==='POST'&&new RegExp(prefix+'(?:start|logout|send|captacion|chats/(?:[A-Za-z0-9_.:@-]|%40|%3A)+/read)$','i').test(command.path);
}
export async function executeCommand(command,{localOrigin,secret,fetcher=fetch}){
  const expiresAt=Date.parse(command?.expires_at);
  if(!allowedCommand(command)||!Number.isFinite(expiresAt)||expiresAt<=Date.now())return {id:command?.id,status:400,json:{ok:false,error:'INVALID_COMMAND'}};
  try{
    const response=await fetcher(`${localOrigin}${command.path}`,{method:command.method,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},...(command.method==='POST'?{body:JSON.stringify(command.payload??{})}:{}),redirect:'error',signal:AbortSignal.timeout(16000)});
    return boundedResults([{id:command.id,status:response.status,json:await response.json()}])[0];
  }catch{return {id:command.id,status:502,json:{ok:false,error:'LOCAL_GATEWAY_UNAVAILABLE'}};}
}
export async function runBridge({origin,secret,localOrigin='http://127.0.0.1:8787',signal,fetcher=fetch,wait=pause}){
  if(new URL(origin).origin!=='https://clientestarotcelestial.es'||secret.length<32)throw new Error('Invalid bridge configuration');
  let results=[],idleDelay=1000;
  while(!signal?.aborted){
    try{
      const response=await fetcher(`${origin}/api/internal/whatsapp-bridge`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({results:boundedResults(results)}),redirect:'error',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('Bridge unavailable');
      const data=await response.json();
      if(!data.ok||!Array.isArray(data.commands))throw new Error('Bridge unavailable');
      results=[];
      results=boundedResults(await Promise.all(data.commands.slice(0,4).map(command=>executeCommand(command,{localOrigin,secret,fetcher}))));
      idleDelay=results.length?1000:Math.min(5000,idleDelay+1000);
      await wait(results.length?50:idleDelay,undefined,{signal});
    }catch{
      // Keep acknowledged local results until the server accepts them. Never
      // repeat the local send merely because the internet connection dropped.
      if(!signal?.aborted)await wait(3000,undefined,{signal}).catch(()=>{});
    }
  }
}
