
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json();

  const date = new Date(body.date);

  // 🔥 FIX timezone (important)
  const correctedDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);

  const month_key = correctedDate.toISOString().slice(0,7);

  const { error } = await supabase.from("accounting_entries").insert({
    entry_date: correctedDate.toISOString(),
    month_key,
    entry_type: body.type,
    concept: body.concept,
    amount_eur: body.amount,
    note: body.note
  });

  if (error) {
    return NextResponse.json({ ok:false, error:error.message });
  }

  return NextResponse.json({ ok:true });
}
