import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { listTarotistaWorkers } from "@/lib/server/rendimiento-metrics";

export const runtime = "nodejs";
const ALLOWED = new Set(["maria", "maría", "yami", "michael"]);
const norm = (v: unknown) => String(v || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function allowedWorkers() {
  const workers = await listTarotistaWorkers();
  return (workers || []).filter((w: any) => w?.is_active !== false && String(w?.role || "tarotista") === "tarotista" && ALLOWED.has(norm(w?.display_name)));
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok:false, error:"NO_AUTH" }, { status:401 });
    const workers = await allowedWorkers();
    const ids = workers.map((w:any)=>String(w.id));
    if (!ids.length) return NextResponse.json({ ok:true, tarotistas:[] });
    const { data, error } = await gate.admin.from("cliente_tarotista_reviews").select("id,cliente_id,worker_id,rating,comment,status,created_at,updated_at").in("worker_id",ids).eq("status","published").order("created_at",{ascending:false});
    if (error) throw error;
    const rows = data || [];
    return NextResponse.json({ ok:true, tarotistas: workers.map((w:any)=>{
      const reviews=rows.filter((r:any)=>String(r.worker_id)===String(w.id));
      const mine=reviews.find((r:any)=>String(r.cliente_id)===String(gate.cliente.id))||null;
      const avg=reviews.length?reviews.reduce((s:number,r:any)=>s+Number(r.rating||0),0)/reviews.length:0;
      return { id:String(w.id), nombre:String(w.display_name||"Tarotista"), average:avg, count:reviews.length, mine, reviews:reviews.slice(0,30).map((r:any)=>({id:r.id,rating:r.rating,comment:r.comment,created_at:r.created_at,isMine:String(r.cliente_id)===String(gate.cliente.id)})) };
    }) });
  } catch(e:any) { console.error("[cliente/resenas][GET]",e); return NextResponse.json({ok:false,error:"No se pudieron cargar las reseñas."},{status:500}); }
}

export async function POST(req: Request) {
  try {
    const gate=await clientFromRequest(req); if(!gate.uid||!gate.cliente)return NextResponse.json({ok:false,error:"NO_AUTH"},{status:401});
    const body=await req.json().catch(()=>({})); const workerId=String(body.workerId||""); const rating=Number(body.rating); const comment=String(body.comment||"").trim();
    if(!Number.isInteger(rating)||rating<1||rating>5||comment.length>500)return NextResponse.json({ok:false,error:"Datos de reseña no válidos."},{status:400});
    const workers=await allowedWorkers(); if(!workers.some((w:any)=>String(w.id)===workerId))return NextResponse.json({ok:false,error:"Tarotista no válida."},{status:400});
    const {error}=await gate.admin.from("cliente_tarotista_reviews").upsert({cliente_id:gate.cliente.id,worker_id:workerId,rating,comment,status:"published",updated_at:new Date().toISOString()},{onConflict:"cliente_id,worker_id"});
    if(error)throw error; return NextResponse.json({ok:true});
  } catch(e:any){console.error("[cliente/resenas][POST]",e);return NextResponse.json({ok:false,error:"No se pudo guardar la reseña."},{status:500});}
}
