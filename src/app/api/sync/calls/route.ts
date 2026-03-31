import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSLT1yIj5KRXABYpubiiM_9DQLqAT3zriTsW44S-SBvz_ZhjKJJu35pP9F4j-sT6Pt0hmRGsnqlulyM/pub?gid=1587355871&single=true&output=csv";

export async function POST() {
  try {
    const res = await fetch(SHEET_URL);
    const csv = await res.text();

    const rows = csv.split("\n").slice(1); // quitar header

    const parsed = rows.map((row) => {
      const cols = row.split(",");

      return {
        call_date: cols[0],
        telefonista: cols[1],
        tarotista: cols[2],
        minutos: Number(cols[3]),
        codigo: cols[4],
        importe: Number(cols[5]),
        captada: cols[6] === "TRUE",
      };
    });

    const clean = parsed.filter((r) => r.call_date);

    const { error } = await supabase
      .from("calls")
      .insert(clean);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message });
    }

    return NextResponse.json({
      ok: true,
      inserted: clean.length,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e.message,
    });
  }
}
