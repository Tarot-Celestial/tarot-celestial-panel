import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
export async function GET(req: Request) {
 try {
  const gate = await requireAdmin(req);
  if (!gate.ok) return reply({ok:false,error:"Acceso reservado a administración."},403);
  const params = new URL(req.url).searchParams, id = params.get("id");
  if (!id) {
   const q = (params.get("q") || "").replace(/[^\p{L}\p{N}\s@+.\-]/gu," ").trim().slice(0,100);
   if (q.length<2) return reply({ok:true,clients:[]});
   let query = gate.admin.from("crm_clientes").select("id,nombre,apellido,telefono,email");
   for (const token of q.split(/\s+/).slice(0,5)) query=query.or(`nombre.ilike.%${token}%,apellido.ilike.%${token}%,telefono.ilike.%${token}%,telefono_normalizado.ilike.%${token}%,email.ilike.%${token}%`);
   const result=await query.order("nombre").limit(25);
   if(result.error) throw result.error;
   return reply({ok:true,clients:result.data});
  }
  if(!uuid.test(id)) return reply({ok:false,error:"Cliente no válido."},400);
  const results=await Promise.all([
   gate.admin.from("crm_clientes").select("id,nombre,apellido,telefono,email").eq("id",id).maybeSingle(),
   gate.admin.rpc("tc_client_state_snapshot",{p_cliente_id:id}),
   gate.admin.from("tc_admin_spin_adjustments").select("operation_id,nivel,delta,reason,before_count,after_count,created_at").eq("cliente_id",id).order("created_at",{ascending:false}).limit(20),
   ...[1,2,3,4,5].map(level=>gate.admin.from("cliente_ruleta_giros").select("id",{count:"exact",head:true}).eq("cliente_id",id).eq("nivel",level).eq("estado","pending")),
  ]);
  for(const result of results) if(result.error) throw result.error;
  if(!results[0].data) return reply({ok:false,error:"Cliente no encontrado."},404);
  const wallet=results[1].data;
  return reply({ok:true,cliente:results[0].data,wallet:{coins:wallet.coins,minutes_free:wallet.minutes_free,minutes_normal:wallet.minutes_normal,minutes_total:wallet.minutes_total,effective_rank:wallet.effective_rank},spins:results.slice(3).map((r,i)=>({level:i+1,count:r.count||0})),history:results[2].data});
 }catch{ return reply({ok:false,error:"No se pudieron consultar los saldos. Reintenta."},503); }
}
export async function POST(req: Request) {
 try {
  const gate=await requireAdmin(req);
  if(!gate.ok) return reply({ok:false,error:"Acceso reservado a administración."},403);
  const b=await req.json().catch(()=>null);
  if(!uuid.test(b?.cliente_id||"")||!uuid.test(b?.operation_id||"")||!Number.isInteger(b?.level)||b.level<1||b.level>5||!Number.isInteger(b?.delta)||!b.delta||Math.abs(b.delta)>100||typeof b?.reason!=="string"||b.reason.trim().length<3||b.reason.trim().length>500) return reply({ok:false,error:"Indica cliente, nivel, cantidad (1–100) y motivo."},400);
  const {data,error}=await gate.admin.rpc("tc_admin_adjust_spins",{p_operation_id:b.operation_id,p_cliente_id:b.cliente_id,p_actor_user_id:gate.me.user_id,p_level:b.level,p_delta:b.delta,p_reason:b.reason.trim()});
  if(error){
   if(error.message.includes("INSUFFICIENT_SPINS"))return reply({ok:false,error:"No quedan suficientes giros disponibles de ese nivel. Actualiza la ficha."},409);
   if(error.message.includes("OPERATION_CONFLICT"))return reply({ok:false,error:"El intento no corresponde a este ajuste."},409);
   throw error;
  }
  return reply({ok:true,adjustment:data});
 }catch{return reply({ok:false,error:"No se pudo confirmar el ajuste. Reintenta con los mismos datos para evitar duplicados."},503);}
}
