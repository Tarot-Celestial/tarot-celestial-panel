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
  // Google Sheets checkbox suele exportar TRUE/FALSE
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
  const d = String(dd).padStart(2, "0");
  const m = String(mm).padStart(2, "0");
  return `${yy}-${m}-${d}`; // YYYY-MM-DD
}

// hash simple (estable) -> OJO: incluye captada (lo mantenemos para no romper lo ya importado)
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
    hint: "Use POST to sync. (GET is only informational.)",
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

    // 2) Parse manual (simple)
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return NextResponse.json({ ok: true, upserted: 0, dropped_duplicates: 0, captadas_fixed: 0 });

    // headers
    const headers = lines[0]
      .split(",")
      .map((h) => String(h || "").trim().toLowerCase().replace(/^"|"$/g, ""));

    function get1(row: string[], name: string) {
      const idx = headers.indexOf(name);
      return idx >= 0 ? row[idx] : "";
    }

    function getAny(row: string[], names: string[]) {
      for (const n of names) {
        const v = get1(row, n);
        if (String(v ?? "").trim() !== "") return v;
      }
      // aunque esté vacío, devolvemos el primero (por si el checkbox es vacío)
      return get1(row, names[0] || "");
    }

    // 3) Convertir filas
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];
      const cols = raw.split(",");

      const dateISO = parseDateDDMMYYYY(getAny(cols, ["fecha", "date"]));
      if (!dateISO) continue;

      const tarotista = String(getAny(cols, ["tarotista", "tarotist"]) || "").trim();
      const telefonista = String(getAny(cols, ["telefonista", "central", "operador"]) || "").trim();

      const minutos = Number(String(getAny(cols, ["tiempo", "minutos", "minutes"]) || "0").replace(",", "."));
      const importe = Number(String(getAny(cols, ["importe", "amount"]) || "0").replace(",", "."));
      const codigo = normCode(getAny(cols, ["codigo", "code"]));

      // ✅ captadas: soporta "captadas" y "captada"
      const captadaRaw = getAny(cols, ["captadas", "captada"]);
      const captada = toBoolCaptada(captadaRaw);

      // ignoramos call11
      if (tarotista.trim().toLowerCase() === "call11") continue;

      const obj = {
        call_date: dateISO,
        telefonista: telefonista || null,
        tarotista: tarotista || null,
        minutos: isFinite(minutos) ? minutos : 0,
        codigo,
        importe: isFinite(importe) ? importe : null,
        captada: !!captada,
      };

      rows.push({ ...obj, source_row_hash: rowHash(obj) });
    }

    if (!rows.length) return NextResponse.json({ ok: true, upserted: 0, dropped_duplicates: 0, captadas_fixed: 0 });

    // ✅ DEDUPE dentro del mismo lote
    const byHash = new Map<string, any>();
    for (const r of rows) byHash.set(r.source_row_hash, r);
    const uniqueRows = Array.from(byHash.values());

    // ✅ Paso extra: arreglar captadas ya existentes SIN duplicar filas
    // Si antes se importaron como captada=false, ahora (si es true) hacemos UPDATE por campos “naturales”
    let captadas_fixed = 0;

    const finalRows: any[] = [];
    for (const r of uniqueRows) {
      if (r.captada === true) {
        const { data: updated, error: eu } = await admin
          .from("calls")
          .update({ captada: true })
          .eq("call_date", r.call_date)
          .eq("codigo", r.codigo)
          .eq("tarotista", r.tarotista)
          .eq("telefonista", r.telefonista)
          .eq("minutos", r.minutos)
          .select("source_row_hash")
          .limit(1);

        if (eu) throw eu;

        if (updated && updated.length > 0) {
          captadas_fixed += 1;
          // ya existía esa fila; NO la metemos al upsert para no duplicar
          continue;
        }
      }
      finalRows.push(r);
    }

    // 4) Upsert por hash (evita duplicar)
    const { error } = await admin.from("calls").upsert(finalRows, {
      onConflict: "source_row_hash",
      ignoreDuplicates: false,
    });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      upserted: finalRows.length,
      dropped_duplicates: rows.length - uniqueRows.length,
      captadas_fixed,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
