import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSLT1yIj5KRXABYpubiiM_9DQLqAT3zriTsW44S-SBvz_ZhjKJJu35pP9F4j-sT6Pt0hmRGsnqlulyM/pub?gid=1587355871&single=true&output=csv";

// 🔥 Convertir DD/MM/YYYY → YYYY-MM-DD
function formatDate(d: string) {
  if (!d) return null;

  const parts = d.split("/");
  if (parts.length !== 3) return null;

  const [day, month, year] = parts;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function POST() {
  try {
    // 1. Descargar CSV
    const res = await fetch(SHEET_URL);
    const csv = await res.text();

    // 2. Parsear filas
    const rows = csv.split("\n").slice(1);

    const parsed = rows.map((row) => {
      const cols = row.split(",");

      return {
        call_date: formatDate(cols[0]),
        telefonista: cols[1]?.trim(),
        tarotista: cols[2]?.trim(),
        minutos: Number(cols[3]) || 0,
        codigo: cols[4]?.trim(),
        importe: Number(cols[5]) || 0,
        captada: cols[6]?.trim() === "TRUE",
      };
    });

    // 3. Limpiar datos inválidos
    const clean = parsed.filter(
      (r) => r.call_date && !isNaN(r.minutos)
    );

    if (!clean.length) {
      return NextResponse.json({
        ok: false,
        error: "No hay datos válidos en el sheet",
      });
    }

    // 4. Insertar en Supabase
    const { error } = await supabase.from("calls").insert(clean);

    if (error) {
      return NextResponse.json({
        ok: false,
        error: error.message,
      });
    }

    // 5. Respuesta OK
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
