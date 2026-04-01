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

    // 🔥 CALLS
    const { data: calls } = await supabase
      .from("calls")
      .select("tarotista, minutos, importe")
      .gte("call_date", start)
      .lte("call_date", end);

    if (!calls || calls.length === 0) {
      return NextResponse.json({ ok: true, message: "No hay llamadas" });
    }

    // 🔥 AGRUPAR
    const map: Record<string, any> = {};

    for (const c of calls) {
      const key = c.tarotista || "sin_nombre";

      if (!map[key]) {
        map[key] = { minutos: 0, importe: 0 };
      }

      map[key].minutos += Number(c.minutos) || 0;
      map[key].importe += Number(c.importe) || 0;
    }

    const created = [];

    // 🔥 TRAER TODOS LOS WORKERS
    const { data: workers } = await supabase
      .from("workers")
      .select("id, display_name");

    const workerMap: Record<string, string> = {};

    for (const w of workers || []) {
      workerMap[w.display_name?.toLowerCase()] = w.id;
    }

    // 🔥 CREAR FACTURAS
    for (const tarotista in map) {
      const worker_id = workerMap[tarotista.toLowerCase()];

      if (!worker_id) continue; // ❗ aquí estaba el problema

      const totals = map[tarotista];

      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("worker_id", worker_id)
        .eq("month_key", month_key)
        .maybeSingle();

      if (existing) continue;

      const { data: invoice } = await supabase
        .from("invoices")
        .insert({
          worker_id,
          month_key,
          status: "pending",
          total: totals.importe,
        })
        .select()
        .single();

      if (!invoice) continue;

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

      created.push(invoice);
    }

    return NextResponse.json({
      ok: true,
      created: created.length,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
