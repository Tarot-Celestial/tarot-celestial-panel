import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const coinsUnconfirmed = () => reply({ok:false,code:"COINS_ADJUSTMENT_UNCONFIRMED",uncertain:true,error:"No se pudo confirmar la suma de Coins. Reintenta con la misma operación y los mismos datos para evitar duplicados."},503);

async function addCoins(gate: Extract<Awaited<ReturnType<typeof requireAdmin>>, {ok:true}>, body: any) {
 if(!uuid.test(body?.cliente_id||"")||!uuid.test(body?.operation_id||"")||!Number.isSafeInteger(body?.amount)||body.amount<1||body.amount>1_000_000||typeof body?.reason!=="string"||body.reason.trim().length<3||body.reason.trim().length>500) {
  return reply({ok:false,code:"INVALID_COINS_ADJUSTMENT",error:"Indica cliente, una cantidad entera de 1 a 1.000.000 Coins y un motivo de 3 a 500 caracteres."},400);
 }
 // authUserId comes from auth.getUser, never from the request body or an email
 // fallback's old worker.user_id. The RPC verifies its active admin link again.
 if(!uuid.test(gate.authUserId)) return reply({ok:false,code:"FORBIDDEN",error:"No se pudo verificar tu identidad de administración."},403);
 const operationId=body.operation_id.toLowerCase(),clientId=body.cliente_id.toLowerCase();
 try {
  const {data,error}=await gate.admin.rpc("tc_admin_adjust_coins",{
   p_operation_id:operationId,p_cliente_id:clientId,p_actor_user_id:gate.authUserId,
   p_amount:body.amount,p_reason:body.reason.trim(),
  });
  if(error) {
   const message=String(error.message||"");
   if(/\bFORBIDDEN\b/.test(message)) return reply({ok:false,code:"FORBIDDEN",error:"Tu cuenta debe estar vinculada a un administrador activo."},403);
   if(/\bCLIENT_NOT_FOUND\b/.test(message)) return reply({ok:false,code:"CLIENT_NOT_FOUND",error:"Cliente no encontrado. No se han añadido Coins."},404);
   if(/\bOPERATION_CONFLICT\b/.test(message)) return reply({ok:false,code:"OPERATION_CONFLICT",error:"Este identificador ya se utilizó con otros datos. Conserva la operación y revisa el historial antes de crear otra."},409);
   if(/\bCOIN_BALANCE_LIMIT\b/.test(message)) return reply({ok:false,code:"COIN_BALANCE_LIMIT",error:"La suma supera el saldo máximo admitido. Revisa el saldo antes de continuar."},409);
   if(/\b(INVALID_AMOUNT|INVALID_REASON|INVALID_ADJUSTMENT)\b/.test(message)) return reply({ok:false,code:"INVALID_COINS_ADJUSTMENT",error:"La cantidad o el motivo no son válidos. Revisa los datos del ajuste."},400);
   return coinsUnconfirmed();
  }
  if(!data || typeof data!=="object" || data.operation_id!==operationId || data.cliente_id!==clientId || Number(data.amount)!==body.amount || data.before_balance==null || data.after_balance==null || !Number.isFinite(Number(data.before_balance)) || !Number.isFinite(Number(data.after_balance))) return coinsUnconfirmed();
  return reply({ok:true,adjustment:data});
 } catch {return coinsUnconfirmed();}
}

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
   gate.admin.rpc("cliente_ruleta_resumen_ultra_v1",{p_cliente_id:id}),
   gate.admin.from("tc_admin_coin_adjustments").select("operation_id,amount,reason,before_balance,after_balance,movement_id,created_at").eq("cliente_id",id).order("created_at",{ascending:false}).limit(20),
  ]);
  for(const result of results) if(result.error) throw result.error;
  if(!results[0].data) return reply({ok:false,error:"Cliente no encontrado."},404);
  const wallet=results[1].data;
  return reply({ok:true,cliente:results[0].data,wallet:{coins:wallet.coins,minutes_free:wallet.minutes_free,minutes_normal:wallet.minutes_normal,minutes_total:wallet.minutes_total,effective_rank:wallet.effective_rank},spins:results.slice(3,8).map((r,i)=>({level:i+1,count:r.count||0,available:results[8].data[`level_${i+1}_spins`]})),history:results[2].data,coins_history:results[9].data});
 }catch{ return reply({ok:false,error:"No se pudieron consultar los saldos. Reintenta."},503); }
}
export async function POST(req: Request) {
 try {
  const gate=await requireAdmin(req);
  if(!gate.ok) return reply({ok:false,code:"FORBIDDEN",error:"Acceso reservado a administración."},403);
  const b=await req.json().catch(()=>null);
  if(b?.action==="coins") return addCoins(gate,b);
  if(b?.action!==undefined && b.action!=="spins") return reply({ok:false,code:"INVALID_ACTION",error:"Tipo de ajuste no válido."},400);
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
