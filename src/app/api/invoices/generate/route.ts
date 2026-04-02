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

    // limpiar
    await supabase.from("invoice_lines").delete().neq("id", "");
    await supabase.from("invoices").delete().neq("id", "");

    const { data: workers } = await supabase
      .from("workers")
      .select("id, display_name")
      .eq("role", "tarotista");

    const { data: calls } = await supabase
      .from("calls")
      .select("worker_id, tarotista, minutos, codigo")
      // SIN FILTRO

    const totals: Record<string, { minutos: number; importe: number }> = {};

    for (const c of calls || []) {
      let key = "";

      // 🔥 CASO 1 → tarotista normal
      if (c.worker_id) {
        key = c.worker_id;
      }
      // 🔥 CASO 2 → CALLXXX
      else {
        key = c.tarotista?.toLowerCase().trim();
      }

      if (!key) continue;

      if (!totals[key]) {
        totals[key] = { minutos: 0, importe: 0 };
      }

      const min = toNumber(c.minutos);

      // 🔥 CALLXXX tarifa fija
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

    // 🔥 FACTURAS TAROTISTAS NORMALES
    for (const w of workers || []) {
      const t = totals[w.id] || { minutos: 0, importe: 0 };

      const { data: invoice } = await supabase
        .from("invoices")
        .insert({
          worker_id: w.id,
          month_key,
          status: "pending",
          total: t.importe,
        })
        .select()
        .single();

      if (!invoice) continue;

      await supabase.from("invoice_lines").insert([
        {
          invoice_id: invoice.id,
          label: "Minutos",
          amount: t.minutos,
        },
        {
          invoice_id: invoice.id,
          label: "Importe",
          amount: t.importe,
        },
      ]);

      created++;
    }

    // 🔥 FACTURAS CALLXXX
    for (const key in totals) {
      if (key.includes("call")) {
        const t = totals[key];

        const { data: invoice } = await supabase
          .from("invoices")
          .insert({
            worker_id: null,
            month_key,
            status: "pending",
            total: t.importe,
            notes: key, // guardamos Call111 aquí
          })
          .select()
          .single();

        if (!invoice) continue;

        await supabase.from("invoice_lines").insert([
          {
            invoice_id: invoice.id,
            label: "Minutos",
            amount: t.minutos,
          },
          {
            invoice_id: invoice.id,
            label: "Importe",
            amount: t.importe,
          },
        ]);

        created++;
      }
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
