\
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const cliente_id = String(body?.cliente_id || "").trim();
    const tarotista_worker_id = String(body?.tarotista_worker_id || "").trim() || null;
    const tarotista_nombre_manual = String(body?.tarotista_nombre_manual || "").trim() || null;
    const fecha_reserva = String(body?.fecha_reserva || "").trim();
    const nota = String(body?.nota || "").trim() || null;

    if (!cliente_id) {
      return NextResponse.json({ ok: false, error: "cliente_id requerido" }, { status: 400 });
    }
    if (!fecha_reserva) {
      return NextResponse.json({ ok: false, error: "fecha_reserva requerida" }, { status: 400 });
    }
    if (!tarotista_worker_id && !tarotista_nombre_manual) {
      return NextResponse.json({ ok: false, error: "tarotista requerida" }, { status: 400 });
    }

    const supabase = adminClient();

    const { data, error } = await supabase
      .from("crm_reservas")
      .insert({
        cliente_id,
        tarotista_worker_id,
        tarotista_nombre_manual,
        fecha_reserva,
        nota,
        estado: "pendiente",
        avisada: false,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, reserva: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error creando reserva" }, { status: 500 });
  }
}
