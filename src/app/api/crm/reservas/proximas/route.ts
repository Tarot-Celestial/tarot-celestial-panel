import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET() {
  try {
    const supabase = adminClient();

    const now = new Date();
    const from = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const to = new Date(now.getTime() + 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("crm_reservas")
      .select(`
        *,
        cliente:cliente_id ( id, nombre, apellido, telefono ),
        worker:tarotista_worker_id ( id, display_name )
      `)
      .eq("estado", "pendiente")
      .eq("avisada", false)
      .gte("fecha_reserva", from)
      .lte("fecha_reserva", to)
      .order("fecha_reserva", { ascending: true });

    if (error) throw error;

    const reservas = (data || []).map((r: any) => ({
      ...r,
      cliente_nombre: [r?.cliente?.nombre, r?.cliente?.apellido].filter(Boolean).join(" "),
      cliente_telefono: r?.cliente?.telefono || "",
      tarotista_display_name: r?.worker?.display_name || "",
    }));

    return NextResponse.json({ ok: true, reservas });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error cargando próximas reservas" }, { status: 500 });
  }
}
