import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { loadEffectiveClientRank } from "@/lib/server/client-rank-effective";
import { loadRolling30ClientTotals } from "@/lib/server/client-ranks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function phaseFor(type:any, progress:number, manual:number|null){
  const phases=Array.isArray(type?.fases)?type.fases:[];
  if(Number.isInteger(manual) && manual!>=0 && phases[manual!]) return {...phases[manual!],index:manual};
  const index=Math.max(0,phases.findIndex((p:any)=>progress>=Number(p.from||0)&&progress<=(Number(p.to??100))));
  return {...(phases[index]||{}),index};
}
function computed(row:any){
  if(!row)return null;
  let progress=Number(row.progreso_manual||0);
  if(row.modo!=="manual" && !row.override_automatico && row.estado==="activo" && row.fecha_inicio && row.fecha_fin_prevista){
    const a=new Date(row.fecha_inicio).getTime(), b=new Date(row.fecha_fin_prevista).getTime();
    if(b>a) progress=Math.max(0,Math.min(100,((Date.now()-a)/(b-a))*100));
  }
  if(row.estado==="completado")progress=100;
  const phase=phaseFor(row.ritual_types,progress,row.override_automatico?row.fase_manual:null);
  return {...row,progress:Number(progress.toFixed(1)),phase,message:row.mensaje_actual||phase.message||"Tu ritual continúa avanzando.",advice:row.consejo_actual||phase.advice||"Reserva un momento tranquilo para ti."};
}

export async function GET(req:Request){
  try{
    const gate=await clientFromRequest(req);
    if(!gate.uid)return NextResponse.json({ok:false,error:"NO_AUTH"},{status:401});
    if(!gate.cliente)return NextResponse.json({ok:false,error:"CLIENTE_NO_ENCONTRADO"},{status:404});
    const now=new Date(), since=new Date(now.getTime()-30*86400000);
    const totals=await loadRolling30ClientTotals(gate.admin,[gate.cliente],since.toISOString(),now.toISOString());
    const total=totals.get(String(gate.cliente.id))?.total||0;
    const rank=await loadEffectiveClientRank(gate.admin,String(gate.cliente.id),total);
    const diamond=rank.effective==="diamante";
    if(!diamond)return NextResponse.json({ok:true,diamond:false,rank:rank.effective||"sin_rango",ritual:null,history:[]});
    const {data:active,error}=await gate.admin.from("client_rituals").select("*,ritual_types(*)").eq("cliente_id",gate.cliente.id).in("estado",["pendiente","activo","pausado"]).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;
    const {data:history,error:hErr}=await gate.admin.from("client_rituals").select("id,estado,fecha_inicio,fecha_fin_real,created_at,ritual_types(nombre,slug)").eq("cliente_id",gate.cliente.id).in("estado",["completado","cancelado"]).order("created_at",{ascending:false}).limit(12);
    if(hErr)throw hErr;
    return NextResponse.json({ok:true,diamond:true,rank:"diamante",ritual:computed(active),history:history||[]});
  }catch(e:any){return NextResponse.json({ok:false,error:e?.message||"ERR_RITUAL"},{status:500});}
}
