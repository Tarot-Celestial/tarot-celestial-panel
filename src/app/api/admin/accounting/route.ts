
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const entryDate = body.date || body.fecha;

    if (!entryDate) {
      return NextResponse.json({ ok: false, error: "DATE_REQUIRED" });
    }

    const d = new Date(entryDate);
    const fixed = new Date(d.getTime() - d.getTimezoneOffset() * 60000);

    const month_key = fixed.toISOString().slice(0, 7);

    const { error } = await supabase.from("accounting_entries").insert({
      entry_date: fixed.toISOString(),
      month_key,
      entry_type: body.type || body.entry_type,
      concept: body.concept,
      amount_eur: Number(body.amount || body.amount_eur || 0),
      note: body.note || null,
    });

    if (error) {
      console.error("INSERT ERROR:", error);
      return NextResponse.json({ ok: false, error: error.message });
    }

    return NextResponse.json({ ok: true });

  } catch (e:any) {
    console.error(e);
    return NextResponse.json({ ok:false, error:e.message });
  }
}
