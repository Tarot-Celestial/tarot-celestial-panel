import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { instagramIdentity, InstagramError } from '@/lib/server/instagram-graph';
import { ensureInstagramFresh } from '@/lib/server/instagram-sync';
import { facebookConnection, FacebookError } from '@/lib/server/facebook-graph';
import { ensureFacebookFresh } from '@/lib/server/facebook-inbox';
import { socialAttention, type SocialInboxProvider } from '@/lib/server/social-inbox-activity';
import { SOCIAL_CONNECTIONS_TABLE } from '@/lib/server/social-connections';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const disconnected=()=>({count:0,messages:0,comments:0,revision:'empty',account_id:null,configured:false,available:true,error:null});
async function snapshot(provider:SocialInboxProvider,accountId:string|null) {
  if(!accountId)return disconnected();
  try {return {...await socialAttention(provider,accountId),configured:true,available:true,error:null};}
  catch{return {count:null,messages:null,comments:null,revision:null,account_id:accountId,configured:true,available:false,error:'SOCIAL_INBOX_UNAVAILABLE'};}
}
export async function GET(req:Request) {
  try {
    const identity=await instagramIdentity(req);
    const connection=await identity.db.from(SOCIAL_CONNECTIONS_TABLE).select('account_id').eq('provider','instagram').maybeSingle();
    let fbAccount:ReturnType<typeof facebookConnection>|null=null,fbError:string|null=null;
    try {fbAccount=facebookConnection();}catch(error){if(!(error instanceof FacebookError&&error.code==='NOT_CONNECTED'))fbError='SOCIAL_INBOX_UNAVAILABLE';}
    const [instagram,facebook]=await Promise.all([
      connection.error?Promise.resolve({count:null,messages:null,comments:null,revision:null,account_id:null,configured:true,available:false,error:'SOCIAL_INBOX_UNAVAILABLE'}):snapshot('instagram',connection.data?.account_id || null),
      fbError?Promise.resolve({count:null,messages:null,comments:null,revision:null,account_id:null,configured:true,available:false,error:fbError}):snapshot('facebook',fbAccount?.accountId || null),
    ]);
    waitUntil(Promise.allSettled([
      ...(connection.data?.account_id?[ensureInstagramFresh()]:[]),
      ...(fbAccount?[ensureFacebookFresh(fbAccount)]:[]),
    ]));
    return json({ok:true,user_id:identity.userId,worker_id:identity.worker.id,instagram,facebook});
  }catch(error){
    if(error instanceof InstagramError)return json({ok:false,code:error.code,error:error.message},error.status);
    return json({ok:false,code:'SOCIAL_INBOX_UNAVAILABLE',error:'No se pudo actualizar los avisos. Se conserva la última lectura.'},503);
  }
}
