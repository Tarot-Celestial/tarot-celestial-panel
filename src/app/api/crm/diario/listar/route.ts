import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function dayRange(mode: string, dateValue: string | null) {
  const now = new Date();

  if (mode === "ayer") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return { start, end };
  }

  if (mode === "fecha" && dateValue) {
    const [y, m, d] = dateValue.split("-").map(Number);
    const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
    const end = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
    return { start, end };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = String(searchParams.get("mode") || "hoy");
    const dateValue = searchParams.get("date");

    const { start, end } = dayRange(mode, dateValue);
    const supabase = adminClient();

    const { data: pagos, error } = await supabase
      .from("crm_cliente_pagos")
      .select("id, cliente_id, created_at, estado, importe")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .eq("estado", "completed")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const pagosRows = Array.isArray(pagos) ? pagos : [];
    const latestByCliente = new Map<string, any>();

    for (const p of pagosRows) {
      const clienteId = String(p?.cliente_id || "");
      if (!clienteId) continue;
      if (!latestByCliente.has(clienteId)) {
        latestByCliente.set(clienteId, p);
      }
    }

    const clienteIds = Array.from(latestByCliente.keys());
    let clientesMap = new Map<string, any>();

    if (clienteIds.length > 0) {
      const posiblesTablasClientes = ["crm_clientes", "clientes", "crm_clientes_panel"];
      for (const tabla of posiblesTablasClientes) {
        const { data: clientes, error: clientesError } = await supabase
          .from(tabla)
          .select("id, nombre, apellido, telefono")
          .in("id", clienteIds);

        if (!clientesError && Array.isArray(clientes) && clientes.length > 0) {
          clientesMap = new Map(clientes.map((c: any) => [String(c.id), c]));
          break;
        }
      }
    }

    const rows = clienteIds.map((clienteId) => {
      const pago = latestByCliente.get(clienteId);
      const cliente = clientesMap.get(clienteId);

      return {
        id: clienteId,
        nombre: cliente
          ? [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ")
          : `Cliente ${clienteId.slice(0, 8)}`,
        telefono: cliente?.telefono || "—",
        ultima_compra: pago?.created_at || null,
      };
    });

    const totals = {
      total_clientes: rows.length,
      total_pagos: pagosRows.length,
      total_importe: pagosRows.reduce((acc: number, p: any) => acc + (Number(p?.importe) || 0), 0),
    };

    return NextResponse.json({ ok: true, rows, totals });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Error cargando diario" },
      { status: 500 }
    );
  }
}
