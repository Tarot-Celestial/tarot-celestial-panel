import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

// 🔥 AUTO MONTH KEY
function getCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

export async function POST(req: Request) {
  try {
    let body = {};
    try {
      body = await req.json();
    } catch {}

    let month_key = (body as any)?.month_key;

    // 🔥 SI NO VIENE → AUTO
    if (!month_key) {
      month_key = getCurrentMonthKey();
    }

    const [year, month] = month_key.split("-").map(Number);

    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(year, month, 0).toISOString().slice(0,10);

    const { data, error } = await supabase
      .from("calls")
      .select("*")
      .gte("call_date", start)
      .lte("call_date", end);

    if (error) throw error;

    return NextResponse.json({ ok: true, month_key, count: data.length });

  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
