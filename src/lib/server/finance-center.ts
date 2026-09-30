import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidEconomicPayment } from "@/lib/server/economic-payments";
import { madridMidnightUtc } from "@/lib/server/madrid-reporting-period";

export type FinanceCurrencyTotals = Record<string, number>;

export type FinanceFilters = {
  from: string;
  to: string;
  business: string;
  category: string;
  method: string;
  status: string;
  currency: string;
};

export function roundFinanceMoney(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function cleanFinanceCurrency(value: unknown) {
  const currency = String(value || "EUR").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "EUR";
}

export function cleanFinanceDate(value: unknown, fallback: string) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
}

export function shiftDateKey(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_DATE");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function previousEquivalentPeriod(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return { from: shiftDateKey(from, -days), to: shiftDateKey(from, -1) };
}

export function periodIso(from: string, to: string) {
  return {
    start: madridMidnightUtc(from).toISOString(),
    endExclusive: madridMidnightUtc(shiftDateKey(to, 1)).toISOString(),
  };
}

export function businessFromOrigin(origin: unknown) {
  const raw = String(origin || "").trim();
  const value = raw.toLowerCase();
  if (value.includes("flowly")) return "Flowly";
  if (value.includes("leonaris")) return "Leonaris";
  if (value.includes("orion")) return "Orion";
  if (value.includes("celestial")) return "Celestial";
  return raw || "Celestial";
}

export function addCurrencyTotal(target: FinanceCurrencyTotals, currency: unknown, amount: unknown) {
  const key = cleanFinanceCurrency(currency);
  target[key] = roundFinanceMoney((target[key] || 0) + Number(amount || 0));
}

export function subtractCurrencyTotal(target: FinanceCurrencyTotals, currency: unknown, amount: unknown) {
  addCurrencyTotal(target, currency, -Number(amount || 0));
}

export async function loadFinanceOfficialPayments(admin: SupabaseClient, from: string, to: string) {
  const range = periodIso(from, to);
  const rows: any[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data, error } = await admin
      .from("crm_cliente_pagos")
      .select("id,cliente_id,importe,moneda,metodo,estado,created_at,referencia_externa,source_rendimiento_id")
      .gte("created_at", range.start)
      .lt("created_at", range.endExclusive)
      .order("created_at", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }

  const valid = rows.filter(isValidEconomicPayment).filter((row) => Number(row?.importe || 0) > 0);
  const clientIds = Array.from(new Set(valid.map((row) => String(row?.cliente_id || "")).filter(Boolean)));
  const clients: any[] = [];
  for (let index = 0; index < clientIds.length; index += 500) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id,nombre,apellido,telefono,email,origen")
      .in("id", clientIds.slice(index, index + 500));
    if (error) throw error;
    clients.push(...(data || []));
  }
  const clientMap = new Map(clients.map((client) => [String(client.id), client]));

  return valid.map((payment) => {
    const client = clientMap.get(String(payment.cliente_id || ""));
    return {
      id: `diario:${payment.id}`,
      source_id: String(payment.id),
      source_system: "diario" as const,
      entry_type: "income" as const,
      operation_date: String(payment.created_at || "").slice(0, 10),
      created_at: payment.created_at,
      concept: "Venta / consulta",
      description: [client?.nombre, client?.apellido].filter(Boolean).join(" ").trim() || "Cobro registrado en Diario",
      category: "Venta / consulta (Diario)",
      amount: roundFinanceMoney(payment.importe),
      gross_amount: roundFinanceMoney(payment.importe),
      fee_amount: 0,
      net_amount: roundFinanceMoney(payment.importe),
      currency: cleanFinanceCurrency(payment.moneda),
      business: businessFromOrigin(client?.origen),
      payment_method: String(payment.metodo || "Sin especificar"),
      provider: String(payment.metodo || "Sin especificar"),
      status: "confirmed",
      settled_amount: null,
      due_date: null,
      due_month: null,
      reference: payment.referencia_externa || null,
      note: null,
      origin: "Cliente",
      destination: String(payment.metodo || "Cobro"),
      document_path: null,
      read_only: true,
    };
  });
}

export function matchesFinanceFilters(row: any, filters: Omit<FinanceFilters, "from" | "to">) {
  const eq = (filter: string, value: unknown) => filter === "all" || String(value || "").toLowerCase() === filter.toLowerCase();
  if (!eq(filters.business, row.business)) return false;
  if (!eq(filters.category, row.category || row.concept)) return false;
  if (!eq(filters.method, row.payment_method || row.provider)) return false;
  if (!eq(filters.status, row.status)) return false;
  if (!eq(filters.currency, row.currency)) return false;
  return true;
}
