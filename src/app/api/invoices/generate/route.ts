import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function toNumber(val: any) {
  if (!val) return 0;
  return Number(String(val).replace(",", ".").replace("€", "").trim()) || 0;
}

function calcImporte(codigo: string, minutos: number) {
  const c = (codigo || "").toLowerCase();

  if (c === "free") return minutos * 0.04;
  if (c === "rueda") return minutos * 0.08;
  if (c === "cliente") return minutos * 0.12;
  if (c === "repite") return minutos * 0.14;

  return 0;
}

export async function POST() {
  try {
    const month_key = "2026-04";

    // 🔥 limpiar facturas
    await supabase.from("invoice_lines").delete().neq("id", "");
    await supabase.from("invoices").delete().neq("id", "");

    // 🔥 workers tarotistas
    const { data: workers } = await supabase
      .from("workers")
      .select("id, display_name")
      .eq("role", "tarotista");

    // 🔥 llamadas
    const { data: calls } = await supabase
      .from("calls")
      .select("worker_id, minutos, codigo")
      .gte("call_date", "2026-04-01")
      .lte("call_date", "2026-04-30");

    // 🔥 agrupar por worker_id
    const totalsByWorker: Record<
      string,
      { minutos: number; importe: number }
    > = {};

    for (const c of calls || []) {
      const worker_id = c.worker_id;

      if (!worker_id) continue;

      if (!totalsByWorker[worker_id]) {
        totalsByWorker[worker_id] = { minutos: 0, importe: 0 };
      }

      const min = toNumber(c.minutos);
      const imp = calcImporte(c.codigo, min);

      totalsByWorker[worker_id].minutos += min;
      totalsByWorker[worker_id].importe += imp;
    }

    let created = 0;

    for (const w of workers || []) {
      const totals = totalsByWorker[w.id] || {
        minutos: 0,
        importe: 0,
      };

      const { data: invoice } = await supabase
        .from("invoices")
        .insert({
          worker_id: w.id,
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
          kind: "minutos",
          label: "Minutos",
          amount: totals.minutos,
        },
        {
          invoice_id: invoice.id,
          kind: "importe",
          label: "Importe",
          amount: totals.importe,
        },
      ]);

      created++;
    }

    return NextResponse.json({
      ok: true,
      created,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
