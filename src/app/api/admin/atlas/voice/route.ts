import { NextResponse } from 'next/server';
import { atlasContext, AtlasError } from '@/lib/server/atlas-access';
import { voiceInstruction, voiceTools, VOICE_MODEL, VOICE_SECONDS } from '@/lib/atlas-voice-demo';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const recent=new Map<string,number>();
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
function failure(error:unknown){return error instanceof AtlasError?json({error:error.message},error.status):json({error:'No se pudo preparar la voz. Vuelve a intentarlo más tarde.'},503);}
export async function GET(req:Request){
  try{const {worker}=await atlasContext(req);return json({configured:!!process.env.GEMINI_API_KEY?.trim(),workerId:worker.id,mode:'fictional',maxSeconds:VOICE_SECONDS});}catch(e){return failure(e);}
}
export async function POST(req:Request){
  try{
    const {worker}=await atlasContext(req);
    const origin=req.headers.get('origin');
    if(origin&&origin!==new URL(req.url).origin)throw new AtlasError('Origen no permitido.',403);
    if(Number(req.headers.get('content-length')||0)>5000)throw new AtlasError('Solicitud demasiado grande.',413);
    const raw=await req.text();if(raw.length>5000)throw new AtlasError('Solicitud demasiado grande.',413);
    let body;try{body=JSON.parse(raw);}catch{throw new AtlasError('Solicitud inválida.');}
    if(!body||body.mode!=='fictional'||body.freeTierConfirmed!==true)throw new AtlasError('Confirma el proyecto gratuito y los datos ficticios antes de empezar.');
    const teachings=body.teachings??[];
    if(!Array.isArray(teachings)||teachings.length>5||teachings.some((s:unknown)=>typeof s!=='string'||s.length>400))throw new AtlasError('Las notas admiten hasta cinco textos de 400 caracteres.');
    const key=process.env.GEMINI_API_KEY?.trim();
    if(!key)throw new AtlasError('Falta configurar la conexión de Gemini en Vercel.',503);
    const now=Date.now();
    // Best-effort local throttling; Google project quotas are the shared limit.
    for(const [id,time]of recent)if(now-time>60000)recent.delete(id);
    if(recent.has(worker.id))throw new AtlasError('Espera un minuto entre intentos de conexión.',429);
    if(recent.size>2000)throw new AtlasError('Hay demasiadas conexiones en preparación.',429);
    recent.set(worker.id,now);
    const expiresAt=new Date(now+(VOICE_SECONDS+20)*1000).toISOString();
    const setup={model:`models/${VOICE_MODEL}`,generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Charon'}}}},systemInstruction:{parts:[{text:voiceInstruction(teachings)}]},tools:voiceTools,inputAudioTranscription:{},outputAudioTranscription:{}};
    // Official js-genai tokens API wire format. Omitting fieldMask locks the entire setup.
    const response=await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({uses:1,expireTime:expiresAt,newSessionExpireTime:new Date(now+60000).toISOString(),bidiGenerateContentSetup:setup}),signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!response.ok)throw new AtlasError(response.status===429?'Se ha alcanzado el cupo de Gemini. La prueba se detiene; no cambia a un servicio de pago.':'Google no ha aceptado la conexión. Revisa la clave y el acceso del proyecto a Gemini Live.',response.status===429?429:502);
    const result=await response.json();
    if(typeof result.name!=='string'||!result.name.startsWith('auth_tokens/'))throw new AtlasError('Google no devolvió una autorización de voz válida.',502);
    return json({token:result.name,model:setup.model,expiresAt,maxSeconds:VOICE_SECONDS,mode:'fictional'});
  }catch(e){return failure(e);}
}
