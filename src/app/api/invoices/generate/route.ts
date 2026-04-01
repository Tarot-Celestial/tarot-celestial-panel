import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { buildMonthDateRange } from "@/lib/date";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { month_key } = await req.json();

    const { start, end } = buildMonthDateRange(month_key);

    // example usage (replace your logic if needed)
    const { data, error } = await supabase
      .from("calls")
      .select("*")
      .gte("created_at", start)
      .lte("created_at", end);

    if (error) throw error;

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
