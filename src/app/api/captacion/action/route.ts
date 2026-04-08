import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { lead_id, action } = await req.json();

  const { data: lead } = await supabase
    .from("captacion_leads")
    .select("*")
    .eq("id", lead_id)
    .single();

  let intento = lead.intento_actual || 1;
  let estado = lead.estado;
  let next = new Date();

  if(action==="contactado"){
    estado="contactado";
  }

  if(action==="no_responde"){
    intento++;
    estado = intento===2 ? "reintento_2" : "reintento_3";
    next.setDate(next.getDate()+1);
  }

  if(action==="no_interesado") estado="no_interesado";
  if(action==="numero_invalido") estado="numero_invalido";

  await supabase.from("captacion_leads").update({
    estado,
    intento_actual:intento,
    next_contact_at:next.toISOString()
  }).eq("id", lead_id);

  return NextResponse.json({ ok:true });
}
