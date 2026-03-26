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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const estado = String(searchParams.get("estado") || "").trim();

    const supabase = adminClient();

    let query = supabase
      .from("crm_reservas")
      .select(`
        *,
        cliente:cliente_id ( id, nombre, apellido, telefono ),
        worker:tarotista_worker_id ( id, display_name )
      `)
      .order("fecha_reserva", { ascending: true });

    if (estado) {
      query = query.eq("estado", estado);
    }

    const { data, error } = await query;
    if (error) throw error;

    const reservas = (data || []).map((r: any) => ({
      ...r,
      cliente_nombre: [r?.cliente?.nombre, r?.cliente?.apellido].filter(Boolean).join(" "),
      cliente_telefono: r?.cliente?.telefono || "",
      tarotista_display_name: r?.worker?.display_name || "",
    }));

    return NextResponse.json({ ok: true, reservas });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error listando reservas" }, { status: 500 });
  }
}
