import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

// 🔥 SAFE SPLIT
function safeSplit(value: any) {
  if (!value || typeof value !== "string") return null;
  return value.split("-");
}

export async function POST(req: Request) {
  try {
    const { month_key } = await req.json();

    if (!month_key) {
      return NextResponse.json({ ok: false, error: "month_key requerido" }, { status: 400 });
    }

    const parts = safeSplit(month_key);

    if (!parts || parts.length !== 2) {
      return NextResponse.json({ ok: false, error: "month_key inválido" }, { status: 400 });
    }

    const [year, month] = parts.map(Number);

    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(year, month, 0).toISOString().slice(0,10);

    const { data, error } = await supabase
      .from("calls")
      .select("*")
      .gte("call_date", start)
      .lte("call_date", end);

    if (error) throw error;

    return NextResponse.json({ ok: true, count: data.length });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
