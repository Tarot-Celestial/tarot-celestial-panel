import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { makeMetaPanelCode, metaPanelCookie, tokenDigest, validPanelRef, validPanelToken } from "@/lib/server/office-meta-attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const reply = (body: Record<string,unknown>, status = 200) => NextResponse.json(body, {
  status, headers:{ "Cache-Control":"private, no-store", "Referrer-Policy":"no-referrer", "X-Robots-Tag":"noindex, nofollow" },
});
const unavailable = () => reply({ok:false,error:"Este enlace no está disponible."},404);
function panelToken(req:NextRequest) {
  const ref=req.nextUrl.searchParams.get("ref") || "";
  if (!validPanelRef(ref)) return "";
  const token=req.cookies.get(metaPanelCookie(ref))?.value || "";
  return validPanelToken(token) && tokenDigest(token).startsWith(ref) ? token : "";
}
export async function GET(req: NextRequest) {
  try {
    const token=panelToken(req);
    if (!token) return unavailable();
    const {data,error}=await supabaseAdmin().from("office_meta_panel_links").select("destination").eq("digest",tokenDigest(token)).gt("expires_at",new Date().toISOString()).maybeSingle();
    if (error) throw error;
    return data ? reply({ok:true,destination:data.destination}) : unavailable();
  } catch { return reply({ok:false,error:"No se pudo consultar el enlace."},503); }
}
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== new URL(req.url).origin) return reply({ok:false,error:"Solicitud no válida."},403);
    const token=panelToken(req);
    if (!token) return unavailable();
    const body=await req.json().catch(()=>null);
    if (body?.action==="visit") {
      const {data,error}=await supabaseAdmin().rpc("office_meta_panel_visit",{p_digest:tokenDigest(token)});
      if (error) throw error;
      return data ? reply({ok:true,destination:data}) : unavailable();
    }
    if (body?.action!=="challenge") return reply({ok:false,error:"Solicitud no válida."},400);
    const gate=await clientFromRequest(req);
    if (!gate.uid) return reply({ok:false,error:"Inicia sesión para vincular la conversación."},401);
    if (!gate.cliente) return reply({ok:false,error:"Tu cuenta no tiene una ficha vinculada."},403);
    const code=makeMetaPanelCode(token,gate.uid);
    const {data,error}=await gate.admin.rpc("office_meta_panel_challenge",{
      p_link:tokenDigest(token),p_code_hash:tokenDigest(code),p_client:gate.cliente.id,p_user:gate.uid,
    });
    if (error) throw error;
    if (data==="confirmed") return reply({ok:true,state:"confirmed"});
    if (data==="pending") return reply({ok:true,state:"pending",code});
    return reply({ok:false,error:"No se pudo vincular esta conversación con tu ficha."},409);
  } catch { return reply({ok:false,error:"No se pudo consultar la vinculación."},503); }
}
