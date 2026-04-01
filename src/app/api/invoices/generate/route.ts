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

    // 🔥 SOLO LECTURA (NO INSERT / NO UPDATE → evita stack depth)
    const { data, error } = await supabase
      .from("calls")
      .select("tarotista, minutos, importe")
      .gte("call_date", start)
      .lte("call_date", end);

    if (error) throw error;

    const result = [];

    const seen = new Set();

    for (const r of data || []) {
      const name = r.tarotista || "sin_nombre";

      if (seen.has(name)) continue;
      seen.add(name);

      result.push({
        tarotista: name
      });
    }

    return NextResponse.json({
      ok: true,
      month_key,
      tarotistas: result
    });

  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}

