import type { SupabaseClient } from "@supabase/supabase-js";
import { filterRowsByBrand, type BrandKey } from "@/lib/server/brand-filter";

export type EconomicPayment = {
  id: string;
  cliente_id: string | null;
  importe: number | string | null;
  estado: string | null;
  metodo?: string | null;
  created_at: string;
  source_rendimiento_id?: string | null;
};

const INVALID_STATES = new Set([
  "cancelled", "canceled", "cancelado", "cancelada", "anulado", "anulada",
  "failed", "fallido", "fallida", "error", "refunded", "reembolsado",
  "reembolsada", "pending", "pendiente", "rejected", "rechazado", "rechazada",
]);

export function isValidEconomicPayment(row: Pick<EconomicPayment, "estado">) {
  const state = String(row?.estado || "completed").trim().toLowerCase();
  return !INVALID_STATES.has(state);
}

export async function loadOfficialPayments(
  admin: SupabaseClient,
  startIso: string,
  endIso: string,
  brand: BrandKey,
) {
  const pageSize = 1000;
  const rows: EconomicPayment[] = [];

  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await admin
      .from("crm_cliente_pagos")
      .select("id,cliente_id,importe,estado,metodo,created_at,source_rendimiento_id")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data || []) as EconomicPayment[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  const filtered = await filterRowsByBrand(admin, rows, brand);
  return filtered.filter(isValidEconomicPayment);
}

export function totalOfficialRevenue(rows: EconomicPayment[]) {
  return Math.round(rows.reduce((sum, row) => sum + (Number(row.importe) || 0), 0) * 100) / 100;
}
