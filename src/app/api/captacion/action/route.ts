import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { lead_id, action } = await req.json();

  const { data: lead, error } = await supabase
    .from("captacion_leads")
    .select("*")
    .eq("id", lead_id)
    .single();

  if (error || !lead) {
    return NextResponse.json({ ok: false, error: "Lead no encontrado" });
  }

  let estado = lead.estado;
  let intento = Number(lead.intento_actual || 1);
  let nextContactAt = lead.next_contact_at || new Date().toISOString();

  // 🔥 LÓGICA CORRECTA
  if (action === "contactado") {
    estado = "contactado";
  }

  if (action === "no_responde") {
    intento++;
    estado = intento === 2 ? "reintento_2" : "reintento_3";

    const next = new Date();
    next.setDate(next.getDate() + 1);
    nextContactAt = next.toISOString();
  }

  if (action === "no_interesado") {
    estado = "no_interesado";
  }

  if (action === "numero_invalido") {
    estado = "numero_invalido";
  }

  // 🔥 UPDATE REAL
  const { error: updateError } = await supabase
    .from("captacion_leads")
    .update({
      estado,
      intento_actual: intento,
      next_contact_at: nextContactAt,
      last_result: action,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lead_id);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message });
  }

  return NextResponse.json({ ok: true });
}
