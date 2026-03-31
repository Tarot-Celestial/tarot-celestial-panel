
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("calls")
    .select("*")
    .gte("call_date", today)
    .order("call_date", { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message });
  }

  return NextResponse.json({ ok: true, rows: data });
}
