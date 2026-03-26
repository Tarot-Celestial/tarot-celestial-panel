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
      .select("*")
      .order("fecha_reserva", { ascending: true });

    if (estado) {
      query = query.eq("estado", estado);
    }

    const { data, error } = await query;
    if (error) throw error;

    const reservasBase = Array.isArray(data) ? data : [];

    const clienteIds = [...new Set(reservasBase.map((r: any) => String(r?.cliente_id || "")).filter(Boolean))];
    const workerIds = [...new Set(reservasBase.map((r: any) => String(r?.tarotista_worker_id || "")).filter(Boolean))];

    let clientesMap = new Map<string, any>();
    let workersMap = new Map<string, any>();

    if (clienteIds.length > 0) {
      const { data: clientes, error: clientesError } = await supabase
        .from("crm_clientes")
        .select("id, nombre, apellido, telefono")
        .in("id", clienteIds);

      if (!clientesError && Array.isArray(clientes)) {
        clientesMap = new Map(clientes.map((c: any) => [String(c.id), c]));
      }
    }

    if (workerIds.length > 0) {
      const { data: workers, error: workersError } = await supabase
        .from("workers")
        .select("id, display_name")
        .in("id", workerIds);

      if (!workersError && Array.isArray(workers)) {
        workersMap = new Map(workers.map((w: any) => [String(w.id), w]));
      }
    }

    const reservas = reservasBase.map((r: any) => {
      const cliente = clientesMap.get(String(r?.cliente_id || ""));
      const worker = workersMap.get(String(r?.tarotista_worker_id || ""));

      return {
        ...r,
        cliente_nombre: cliente ? [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ") : "",
        cliente_telefono: cliente?.telefono || "",
        tarotista_display_name: worker?.display_name || "",
      };
    });

    return NextResponse.json({ ok: true, reservas });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Error listando reservas" },
      { status: 500 }
    );
  }
}
