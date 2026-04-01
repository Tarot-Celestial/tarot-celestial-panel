import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

export async function POST() {
  try {
    const month_key = getMonthKey();
    const [year, month] = month_key.split("-").map(Number);

    const start = `${year}-${String(month).padStart(2,"0")}-01`;
    const end = new Date(year, month, 0).toISOString().slice(0,10);

    // 🔥 SOLO CAMPOS REALES (sin worker_id que no existe)
    const { data, error } = await supabase
      .from("calls")
      .select("tarotista, minutos, importe")
      .gte("call_date", start)
      .lte("call_date", end);

    if (error) throw error;

    const map = {};

    for (const r of data || []) {
      const key = r.tarotista || "sin_nombre";

      if (!map[key]) {
        map[key] = {
          tarotista: key,
          total_minutos: 0,
          total_importe: 0
        };
      }

      map[key].total_minutos += Number(r.minutos) || 0;
      map[key].total_importe += Number(r.importe) || 0;
    }

    return NextResponse.json({
      ok: true,
      workers: Object.values(map)
    });

  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
