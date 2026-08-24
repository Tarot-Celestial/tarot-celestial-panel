import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const dynamic = "force-dynamic";
const env=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`Missing env var: ${name}`);return value};
const adminClient=()=>createClient(env("NEXT_PUBLIC_SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
async function requireAdmin(req:Request){const {data,error}=getAuthUserFromRequest(req);if(error||!data.user?.id)return null;const db=adminClient();const {data:worker,error:workerError}=await db.from("workers").select("id,role").eq("user_id",data.user.id).maybeSingle();if(workerError)throw workerError;return worker?.role==="admin"?worker:null}

async function selectInChunks(db:ReturnType<typeof adminClient>,table:string,columns:string,column:string,ids:any[]){
 const unique=Array.from(new Set(ids.map(String).filter(Boolean)));const rows:any[]=[];
 for(let index=0;index<unique.length;index+=100){const {data,error}=await db.from(table).select(columns).in(column,unique.slice(index,index+100));if(error)throw error;rows.push(...(data||[]));}
 return rows;
}

export async function GET(req:Request){
 try{
  if(!await requireAdmin(req))return NextResponse.json({ok:false,error:"FORBIDDEN"},{status:403});
  const db=adminClient();
  const [{data:assignments,error:aError},{data:workers,error:wError},{data:audit,error:hError}]=await Promise.all([
   db.from("crm_client_capture_assignments").select("*").order("updated_at",{ascending:false}).limit(2000),
   db.from("workers").select("id,display_name,team,role,state,is_active").eq("role","central").order("display_name"),
   db.from("crm_client_capture_audit").select("*").order("created_at",{ascending:false}).limit(2000),
  ]);
  if(aError)throw aError;if(wError)throw wError;if(hError)throw hError;
  const clientIds=(assignments||[]).map((x:any)=>x.client_id);const eventIds=(assignments||[]).map((x:any)=>x.xp_event_id).filter(Boolean);
  const [clients,events]=await Promise.all([
   selectInChunks(db,"crm_clientes","id,nombre,apellido,telefono,origen","id",clientIds),
   selectInChunks(db,"worker_xp_events","id,xp_amount,status,created_at","id",eventIds),
  ]);
  const clientMap=new Map((clients||[]).map((x:any)=>[String(x.id),x]));const workerMap=new Map((workers||[]).map((x:any)=>[String(x.id),x]));const eventMap=new Map((events||[]).map((x:any)=>[String(x.id),x]));
  const activeWorkers=(workers||[]).filter((x:any)=>x.is_active!==false&&!['inactive','inactivo','disabled','desactivado','baja'].includes(String(x.state||'').toLowerCase()));
  return NextResponse.json({ok:true,corporate_owner:{id:null,display_name:"Celestial",team:"Cartera general",role:"corporate"},workers:activeWorkers,items:(assignments||[]).map((x:any)=>({...x,client:clientMap.get(String(x.client_id))||null,captured_by:workerMap.get(String(x.captured_by_worker_id))||null,responsible:x.responsible_worker_id?workerMap.get(String(x.responsible_worker_id))||null:{id:null,display_name:"Celestial",team:"Cartera general",role:"corporate"},xp_event:eventMap.get(String(x.xp_event_id))||null,audit:(audit||[]).filter((h:any)=>String(h.client_id)===String(x.client_id)).slice(0,20).map((h:any)=>({...h,previous_name:h.previous_responsible_worker_id?workerMap.get(String(h.previous_responsible_worker_id))?.display_name||"Histórico":"Celestial",new_name:h.new_responsible_worker_id?workerMap.get(String(h.new_responsible_worker_id))?.display_name||"Histórico":"Celestial",actor_name:h.actor_worker_id?workerMap.get(String(h.actor_worker_id))?.display_name||"Admin":"Sistema"}))}))});
 }catch(error:any){return NextResponse.json({ok:false,error:error?.message||"ERR_CLIENT_CAPTURES"},{status:500})}
}

export async function POST(req:Request){
 try{const me=await requireAdmin(req);if(!me)return NextResponse.json({ok:false,error:"FORBIDDEN"},{status:403});const body=await req.json().catch(()=>({}));const clientId=String(body.client_id||"");const workerId=body.responsible_worker_id?String(body.responsible_worker_id):null;if(!clientId)return NextResponse.json({ok:false,error:"CLIENT_REQUIRED"},{status:400});const db=adminClient();const {data,error}=await db.rpc("reassign_client_capture_responsible",{p_client_id:clientId,p_new_worker_id:workerId,p_actor_worker_id:me.id,p_reason:String(body.reason||"")});if(error)throw error;return NextResponse.json({ok:true,data});}
 catch(error:any){return NextResponse.json({ok:false,error:error?.message||"ERR_REASSIGN_CAPTURE"},{status:500})}
}
