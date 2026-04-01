import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST() {
  try {
    const month_key = getMonthKey();
    const [year, month] = month_key.split("-").map(Number);

    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(year, month, 0).toISOString().slice(0, 10);

    // 🔥 1. TRAER CALLS
    const { data: calls, error } = await supabase
      .from("calls")
      .select("tarotista, minutos, importe")
      .gte("call_date", start)
      .lte("call_date", end);

    if (error) throw error;

    if (!calls || calls.length === 0) {
      return NextResponse.json({ ok: true, message: "No hay datos" });
    }

    // 🔥 2. AGRUPAR POR TAROTISTA
    const map: Record<string, { minutos: number; importe: number }> = {};

    for (const c of calls) {
      const name = c.tarotista || "sin_nombre";

      if (!map[name]) {
        map[name] = { minutos: 0, importe: 0 };
      }

      map[name].minutos += Number(c.minutos) || 0;
      map[name].importe += Number(c.importe) || 0;
    }

    const results = [];

    // 🔥 3. CREAR FACTURAS
    for (const tarotista in map) {
      const totals = map[tarotista];

      // buscar worker
      const { data: worker } = await supabase
        .from("workers")
        .select("id")
        .eq("display_name", tarotista)
        .single();

      if (!worker) continue;

      // evitar duplicados
      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("worker_id", worker.id)
        .eq("month_key", month_key)
        .maybeSingle();

      if (existing) continue;

      // crear factura
      const { data: invoice } = await supabase
        .from("invoices")
        .insert({
          worker_id: worker.id,
          month_key,
          status: "pending",
          total: totals.importe,
        })
        .select()
        .single();

      if (!invoice) continue;

      // líneas
      await supabase.from("invoice_lines").insert([
        {
          invoice_id: invoice.id,
          kind: "minutes_cliente",
          label: "Minutos",
          amount: totals.minutos,
        },
        {
          invoice_id: invoice.id,
          kind: "salary_base",
          label: "Importe",
          amount: totals.importe,
        },
      ]);

      results.push(invoice);
    }

    return NextResponse.json({
      ok: true,
      created: results.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
