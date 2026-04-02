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

export async function POST(req: Request) {
  try {
    const { month } = await req.json();

    if (!month) {
      return NextResponse.json({ ok: false, error: "month requerido" }, { status: 400 });
    }

    const [year, monthNum] = month.split("-").map(Number);
    const from = `${month}-01`;
    const toDate = new Date(year, monthNum, 1);
    const to = toDate.toISOString().slice(0, 10);

    await supabase.from("invoice_lines").delete().eq("month_key", month);
    await supabase.from("invoices").delete().eq("month_key", month);

    const { data: calls } = await supabase
      .from("calls")
      .select("worker_id, tarotista, minutos, codigo, call_date")
      .gte("call_date", from)
      .lt("call_date", to);

    const totals: Record<string, { minutos: number; importe: number }> = {};

    for (const c of calls || []) {
      let key = "";

      if (c.worker_id) {
        key = c.worker_id;
      } else {
        key = c.tarotista?.toLowerCase().trim();
      }

      if (!key) continue;

      if (!totals[key]) {
        totals[key] = { minutos: 0, importe: 0 };
      }

      const min = toNumber(c.minutos);

      let imp = 0;
      if (!c.worker_id) {
        imp = min * 0.12;
      } else {
        imp = calcImporte(c.codigo, min);
      }

      totals[key].minutos += min;
      totals[key].importe += imp;
    }

    let created = 0;

    for (const key in totals) {
      const t = totals[key];

      let worker_id: string | null = null;

      if (key.length > 20) {
        worker_id = key;
      }

      const { data: invoice, error } = await supabase
        .from("invoices")
        .insert({
          worker_id,
          month_key: month,
          status: "pending",
          total: t.importe,
          notes: worker_id ? null : key,
        })
        .select()
        .single();

      if (error || !invoice) continue;

      await supabase.from("invoice_lines").insert([
        {
          invoice_id: invoice.id,
          label: "Minutos",
          amount: t.minutos,
          month_key: month,
        },
        {
          invoice_id: invoice.id,
          label: "Importe",
          amount: t.importe,
          month_key: month,
        },
      ]);

      created++;
    }

    return NextResponse.json({ ok: true, created });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
