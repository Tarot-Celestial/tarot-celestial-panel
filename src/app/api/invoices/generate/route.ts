import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function normalize(s: string) {
  return (s || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toNumber(val: any) {
  if (!val) return 0;
  return Number(String(val).replace("€", "").replace(",", ".").trim()) || 0;
}

function calcImporte(codigo: string, minutos: number) {
  const code = (codigo || "").toLowerCase().trim();

  if (code === "free") return minutos * 0.04;
  if (code === "rueda") return minutos * 0.08;
  if (code === "cliente") return minutos * 0.12;
  if (code === "repite") return minutos * 0.14;

  return 0;
}

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

    const { data: workers } = await supabase
      .from("workers")
      .select("id, display_name")
      .eq("role", "tarotista");

    const { data: calls } = await supabase
      .from("calls")
      .select("tarotista, minutos, codigo")
      .gte("call_date", start)
      .lte("call_date", end);

    const callsMap: Record<string, { minutos: number; importe: number }> = {};

    for (const c of calls || []) {
      const key = normalize(c.tarotista);

      if (!callsMap[key]) {
        callsMap[key] = { minutos: 0, importe: 0 };
      }

      const minutos = toNumber(c.minutos);
      const importe = calcImporte(c.codigo, minutos);

      callsMap[key].minutos += minutos;
      callsMap[key].importe += importe;
    }

    const created = [];

    for (const w of workers || []) {
      const worker_id = w.id;
      const name = normalize(w.display_name);

      const totals = callsMap[name] || {
        minutos: 0,
        importe: 0,
      };

      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("worker_id", worker_id)
        .eq("month_key", month_key)
        .maybeSingle();

      if (existing) {
  await supabase
    .from("invoices")
    .update({
      total: totals.importe,
    })
    .eq("id", existing.id);

  continue;
}
      
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
          kind: "minutes_total",
          label: "Minutos",
          amount: totals.minutos,
        },
        {
          invoice_id: invoice.id,
          kind: "importe_total",
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
