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

function cleanCell(v: any) {
  const s = String(v ?? "").trim();
  // quita comillas si viene "TRUE"
  return s.replace(/^"(.*)"$/s, "$1").trim();
}

function normHeader(h: string) {
  return cleanCell(h).toLowerCase();
}

function normCode(raw: any) {
  const s = cleanCell(raw).toLowerCase();
  if (s.includes("repite")) return "repite";
  if (s.includes("cliente")) return "cliente";
  if (s.includes("rueda")) return "rueda";
  return "free";
}

function toBoolCaptada(raw: any) {
  const s = cleanCell(raw).toLowerCase();
  // Google Sheets checkbox: TRUE/FALSE
  if (s === "true") return true;
  if (s === "false") return false;

  // variantes
  if (s === "1" || s === "x" || s === "yes" || s === "si" || s === "sí") return true;
  if (s === "0" || s === "no") return false;

  // español
  if (s === "verdadero") return true;
  if (s === "falso") return false;

  // emoji / check
  if (s.includes("✅") || s.includes("✔")) return true;

  return false;
}

function parseDateDDMMYYYY(raw: any): string | null {
  const s = cleanCell(raw);
  if (!s) return null;
  const parts = s.split("/");
  if (parts.length !== 3) return null;
  const dd = Number(parts[0]);
  const mm = Number(parts[1]);
  const yy = Number(parts[2]);
  if (!dd || !mm || !yy) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/**
 * CSV parser básico pero correcto para comillas.
 * Devuelve array de filas (cada fila array de celdas).
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // "" -> comilla escapada
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    cur += ch;
  }

  // última celda/fila
  row.push(cur);
  // evita fila final vacía
  if (row.length > 1 || cleanCell(row[0]) !== "") rows.push(row);

  return rows;
}

// hash simple para deduplicar (estable)
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
    hint: "Use POST to sync.",
  });
}

export async function POST() {
  try {
    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // 1) Descargar CSV
    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    const text = await res.text();

    // 2) Parse CSV real (con comillas)
    const table = parseCSV(text);
    if (table.length < 2) return NextResponse.json({ ok: true, upserted: 0, dropped_duplicates: 0 });

    const headers = table[0].map(normHeader);

    // 3) índices por nombre (flexibles)
    function idxExact(name: string) {
      const i = headers.indexOf(name);
      return i >= 0 ? i : -1;
    }
    function idxIncludes(substr: string) {
      const s = substr.toLowerCase();
      const i = headers.findIndex((h) => h.includes(s));
      return i >= 0 ? i : -1;
    }

    const idxFecha = idxExact("fecha") >= 0 ? idxExact("fecha") : idxIncludes("fecha");
    const idxTelefonista = idxExact("telefonista") >= 0 ? idxExact("telefonista") : idxIncludes("telefon");
    const idxTarotista = idxExact("tarotista") >= 0 ? idxExact("tarotista") : idxIncludes("tarot");
    const idxTiempo = idxExact("tiempo") >= 0 ? idxExact("tiempo") : idxIncludes("tiemp");
    const idxCodigo = idxExact("codigo") >= 0 ? idxExact("codigo") : idxIncludes("cod");
    const idxImporte = idxExact("importe") >= 0 ? idxExact("importe") : idxIncludes("import");
    // ✅ captadas: buscamos exacto y si no, cualquier header que contenga "captad"
    const idxCaptadas =
      idxExact("captadas") >= 0
        ? idxExact("captadas")
        : idxExact("captada") >= 0
          ? idxExact("captada")
          : idxIncludes("captad");

    if (idxFecha < 0 || idxTarotista < 0 || idxTiempo < 0 || idxCodigo < 0) {
      return NextResponse.json({
        ok: false,
        error: `CSV headers missing. Found headers: ${headers.join(" | ")}`,
      }, { status: 500 });
    }

    // 4) Convertir filas
    const rows: any[] = [];
    let captadasTrueSeen = 0;

    for (let r = 1; r < table.length; r++) {
      const cols = table[r];

      const dateISO = parseDateDDMMYYYY(cols[idxFecha]);
      if (!dateISO) continue;

      const tarotista = cleanCell(cols[idxTarotista] ?? "");
      const telefonista = idxTelefonista >= 0 ? cleanCell(cols[idxTelefonista] ?? "") : "";

      const minutos = Number(String(cleanCell(cols[idxTiempo] ?? "0")).replace(",", "."));
      const importe = idxImporte >= 0 ? Number(String(cleanCell(cols[idxImporte] ?? "0")).replace(",", ".")) : NaN;
      const codigo = normCode(cols[idxCodigo]);

      const captadaRaw = idxCaptadas >= 0 ? cols[idxCaptadas] : "";
      const captada = toBoolCaptada(captadaRaw);

      if (captada) captadasTrueSeen++;

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

    if (!rows.length) {
      return NextResponse.json({
        ok: true,
        upserted: 0,
        dropped_duplicates: 0,
        captadas_true_seen: captadasTrueSeen,
      });
    }

    // ✅ DEDUPE dentro del lote
    const byHash = new Map<string, any>();
    for (const rr of rows) byHash.set(rr.source_row_hash, rr);
    const uniqueRows = Array.from(byHash.values());

    // 5) Upsert
    const { error } = await admin.from("calls").upsert(uniqueRows, {
      onConflict: "source_row_hash",
      ignoreDuplicates: false,
    });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      upserted: uniqueRows.length,
      dropped_duplicates: rows.length - uniqueRows.length,
      captadas_true_seen: captadasTrueSeen,
      captadas_col_found: idxCaptadas >= 0,
      captadas_col_name: idxCaptadas >= 0 ? headers[idxCaptadas] : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
