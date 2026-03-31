import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST() {
  try {
    const month = monthKeyNow();

    // 1. Obtener llamadas del mes
    const { data: calls, error } = await supabase
      .from("calls")
      .select("*")
      .gte("call_date", `${month}-01`)
      .lte("call_date", `${month}-31`);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message });
    }

    // 2. Agrupar por tarotista
    const grouped: Record<string, number> = {};

    for (const c of calls || []) {
      const key = c.tarotista || "Sin nombre";
      grouped[key] = (grouped[key] || 0) + Number(c.importe || 0);
    }

    // 3. Generar facturas
    const invoices = Object.entries(grouped).map(([name, total]) => ({
      worker_name: name,
      month_key: month,
      amount_eur: total,
      status: "pending",
    }));

    // 4. Insertar en tabla invoices
    const { error: insertError } = await supabase
      .from("worker_payments")
      .upsert(invoices, {
        onConflict: "worker_name,month_key",
      });

    if (insertError) {
      return NextResponse.json({
        ok: false,
        error: insertError.message,
      });
    }

    return NextResponse.json({
      ok: true,
      generated: invoices.length,
    });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e.message,
    });
  }
}
