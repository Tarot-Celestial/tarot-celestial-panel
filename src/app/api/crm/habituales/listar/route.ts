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

    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - 2);

    const { data: pagos, error } = await supabase
      .from("crm_pagos")
      .select("id, cliente_id, created_at, estado")
      .gte("created_at", fromDate.toISOString())
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

    const clientes = clienteIds.map((clienteId) => {
      const pago = latestByCliente.get(clienteId);
      const cliente = clientesMap.get(clienteId);

      return {
        id: clienteId,
        nombre: cliente
          ? [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ")
          : `Cliente ${clienteId.slice(0, 8)}`,
        telefono: cliente?.telefono || "—",
        ultima_llamada: pago?.created_at || null,
      };
    });

    return NextResponse.json({ ok: true, clientes });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Error cargando habituales" },
      { status: 500 }
    );
  }
}
