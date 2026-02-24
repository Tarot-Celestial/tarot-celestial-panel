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
  let s = String(v ?? "").trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  // normaliza invisibles típicos
  s = s.replace(/\u00A0/g, " "); // NBSP
  s = s.replace(/[\u200B\uFEFF]/g, ""); // zero-width + BOM
  return s.trim();
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
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "1" || s === "x" || s === "yes" || s === "si" || s === "sí") return true;
  if (s === "0" || s === "no") return false;
  if (s === "verdadero") return true;
  if (s === "falso") return false;
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

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
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

    if (ch === "\r") continue;

    cur += ch;
  }

  row.push(cur);
  if (row.length > 1 || cleanCell(row[0]) !== "") rows.push(row);
  return rows;
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "Use POST to sync." });
}

export async function POST() {
  try {
    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // mapa tarotista -> worker_id (para stats sólidas)
    const { data: ws, error: ew } = await admin
      .from("workers")
      .select("id, display_name, call_key, role")
      .eq("role", "tarotista");
    if (ew) throw ew;

    const map = new Map<string, string>();
    const key = (x: any) => cleanCell(x).toLowerCase().replace(/\s+/g, " ").trim();
    for (const w of ws || []) {
      const k1 = key(w.call_key || "");
      const k2 = key(w.display_name || "");
      if (k1) map.set(k1, w.id);
      if (k2) map.set(k2, w.id);
    }

    // descargar csv
    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
    const text = await res.text();

    const table = parseCSV(text);
    if (table.length < 2) return NextResponse.json({ ok: true, upserted: 0, rows: 0 });

    const headers = table[0].map(normHeader);

    const idxExact = (name: string) => headers.indexOf(name);
    const idxIncludes = (sub: string) => headers.findIndex((h) => h.includes(sub));

    const idxId =
      idxExact("id_unico") >= 0
        ? idxExact("id_unico")
        : idxIncludes("id_unico") >= 0
          ? idxIncludes("id_unico")
          : idxIncludes("id");

    const idxFecha = idxExact("fecha") >= 0 ? idxExact("fecha") : idxIncludes("fecha");
    const idxTelefonista = idxExact("telefonista") >= 0 ? idxExact("telefonista") : idxIncludes("telefon");
    const idxTarotista = idxExact("tarotista") >= 0 ? idxExact("tarotista") : idxIncludes("tarot");
    const idxTiempo = idxExact("tiempo") >= 0 ? idxExact("tiempo") : idxIncludes("tiemp");
    const idxCodigo = idxExact("codigo") >= 0 ? idxExact("codigo") : idxIncludes("cod");
    const idxImporte = idxExact("importe") >= 0 ? idxExact("importe") : idxIncludes("import");
    const idxCaptadas =
      idxExact("captadas") >= 0 ? idxExact("captadas") : idxExact("captada") >= 0 ? idxExact("captada") : idxIncludes("captad");

    if (idxId < 0) {
      return NextResponse.json(
        { ok: false, error: `No encuentro la columna ID_Unico. Headers: ${headers.join(" | ")}` },
        { status: 500 }
      );
    }
    if (idxFecha < 0 || idxTarotista < 0 || idxTiempo < 0 || idxCodigo < 0) {
      return NextResponse.json(
        { ok: false, error: `Faltan headers base. Headers: ${headers.join(" | ")}` },
        { status: 500 }
      );
    }

    const rows: any[] = [];
    for (let r = 1; r < table.length; r++) {
      const cols = table[r];

      const sheet_id = cleanCell(cols[idxId]);
      if (!sheet_id) continue;

      const dateISO = parseDateDDMMYYYY(cols[idxFecha]);
      if (!dateISO) continue;

      const tarotistaRaw = cleanCell(cols[idxTarotista] ?? "");
      const tarotistaKey = key(tarotistaRaw);
      if (tarotistaKey === "call11") continue;

      const worker_id = map.get(tarotistaKey) || null;

      const telefonista = idxTelefonista >= 0 ? cleanCell(cols[idxTelefonista] ?? "") : "";
      const minutos = Number(String(cleanCell(cols[idxTiempo] ?? "0")).replace(",", "."));
      const importe = idxImporte >= 0 ? Number(String(cleanCell(cols[idxImporte] ?? "0")).replace(",", ".")) : NaN;
      const codigo = normCode(cols[idxCodigo]);
      const captada = idxCaptadas >= 0 ? toBoolCaptada(cols[idxCaptadas]) : false;

      rows.push({
        sheet_id,
        call_date: dateISO,
        telefonista: telefonista || null,
        tarotista: tarotistaRaw || null,
        worker_id,
        minutos: isFinite(minutos) ? minutos : 0,
        codigo,
        importe: isFinite(importe) ? importe : null,
        captada: !!captada,
      });
    }

    if (!rows.length) return NextResponse.json({ ok: true, upserted: 0, rows: 0 });

    // dedupe por sheet_id (si viene repetido en el csv)
    const byId = new Map<string, any>();
    for (const rr of rows) byId.set(rr.sheet_id, rr);
    const uniqueRows = Array.from(byId.values());

    const { error } = await admin.from("calls").upsert(uniqueRows, {
      onConflict: "sheet_id",
      ignoreDuplicates: false,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, upserted: uniqueRows.length, rows: rows.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
