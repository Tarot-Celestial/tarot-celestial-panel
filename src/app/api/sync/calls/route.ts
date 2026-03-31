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

// 🔥 Normalizar código (evita constraint)
function normalizeCodigo(c: string) {
  if (!c) return "cliente";
  const val = c.trim().toLowerCase();
  const allowed = ["cliente", "vip", "promo"];
  return allowed.includes(val) ? val : "cliente";
}

// 🔥 Hash único por fila
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
    // 1. Descargar CSV
    const res = await fetch(SHEET_URL);
    const csv = await res.text();

    // 2. Separar filas
    const rows = csv.split("\n").slice(1);

    // 3. Parsear datos
    const parsed = rows.map((row) => {
      const cols = row.split(",");

      const hash = createHash(row);
      if (!hash) return null;

      return {
        call_date: formatDate(cols[0]),
        telefonista: cols[1]?.trim(),
        tarotista: cols[2]?.trim(),
        minutos: Number(cols[3]) || 0,
        codigo: normalizeCodigo(cols[4]),
        importe: Number(cols[5]) || 0,
        captada: cols[6]?.trim() === "TRUE",
        source_row_hash: hash,
        updated_at: new Date().toISOString(),
      };
    });

    // 4. Filtrar datos válidos
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

    // 5. UPSERT robusto (sin romper por duplicados)
    const { error } = await supabase
      .from("calls")
      .upsert(clean, {
        onConflict: "source_row_hash",
        ignoreDuplicates: true, // 🔥 clave para evitar error
      });

    if (error) {
      return NextResponse.json({
        ok: false,
        error: error.message,
      });
    }

    // 6. Log de sync
    await supabase.from("admin_notifications").insert({
      kind: "sync",
      title: "Sync completado",
      body: `Se procesaron ${clean.length} registros`,
    });

    // 7. Respuesta final
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
