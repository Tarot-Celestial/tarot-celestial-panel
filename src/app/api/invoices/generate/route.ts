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

    // 🔥 1. Obtener llamadas del mes
    const { data: calls, error } = await supabase
      .from("calls")
      .select("*")
      .gte("call_date", `${month}-01`)
      .lte("call_date", `${month}-31`);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message });
    }

    // 🔥 2. Obtener trabajadores
    const { data: workers } = await supabase
      .from("workers")
      .select("id, name");

    // 🔥 3. Crear mapa nombre → worker_id
    const workerMap: Record<string, string> = {};

    for (const w of workers || []) {
      workerMap[w.name?.toLowerCase()] = w.id;
    }

    // 🔥 4. Agrupar ingresos por worker_id
    const grouped: Record<string, number> = {};

    for (const c of calls || []) {
      const name = c.tarotista?.toLowerCase();
      const workerId = workerMap[name];

      if (!workerId) continue;

      grouped[workerId] =
        (grouped[workerId] || 0) + Number(c.importe || 0);
    }

    // 🔥 5. Crear facturas
    const invoices = Object.entries(grouped).map(
      ([worker_id, total]) => ({
        worker_id,
        month_key: month,
        amount_eur: total,
        is_paid: false,
      })
    );

    // 🔥 6. UPSERT real
    const { error: insertError } = await supabase
      .from("worker_payments")
      .upsert(invoices, {
        onConflict: "worker_id,month_key",
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
