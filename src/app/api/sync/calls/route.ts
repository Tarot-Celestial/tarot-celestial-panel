import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSLT1yIj5KRXABYpubiiM_9DQLqAT3zriTsW44S-SBvz_ZhjKJJu35pP9F4j-sT6Pt0hmRGsnqlulyM/pub?gid=1587355871&single=true&output=csv";

function normCode(raw: any) {
  const s = String(raw || "").trim().toLowerCase();
  if (s.includes("repite")) return "repite";
  if (s.includes("cliente")) return "cliente";
  if (s.includes("rueda")) return "rueda";
  return "free";
}

function toBoolCaptada(raw: any) {
  const s = String(raw ?? "").trim().toLowerCase();
  // según sheets: puede venir como TRUE / true / 1 / x / ✅
  return (
    s === "true" ||
    s === "1" ||
    s === "x" ||
    s === "yes" ||
    s === "si" ||
    s === "sí" ||
    s.includes("✅")
  );
}

function parseDateDDMMYYYY(raw: any): string | null {
  // raw ejemplo: 01/02/2026
  const s = String(raw || "").trim();
  if (!s) return null;
  const parts = s.split("/");
  if (parts.length !== 3) return null;
  const dd = Number(parts[0]);
  const mm = Number(parts[1]);
  const yy = Number(parts[2]);
  if (!dd || !mm || !yy) return null;
  // guardamos como YYYY-MM-DD
  const d = String(dd).padStart(2, "0");
  const m = String(mm).padStart(2, "0");
  return `${yy}-${m}-${d}`;
}

// hash simple para deduplicar (no cripto, solo estable)
function rowHash(o: any) {
  const base = [
    o.call_date,
    o.telefonista || "",
    o.tarotista || "",
    String(o.minutos ?? ""),
    o.codigo || "",
    String(o.importe ?? ""),
    o.captada ? "1" : "0",
  ].join("|");
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return String(h);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "Use POST to sync. (We keep GET to avoid accidental crawlers writing.)",
  });
}

export async function POST(req: Request) {
  try {
    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // 1) Descargar CSV
    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    const text = await res.text();

    // 2) Parse manual (simple) para no depender de libs
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return NextResponse.json({ ok: true, upserted: 0, dropped_duplicates: 0 });

    // headers
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

    function get(row: string[], name: string) {
      const idx = headers.indexOf(name);
      return idx >= 0 ? row[idx] : "";
    }

    // 3) Convertir filas
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];

      // split csv básico (si tu sheet tiene comas en campos con comillas, lo ajustamos luego)
      const cols = raw.split(",");

      const dateISO = parseDateDDMMYYYY(get(cols, "fecha"));
      if (!dateISO) continue;

      const tarotista = String(get(cols, "tarotista") || "").trim();
      const telefonista = String(get(cols, "telefonista") || "").trim();

      const minutos = Number(String(get(cols, "tiempo") || "0").replace(",", "."));
      const importe = Number(String(get(cols, "importe") || "0").replace(",", "."));
      const codigo = normCode(get(cols, "codigo"));
      const captada = toBoolCaptada(get(cols, "captadas"));

      // ignoramos call11
      if (tarotista.trim().toLowerCase() === "call11") continue;

      const obj = {
        call_date: dateISO, // date column
        telefonista: telefonista || null,
        tarotista: tarotista || null,
        minutos: isFinite(minutos) ? minutos : 0,
        codigo,
        importe: isFinite(importe) ? importe : null,
        captada: !!captada,
      };

      rows.push({ ...obj, source_row_hash: rowHash(obj) });
    }

    if (!rows.length) return NextResponse.json({ ok: true, upserted: 0, dropped_duplicates: 0 });

    // ✅ DEDUPE: evita duplicados dentro del mismo lote (mismo source_row_hash)
    const byHash = new Map<string, any>();
    for (const r of rows) {
      byHash.set(r.source_row_hash, r); // si viene repetida, nos quedamos con la última
    }
    const uniqueRows = Array.from(byHash.values());

    // 4) Upsert por hash (evita duplicar)
    // Necesita que calls.source_row_hash exista + índice unique
    const { error } = await admin.from("calls").upsert(uniqueRows, {
      onConflict: "source_row_hash",
      ignoreDuplicates: false,
    });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      upserted: uniqueRows.length,
      dropped_duplicates: rows.length - uniqueRows.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
