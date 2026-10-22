import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { whatsappBridgeAdmin } from '@/lib/server/whatsapp-local-bridge';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:Request){
  const expected=process.env.WHATSAPP_GATEWAY_SECRET||'';
  const provided=/^Bearer (.+)$/.exec(req.headers.get('authorization')||'')?.[1]||'';
  if(process.env.WHATSAPP_GATEWAY_MODE!=='bridge'||expected.length<32) return reply({ok:false,error:'BRIDGE_DISABLED'},503);
  const digest=(value:string)=>createHash('sha256').update(value).digest();
  if(!timingSafeEqual(digest(expected),digest(provided))) return reply({ok:false,error:'UNAUTHORIZED'},401);
  try{
    if(Number(req.headers.get('content-length')||0)>2097152) return reply({ok:false,error:'TOO_LARGE'},413);
    const raw=await req.text();
    if(Buffer.byteLength(raw)>2097152) return reply({ok:false,error:'TOO_LARGE'},413);
    const body=JSON.parse(raw);
    if(!Array.isArray(body.results)||body.results.length>10) return reply({ok:false,error:'INVALID_RESULTS'},400);
    const admin=whatsappBridgeAdmin();
    const result=await admin.rpc('tc_whatsapp_bridge_exchange',{p_results:body.results});
    if(result.error) return reply({ok:false,error:'BRIDGE_UNAVAILABLE'},503);
    return reply({ok:true,commands:result.data?.commands||[]});
  }catch{return reply({ok:false,error:'INVALID_REQUEST'},400);}
}
