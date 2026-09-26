import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { applyAccountingEffects, type AccountingBalanceEntry } from "@/lib/accountingMetrics";

const ACCESS_PASSWORD = "Nosotrostarot1.";
const movementTypes = new Set(["ingreso", "gasto", "traspaso"]);

function isAuthorized(request: NextRequest) {
  return request.headers.get("x-contabilidad-password") === ACCESS_PASSWORD;
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function dbReady() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function parseMonth(month: string | null) {
  const safeMonth = /^\d{4}-\d{2}$/.test(month || "") ? String(month) : new Date().toISOString().slice(0, 7);
  const start = `${safeMonth}-01`;
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  return { month: safeMonth, start, next };
}

function validOption(value: unknown, max = 80) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

type BalanceMap = Record<string, number>;
type PriorEntry = {
  movement_type: string;
  business: string;
  amount: number | string;
  origin_account: string | null;
  destination_account: string | null;
};

function calculateOpeningBalances(entries: PriorEntry[]) {
  const businesses = new Set(entries.map((entry) => entry.business));
  const mapped: AccountingBalanceEntry[] = entries.map((entry) => ({
    type: entry.movement_type.toLowerCase() === "traspaso" ? "traspaso" : entry.movement_type.toLowerCase() === "gasto" ? "gasto" : "ingreso",
    business: entry.business,
    amount: Number(entry.amount) || 0,
    originAccount: entry.origin_account || "Banco",
    destinationAccount: entry.destination_account || "Banco",
  }));
  const balances = applyAccountingEffects(mapped, businesses);
  return { business: balances.main as BalanceMap, cash: balances.cash as BalanceMap };
}

const selectFields = "id, movement_type, movement_date, business, channel, category, amount, note, origin_account, destination_account, created_at";

async function loadAccountingHistory(untilDate: string) {
  const pageSize = 1000;
  const rows: ApiHistoryEntry[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await supabaseAdmin.from("manual_accounting_movements").select(selectFields).lt("movement_date", untilDate).order("movement_date", { ascending: true }).order("created_at", { ascending: true }).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = (result.data || []) as ApiHistoryEntry[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

type ApiHistoryEntry = PriorEntry & { id: string; movement_date: string; channel: string; category: string; note: string | null; created_at: string };

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return jsonError("No autorizado", 401);
  if (!dbReady()) {
    return NextResponse.json({ entries: [], openingBalances: {}, openingCashBalances: {}, dbReady: false });
  }

  const { searchParams } = new URL(request.url);
  const { month, start, next } = parseMonth(searchParams.get("month"));

  let history: ApiHistoryEntry[];
  try { history = await loadAccountingHistory(next); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "No se pudo cargar el histórico contable", 500); }
  const prior = history.filter((entry) => entry.movement_date < start);
  const monthEntries = history.filter((entry) => entry.movement_date >= start).sort((a,b)=>`${b.movement_date}-${b.created_at}`.localeCompare(`${a.movement_date}-${a.created_at}`));
  const opening = calculateOpeningBalances(prior);
  return NextResponse.json({
    entries: monthEntries,
    analyticsEntries: history,
    month,
    openingBalances: opening.business,
    openingCashBalances: opening.cash,
    dbReady: true,
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return jsonError("No autorizado", 401);
  if (!dbReady()) return jsonError("Supabase no está configurado", 503);

  const body = await request.json();
  const type = String(body.type || "").trim().toLowerCase();
  const date = String(body.date || "");
  const business = String(body.business || "").trim();
  const originAccount = String(body.originAccount || body.origin_account || "Banco").trim();
  const destinationAccount = String(body.destinationAccount || body.destination_account || "Banco").trim();
  const channel = String(body.channel || "").trim();
  const category = String(body.category || "").trim();
  const amount = Number(String(body.amount ?? "").replace(",", "."));
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!movementTypes.has(type)) return jsonError("Tipo de movimiento no válido");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError("Fecha no válida");
  if (!validOption(business)) return jsonError("Negocio no válido");
  if (!validOption(originAccount)) return jsonError("Origen de dinero no válido");
  if (!validOption(destinationAccount)) return jsonError("Destino de dinero no válido");
  if (!validOption(channel)) return jsonError("Medio no válido");
  if (!validOption(category)) return jsonError("Tipo no válido");
  if (!Number.isFinite(amount) || amount <= 0) return jsonError("Importe no válido");
  if (note.length > 500) return jsonError("La observación es demasiado larga");
  if (type === "traspaso" && originAccount.localeCompare(destinationAccount, "es", { sensitivity: "base" }) === 0) {
    return jsonError("El origen y el destino del traspaso deben ser diferentes");
  }

  const { data, error } = await supabaseAdmin
    .from("manual_accounting_movements")
    .insert({
      movement_type: type,
      movement_date: date,
      business,
      origin_account: originAccount,
      destination_account: destinationAccount,
      channel,
      category,
      amount,
      note: note || null,
    })
    .select(selectFields)
    .single();

  if (error) {
    console.error("No se pudo guardar el movimiento contable", { code: error.code, message: error.message });
    if (error.code === "23514") return jsonError("La configuración contable de Supabase no admite este movimiento. Ejecuta el SQL incluido con esta actualización.", 409);
    return jsonError("No se pudo guardar el movimiento. Revisa los datos e inténtalo de nuevo.", 500);
  }
  return NextResponse.json({ entry: data });
}

export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) return jsonError("No autorizado", 401);
  if (!dbReady()) return jsonError("Supabase no está configurado", 503);

  let body;
  try { body = await request.json(); }
  catch { return jsonError("Datos no válidos"); }
  if (!body || typeof body !== "object") return jsonError("Datos no válidos");
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const parseAmount = (value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number") return NaN;
    const input = String(value).trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return NaN;
    const amount = Number(input);
    return amount > 0 && Number.isSafeInteger(Math.round(amount * 100)) ? amount : NaN;
  };
  const amount = parseAmount(body.amount);
  const previousAmount = parseAmount(body.previousAmount);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return jsonError("Identificador no válido");
  if (!Number.isFinite(amount) || !Number.isFinite(previousAmount)) return jsonError("El importe debe ser mayor que cero y tener como máximo dos decimales.");

  // Only replace the amount of this row. The existing UPDATE trigger keeps its old/new values.
  // Compare the original amount atomically to avoid overwriting another person's correction.
  const { data, error } = await supabaseAdmin.from("manual_accounting_movements")
    .update({ amount }).eq("id", id).eq("amount", previousAmount)
    .select(selectFields).maybeSingle();
  if (error) return jsonError("No se pudo actualizar el importe. No se ha confirmado ningún cambio.", 500);
  if (!data) return jsonError("El movimiento cambió o fue eliminado. Cierra esta ventana y actualiza los movimientos antes de editarlo.", 409);
  return NextResponse.json({ entry: data });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) return jsonError("No autorizado", 401);
  if (!dbReady()) return jsonError("Supabase no está configurado", 503);

  const id = String(new URL(request.url).searchParams.get("id") || "").trim();
  if (!id) return jsonError("Falta el identificador del movimiento");

  const { data, error } = await supabaseAdmin
    .from("manual_accounting_movements")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError("El movimiento no existe o ya fue eliminado", 404);
  return NextResponse.json({ deletedId: data.id });
}
