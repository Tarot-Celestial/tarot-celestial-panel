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

    const start = `${year}-${String(month).padStart(2,"0")}-01`;
    const end = new Date(year, month, 0).toISOString().slice(0,10);

    // calls
    const { data: calls } = await supabase
      .from("calls")
      .select("tarotista, minutos, importe")
      .gte("call_date", start)
      .lte("call_date", end);

    if (!calls || calls.length === 0) {
      return NextResponse.json({ ok: true, message: "No hay llamadas" });
    }

    // mapping table
    const { data: mapping } = await supabase
      .from("tarot_mapping")
      .select("sheet_name, worker_id");

    const mapWorkers: Record<string,string> = {};
    (mapping || []).forEach((m:any)=>{
      mapWorkers[m.sheet_name?.toLowerCase()] = m.worker_id;
    });

    // agrupar
    const map: Record<string, any> = {};

    for (const c of calls) {
      const key = (c.tarotista || "sin_nombre").toLowerCase();

      if (!map[key]) {
        map[key] = { minutos: 0, importe: 0 };
      }

      map[key].minutos += Number(c.minutos) || 0;
      map[key].importe += Number(c.importe) || 0;
    }

    const created = [];

    for (const tarotista in map) {
      const worker_id = mapWorkers[tarotista];
      if (!worker_id) continue;

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

  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
