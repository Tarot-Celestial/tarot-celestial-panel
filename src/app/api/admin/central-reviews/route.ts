import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok:false,error:gate.error },{ status:403 });
    const { data, error } = await gate.admin.from("cliente_tarotista_reviews").select("id,cliente_id,worker_id,rating,comment,status,verified,verification_source,created_at,updated_at,moderation_note").order("created_at",{ascending:false}).limit(250);
    if (error) throw error;
    const reviews=data||[]; const clientIds=[...new Set(reviews.map((r:any)=>r.cliente_id))]; const workerIds=[...new Set(reviews.map((r:any)=>r.worker_id))];
    const [clients,workers]=await Promise.all([clientIds.length?gate.admin.from("crm_clientes").select("id,nombre,apellido").in("id",clientIds):Promise.resolve({data:[],error:null}),workerIds.length?gate.admin.from("workers").select("id,display_name").in("id",workerIds):Promise.resolve({data:[],error:null})]);
    if(clients.error)throw clients.error;if(workers.error)throw workers.error;
    const clientMap=new Map((clients.data||[]).map((r:any)=>[String(r.id),`${r.nombre||"Clienta"} ${r.apellido||""}`.trim()]));const workerMap=new Map((workers.data||[]).map((r:any)=>[String(r.id),r.display_name||"Central"]));
    return NextResponse.json({ok:true,reviews:reviews.map((r:any)=>({...r,clientName:clientMap.get(String(r.cliente_id))||"Clienta",workerName:workerMap.get(String(r.worker_id))||"Central"}))});
  } catch(error){console.error("[admin/central-reviews][GET]",error);return NextResponse.json({ok:false,error:"No se pudo cargar la moderación."},{status:500});}
}

export async function PATCH(req: Request) {
  try {
    const gate=await requireAdmin(req);if(!gate.ok)return NextResponse.json({ok:false,error:gate.error},{status:403});
    const body=await req.json().catch(()=>({}));const id=String(body.id||"");const status=String(body.status||"");const note=String(body.note||"").trim();
    if(!id||!["published","hidden","deleted"].includes(status))return NextResponse.json({ok:false,error:"Operación no válida."},{status:400});
    const {data,error}=await gate.admin.from("cliente_tarotista_reviews").update({status,moderation_note:note||null,moderated_at:new Date().toISOString(),moderated_by:gate.me.id,updated_at:new Date().toISOString()}).eq("id",id).select("id").maybeSingle();
    if(error)throw error;if(!data)return NextResponse.json({ok:false,error:"Reseña no encontrada."},{status:404});return NextResponse.json({ok:true});
  } catch(error){console.error("[admin/central-reviews][PATCH]",error);return NextResponse.json({ok:false,error:"No se pudo moderar la reseña."},{status:500});}
}
