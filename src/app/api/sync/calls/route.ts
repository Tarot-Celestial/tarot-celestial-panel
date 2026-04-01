import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSLT1yIj5KRXABYpubiiM_9DQLqAT3zriTsW44S-SBvz_ZhjKJJu35pP9F4j-sT6Pt0hmRGsnqlulyM/pub?gid=1587355871&single=true&output=csv";

function formatDate(d: string) {
  if (!d) return null;
  const parts = d.split("/");
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeCodigo(c: string) {
  if (!c) return "cliente";
  const val = c.trim().toLowerCase();
  const allowed = ["cliente", "vip", "promo"];
  return allowed.includes(val) ? val : "cliente";
}

function createHash(row: string) {
  let hash = 0;
  for (let i = 0; i < row.length; i++) {
    hash = (hash << 5) - hash + row.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
}

export async function POST() {
  try {
    const res = await fetch(SHEET_URL);
    const csv = await res.text();

    const rows = csv.split("\n").slice(1);

    const parsed = rows.map((row) => {
      const cols = row.split(",");

      const hash = createHash(row);
      if (!hash) return null;

      return {
        call_date: formatDate(cols[0]),

        // 🔥 FIX REAL: columnas corregidas
        telefonista: cols[2]?.trim(), // antes mal
        tarotista: cols[3]?.trim(),   // antes mal

        minutos: Number(cols[4]) || 0,
        codigo: normalizeCodigo(cols[5]),
        importe: Number(cols[6]) || 0,
        captada: cols[7]?.trim() === "TRUE",

        source_row_hash: hash,
      };
    });

    const clean = parsed.filter(
      (r) =>
        r &&
        r.call_date &&
        r.source_row_hash &&
        !isNaN(r.minutos)
    );

    if (!clean.length) {
      return NextResponse.json({
        ok: false,
        error: "No hay datos válidos en el sheet",
      });
    }

    const { error } = await supabase
      .from("calls")
      .upsert(clean, {
        onConflict: "source_row_hash",
        ignoreDuplicates: true,
      });

    if (error) {
      return NextResponse.json({
        ok: false,
        error: error.message,
      });
    }

    await supabase.from("admin_notifications").insert({
      kind: "sync",
      title: "Sync completado",
      body: `Se procesaron ${clean.length} registros`,
    });

    return NextResponse.json({
      ok: true,
      processed: clean.length,
    });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e.message,
    });
  }
}

