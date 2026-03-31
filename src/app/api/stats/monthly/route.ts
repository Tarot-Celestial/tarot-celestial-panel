
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || "";

  const { data, error } = await supabase
    .from("calls")
    .select("importe, created_at");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message });
  }

  const total = (data || [])
    .filter((c) => c.created_at?.startsWith(month))
    .reduce((sum, c) => sum + Number(c.importe || 0), 0);

  return NextResponse.json({ ok: true, total, rows: data });
}
