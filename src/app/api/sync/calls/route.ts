import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSLT1yIj5KRXABYpubiiM_9DQLqAT3zriTsW44S-SBvz_ZhjKJJu35pP9F4j-sT6Pt0hmRGsnqlulyM/pub?gid=1587355871&single=true&output=csv";

type CallRow = {
  call_date: string | null;
  telefonista: string;
  tarotista: string;
  minutos: number;
  codigo: string;
  importe: number;
  captada: boolean;
  source_row_hash: string;
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatDate(value: string | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parts = raw.split("/");
  if (parts.length === 3) {
    const [day, month, year] = parts.map((x) => x.trim());
    if (day && month && year) {
      return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }

  return null;
}

function parseNumber(value: string | undefined): number {
  const raw = (value || "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");

  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseBool(value: string | undefined): boolean {
  const raw = (value || "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "si" || raw === "sí" || raw === "yes";
}

function normalizeCodigo(value: string | undefined): string {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return "cliente";
  return raw;
}

function cleanText(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (["empty", "null", "undefined", "-"].includes(raw.toLowerCase())) return "";
  return raw;
}

function createHash(row: string): string {
  let hash = 0;
  for (let i = 0; i < row.length; i++) {
    hash = (hash << 5) - hash + row.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
}

function getValue(
  row: string[],
  headerIndex: Record<string, number>,
  candidates: string[]
): string {
  for (const key of candidates) {
    const idx = headerIndex[key];
    if (typeof idx === "number") {
      return row[idx] ?? "";
    }
  }
  return "";
}

export async function POST() {
  try {
    const response = await fetch(SHEET_URL, { cache: "no-store" });
    const csv = await response.text();

    const lines = csv
      .replace(/\r/g, "")
      .split("\n")
      .filter((line) => line.trim().length > 0);

    if (lines.length < 2) {
      return NextResponse.json(
        { ok: false, error: "El sheet está vacío o no tiene filas" },
        { status: 400 }
      );
    }

    const rawHeaders = parseCsvLine(lines[0]);
    const normalizedHeaders = rawHeaders.map(normalizeHeader);

    const headerIndex: Record<string, number> = {};
    normalizedHeaders.forEach((header, index) => {
      if (!(header in headerIndex)) {
        headerIndex[header] = index;
      }
    });

    const requiredGroups = {
      call_date: ["call_date", "fecha", "fecha_llamada"],
      telefonista: ["telefonista"],
      tarotista: ["tarotista"],
      minutos: ["minutos"],
      codigo: ["codigo"],
      importe: ["importe"],
      captada: ["captada"],
    };

    const missing = Object.entries(requiredGroups)
      .filter(([, candidates]) => !candidates.some((candidate) => candidate in headerIndex))
      .map(([name]) => name);

    if (missing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Faltan columnas en el sheet: ${missing.join(", ")}`,
          headers_detected: rawHeaders,
        },
        { status: 400 }
      );
    }

    const unique = new Map<string, CallRow>();

    for (const line of lines.slice(1)) {
      const cols = parseCsvLine(line);
      const source_row_hash = createHash(line);

      const row: CallRow = {
        call_date: formatDate(getValue(cols, headerIndex, requiredGroups.call_date)),
        telefonista: cleanText(getValue(cols, headerIndex, requiredGroups.telefonista)),
        tarotista: cleanText(getValue(cols, headerIndex, requiredGroups.tarotista)),
        minutos: parseNumber(getValue(cols, headerIndex, requiredGroups.minutos)),
        codigo: normalizeCodigo(getValue(cols, headerIndex, requiredGroups.codigo)),
        importe: parseNumber(getValue(cols, headerIndex, requiredGroups.importe)),
        captada: parseBool(getValue(cols, headerIndex, requiredGroups.captada)),
        source_row_hash,
      };

      if (!row.call_date) continue;

      unique.set(source_row_hash, row);
    }

    const payload = Array.from(unique.values());

    if (payload.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No hay filas válidas para importar" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("calls")
      .upsert(payload, {
        onConflict: "source_row_hash",
      });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    await supabase.from("admin_notifications").insert({
      kind: "sync",
      title: "Sync completado",
      body: `Se procesaron ${payload.length} registros`,
    });

    return NextResponse.json({
      ok: true,
      processed: payload.length,
      headers_detected: rawHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

