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
    const from = new Date(now.getTime() - 60 * 1000).toISOString();
    const to = new Date(now.getTime() + 2 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("crm_reservas")
      .select("*")
      .eq("estado", "pendiente")
      .eq("avisada", false)
      .gte("fecha_reserva", from)
      .lte("fecha_reserva", to)
      .order("fecha_reserva", { ascending: true })
      .limit(1);

    if (error) throw error;

    const reservasBase = Array.isArray(data) ? data : [];
    if (reservasBase.length === 0) {
      return NextResponse.json({ ok: true, reservas: [] });
    }

    const reserva = reservasBase[0];
    const clienteId = String(reserva?.cliente_id || "");
    const workerId = String(reserva?.tarotista_worker_id || "");

    let cliente = null;
    let worker = null;

    if (clienteId) {
      for (const tabla of ["crm_clientes", "clientes", "crm_clientes_panel"]) {
        const { data: c, error: ce } = await supabase
          .from(tabla)
          .select("id, nombre, apellido, telefono")
          .eq("id", clienteId)
          .maybeSingle();

        if (!ce && c) {
          cliente = c;
          break;
        }
      }
    }

    if (workerId) {
      const { data: w } = await supabase
        .from("workers")
        .select("id, display_name")
        .eq("id", workerId)
        .maybeSingle();
      worker = w || null;
    }

    const enriched = {
      ...reserva,
      cliente_nombre: cliente ? [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ") : "",
      cliente_telefono: cliente?.telefono || "",
      tarotista_display_name: worker?.display_name || "",
    };

    return NextResponse.json({ ok: true, reservas: [enriched] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Error cargando próximas reservas" },
      { status: 500 }
    );
  }
}
