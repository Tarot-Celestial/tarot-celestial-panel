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

    // 🔥 1. TRAER WORKERS TAROTISTAS
    const { data: workers } = await supabase
      .from("workers")
      .select("id, display_name")
      .eq("role", "tarotista");

    // 🔥 2. TRAER MAPPING
    const { data: mapping } = await supabase
      .from("tarot_mapping")
      .select("sheet_name, worker_id");

    const mapWorkers: Record<string, string> = {};
    (mapping || []).forEach((m: any) => {
      mapWorkers[m.sheet_name?.toLowerCase().trim()] = m.worker_id;
    });

    // 🔥 3. TRAER CALLS DEL MES
    const { data: calls } = await supabase
      .from("calls")
      .select("tarotista, minutos, importe")
      .gte("call_date", start)
      .lte("call_date", end);

    // 🔥 4. AGRUPAR CALLS POR NOMBRE
    const callsMap: Record<string, { minutos: number; importe: number }> = {};

    for (const c of calls || []) {
      const key = (c.tarotista || "").toLowerCase().trim();

      if (!callsMap[key]) {
        callsMap[key] = { minutos: 0, importe: 0 };
      }

      callsMap[key].minutos += Number(c.minutos) || 0;
      callsMap[key].importe += Number(c.importe) || 0;
    }

    const created = [];

    // 🔥 5. RECORRER TODOS LOS WORKERS
    for (const w of workers || []) {
      const worker_id = w.id;

      // 🔥 CLAVE: obtener TODOS los alias de ese worker
      const keys = Object.entries(mapWorkers)
        .filter(([_, id]) => id === worker_id)
        .map(([key]) => key);

      // 🔥 sumar todas sus llamadas
      let total_minutos = 0;
      let total_importe = 0;

      for (const k of keys) {
        const t = callsMap[k];
        if (t) {
          total_minutos += t.minutos;
          total_importe += t.importe;
        }
      }

      const totals = {
        minutos: total_minutos,
        importe: total_importe,
      };

      // 🔥 evitar duplicados
      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("worker_id", worker_id)
        .eq("month_key", month_key)
        .maybeSingle();

      if (existing) continue;

      // 🔥 crear factura (aunque sea 0)
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

      // 🔥 líneas
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
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
