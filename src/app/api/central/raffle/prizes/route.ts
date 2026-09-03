import { NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { getAdminClient } from "@/lib/server/auth-worker";
import type { RaffleCenterState } from "@/features/central/raffle-center";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
class RequestError extends Error { constructor(message: string, public status = 400) { super(message); } }
async function gate(req: Request) {
 const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
 if (!token) throw new RequestError("Vuelve a iniciar sesión.",401);
 const admin=getAdminClient(), auth=await admin.auth.getUser(token);
 if(auth.error||!auth.data.user) throw new RequestError("Tu sesión ha caducado.",401);
 const worker=await admin.from("workers").select("id,role,is_active").eq("user_id",auth.data.user.id).maybeSingle();
 if(worker.error) throw worker.error;
 if(!worker.data||worker.data.is_active===false||!["central","admin"].includes(worker.data.role)) throw new RequestError("No tienes permiso.",403);
 return{admin,worker:worker.data};
}
async function state(admin:ReturnType<typeof getAdminClient>,raffle:string,worker:string):Promise<RaffleCenterState>{
 const result=await admin.rpc("tc_raffle_state",{p_raffle:raffle,p_worker:worker});
 if(result.error) throw result.error;
 return result.data as RaffleCenterState;
}
function failed(error:unknown){
 const e=error as {code?:string;message?:string};
 const status=error instanceof RequestError?error.status:e.code==="42501"?403:["P0001","23505"].includes(e.code||"")?409:503;
 const message=error instanceof RequestError?error.message:e.code==="P0001"?e.message:e.code==="42501"?"No tienes permiso para esta acción.":["42P01","42703","PGRST205","PGRST202"].includes(e.code||"")?"Instala SQL_NECESARIO.sql del centro de ganadores antes de utilizarlo.":"No se pudo completar la operación. Actualiza antes de reintentar.";
 return NextResponse.json({ok:false,error:message},{status,headers:{"Cache-Control":"no-store"}});
}
export async function GET(req:Request){
 try{
  const{admin,worker}=await gate(req);
  let id=new URL(req.url).searchParams.get("raffle_id");
  if(!id){
   const current=await admin.from("raffles").select("id").eq("status","active").order("created_at",{ascending:false}).limit(1).maybeSingle();
   if(current.error) throw current.error;
   id=current.data?.id||null;
  }
  if(!uuid(id)) throw new RequestError("No hay un sorteo activo.",404);
  return NextResponse.json({ok:true,...await state(admin,id,worker.id)},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return failed(error);}
}
export async function POST(req:Request){
 try{
  const{admin,worker}=await gate(req);
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=="object"||Array.isArray(body)||!uuid(body.raffle_id)) throw new RequestError("Solicitud inválida.");
  const action=body.action;
  if(!["save","draw","manual","confirm","cancel","rule"].includes(action)) throw new RequestError("Acción inválida.");
  if(["manual","confirm","cancel","rule"].includes(action)&&worker.role!=="admin") throw new RequestError("Solo un administrador puede realizar esta acción.",403);
  const values:Record<string,unknown>={};
  let spinEntries:RaffleCenterState["entries"]|undefined;
  if(action==="save"){
   if(!Number.isInteger(body.position)||body.position<1||body.position>100||typeof body.name!=="string"||!body.name.trim()||body.name.trim().length>200) throw new RequestError("Nombre o posición inválidos.");
   Object.assign(values,{position:body.position,name:body.name.trim(),previous_name:body.previous_name??null});
  }else if(action==="rule"){
   if(typeof body.allow_repeat_winners!=="boolean") throw new RequestError("Regla inválida.");
   values.allow_repeat_winners=body.allow_repeat_winners;
  }else{
   if(!uuid(body.prize_id)||!Number.isSafeInteger(body.revision)||body.revision<0) throw new RequestError("Selecciona un premio actualizado.");
   Object.assign(values,{prize_id:body.prize_id,revision:body.revision});
   if(action==="draw"){
    const current=await state(admin,body.raffle_id,worker.id);
    spinEntries=current.entries.filter(e=>e.eligible);
    if(!spinEntries.length) throw new RequestError("No quedan participantes elegibles.",409);
    // Uniform by eligible TICKET. Manual selection is always a separate action.
    values.entry_id=spinEntries[randomInt(spinEntries.length)].id;
    values.pool_ids=spinEntries.map(e=>e.id);
   }else if(action==="manual"){
    if(!uuid(body.entry_id)||typeof body.is_test!=="boolean"||typeof body.simulation_only!=="boolean") throw new RequestError("Elige un participante e indica el modo de prueba.");
    Object.assign(values,{entry_id:body.entry_id,is_test:body.is_test,simulation_only:body.is_test&&body.simulation_only});
   }
  }
  const result=await admin.rpc("tc_raffle_action",{p_raffle:body.raffle_id,p_worker:worker.id,p_action:action,p_data:values});
  if(result.error) throw result.error;
  // On a lost response, GET recovers the persisted candidate; never auto-repeat a mutation.
  return NextResponse.json({ok:true,...await state(admin,body.raffle_id,worker.id),...(spinEntries?{spinEntries}:{})},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return failed(error);}
}
