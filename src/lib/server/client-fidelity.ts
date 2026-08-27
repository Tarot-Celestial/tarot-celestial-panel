import { loadEffectiveRanksBatch, loadRecentRankTotals, type RankAdminClient } from "@/lib/server/client-rank-admin-data";

export type FidelityPurchase = { id?: string | null; created_at?: string | null; importe?: number | string | null };
export type FidelityActivity = { created_at?: string | null; closed_at?: string | null; estado?: string | null };
export type FidelityFollowUp = FidelityActivity & { completed_at?: string | null; result?: string | null };
export type FidelityRank = "bronce" | "plata" | "oro" | null;

export type ClientFidelityInput = {
  capturedAt?: string | null;
  purchases: FidelityPurchase[];
  calls: FidelityActivity[];
  interactions: FidelityActivity[];
  followUps: FidelityFollowUp[];
  rank?: FidelityRank;
  now?: Date;
};

export type ClientFidelityResult = {
  score: number;
  level: "very_high" | "high" | "medium" | "low" | "very_low";
  label: string;
  description: string;
  stars: number;
  maturity: "insufficient" | "initial" | "established";
  maturityLabel: string;
  needsAttention: boolean;
  reasons: string[];
  lastPurchaseAt: string | null;
  lastActivityAt: string | null;
  lastFollowUpAt: string | null;
  purchaseCount: number;
  repurchaseCount: number;
  rank: FidelityRank;
  breakdown: { recurrence: number; recency: number; activity: number; followUp: number; continuity: number };
  maximums: { recurrence: 35; recency: 25; activity: 20; followUp: 10; continuity: 10 };
};

type FidelityClient = RankAdminClient & { captured_at?: string | null; rango_actual?: string | null };
type LoadClientFidelityOptions = { capturedAtByClient?: Map<string, string | null | undefined>; now?: Date };

const DAY = 86_400_000;
const MAXIMUMS = { recurrence: 35, recency: 25, activity: 20, followUp: 10, continuity: 10 } as const;
const COMPLETED = new Set(["completed", "complete", "completado", "cerrado", "closed", "done", "atendido", "finalizado"]);

function validDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateIso(value?: string | null) { return validDate(value)?.toISOString() || null; }
function activityDate(row: FidelityActivity) { return row.closed_at || row.created_at || null; }
function daysSince(value: string | null | undefined, now: Date) {
  const date = validDate(value);
  return date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY)) : null;
}
function normalizeRank(value: unknown): FidelityRank {
  const rank = String(value || "").trim().toLowerCase();
  return rank === "bronce" || rank === "plata" || rank === "oro" ? rank : null;
}
function classify(score: number) {
  if (score >= 85) return { level: "very_high" as const, label: "Muy alta", description: "Clienta muy fidelizada" };
  if (score >= 70) return { level: "high" as const, label: "Alta", description: "Relación estable y activa" };
  if (score >= 50) return { level: "medium" as const, label: "Media", description: "Conviene mantener el seguimiento" };
  if (score >= 25) return { level: "low" as const, label: "Baja", description: "La relación necesita atención" };
  return { level: "very_low" as const, label: "Muy baja", description: "Datos escasos o relación inactiva" };
}
function scoreRecurrence(count: number) {
  if (count >= 5) return 35;
  if (count === 4) return 31;
  if (count === 3) return 26;
  if (count === 2) return 18;
  if (count === 1) return 5;
  return 0;
}
function scoreRecency(days: number | null) {
  if (days == null) return 0;
  if (days <= 7) return 25;
  if (days <= 14) return 22;
  if (days <= 30) return 18;
  if (days <= 45) return 12;
  if (days <= 60) return 7;
  if (days <= 90) return 3;
  return 0;
}
function scoreActivity(purchases: FidelityPurchase[], calls: FidelityActivity[], interactions: FidelityActivity[], now: Date) {
  const purchaseDates = purchases.map((row) => validDate(row.created_at)).filter((date): date is Date => Boolean(date));
  const callDates = calls.map((row) => validDate(activityDate(row))).filter((date): date is Date => Boolean(date));
  const interactionDates = interactions
    .filter((row) => COMPLETED.has(String(row.estado || "").toLowerCase()) || Boolean(row.closed_at))
    .map((row) => validDate(activityDate(row))).filter((date): date is Date => Boolean(date));
  const recent = [...purchaseDates, ...callDates, ...interactionDates].filter((date) => now.getTime() - date.getTime() <= 90 * DAY);
  const activeMonths = new Set(recent.map((date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}`)).size;
  const recentPurchases = purchaseDates.filter((date) => now.getTime() - date.getTime() <= 90 * DAY).length;
  const recentOperational = [...callDates, ...interactionDates].filter((date) => now.getTime() - date.getTime() <= 30 * DAY).length;
  return Math.min(20, Math.min(12, recentPurchases * 4) + Math.min(5, recentOperational) + Math.min(3, activeMonths));
}
function scoreFollowUp(followUps: FidelityFollowUp[], commercialActivity: Date[], now: Date) {
  let points = 0;
  for (const row of followUps) {
    const completedAt = validDate(row.completed_at || row.closed_at);
    if (!completedAt || now.getTime() - completedAt.getTime() > 90 * DAY) continue;
    const status = String(row.estado || "").toLowerCase();
    if (status && !COMPLETED.has(status)) continue;
    const hasResult = Boolean(String(row.result || "").trim());
    const ledToActivity = commercialActivity.some((date) => date >= completedAt && date.getTime() - completedAt.getTime() <= 14 * DAY);
    points += 2 + (hasResult ? 1 : 0) + (ledToActivity ? 2 : 0);
  }
  return Math.min(10, points);
}
function scoreContinuity(rank: FidelityRank, capturedAt: string | null | undefined, purchases: FidelityPurchase[], now: Date) {
  const rankPoints = rank === "oro" ? 6 : rank === "plata" ? 4 : rank === "bronce" ? 2 : 0;
  const relationshipDays = daysSince(capturedAt, now) || 0;
  const purchaseDates = purchases.map((row) => validDate(row.created_at)).filter((date): date is Date => Boolean(date));
  if (!purchaseDates.length) return rankPoints;
  const distinctMonths = new Set(purchaseDates.map((date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}`)).size;
  const continuity = relationshipDays >= 180 && distinctMonths >= 3 ? 4 : relationshipDays >= 90 && distinctMonths >= 2 ? 3 : relationshipDays >= 30 ? 1 : 0;
  return Math.min(10, rankPoints + continuity);
}
function buildReasons(data: { purchaseCount: number; lastPurchaseDays: number | null; activity: number; followUp: number; rank: FidelityRank }) {
  const reasons: string[] = [];
  if (data.purchaseCount >= 3) reasons.push(`+ ${data.purchaseCount - 1} recompras registradas`);
  else if (data.purchaseCount === 2) reasons.push("+ Primera recompra registrada");
  else if (data.purchaseCount === 1) reasons.push("• Solo existe una compra inicial");
  else reasons.push("• Todavía no hay compras completadas");
  if (data.lastPurchaseDays != null && data.lastPurchaseDays <= 14) reasons.push("+ Compra muy reciente");
  else if (data.lastPurchaseDays != null && data.lastPurchaseDays <= 30) reasons.push("+ Compra dentro de los últimos 30 días");
  else if (data.lastPurchaseDays != null && data.lastPurchaseDays > 60) reasons.push(`− ${data.lastPurchaseDays} días desde la última compra`);
  if (data.activity >= 12) reasons.push("+ Actividad frecuente durante los últimos 90 días");
  else if (data.activity === 0) reasons.push("− Sin actividad comercial reciente");
  if (data.followUp >= 5) reasons.push("+ Seguimiento válido con continuidad posterior");
  if (data.rank) reasons.push(`+ Rango actual ${data.rank.charAt(0).toUpperCase()}${data.rank.slice(1)}`);
  return reasons.slice(0, 5);
}

export function calculateClientFidelity(input: ClientFidelityInput): ClientFidelityResult {
  const now = input.now || new Date();
  const purchases = input.purchases.filter((row) => Boolean(validDate(row.created_at)))
    .sort((left, right) => (validDate(right.created_at)?.getTime() || 0) - (validDate(left.created_at)?.getTime() || 0));
  const purchaseCount = purchases.length;
  const lastPurchaseAt = dateIso(purchases[0]?.created_at);
  const lastPurchaseDays = daysSince(lastPurchaseAt, now);
  const commercialActivity = [
    ...purchases.map((row) => validDate(row.created_at)),
    ...input.calls.map((row) => validDate(activityDate(row))),
    ...input.interactions.map((row) => validDate(activityDate(row))),
  ].filter((date): date is Date => Boolean(date));
  const lastActivityAt = [...commercialActivity].sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() || null;
  const completedFollowUps = input.followUps.map((row) => validDate(row.completed_at || row.closed_at || row.created_at))
    .filter((date): date is Date => Boolean(date)).sort((left, right) => right.getTime() - left.getTime());
  const rank = normalizeRank(input.rank);
  const breakdown = {
    recurrence: scoreRecurrence(purchaseCount),
    recency: scoreRecency(lastPurchaseDays),
    activity: scoreActivity(purchases, input.calls, input.interactions, now),
    followUp: scoreFollowUp(input.followUps, commercialActivity, now),
    continuity: scoreContinuity(rank, input.capturedAt, purchases, now),
  };
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0)));
  const maturity = purchaseCount === 0 ? "insufficient" : purchaseCount === 1 ? "initial" : "established";
  const maturityLabel = maturity === "insufficient" ? "Datos insuficientes" : maturity === "initial" ? "Índice inicial" : "Índice consolidado";
  const classified = classify(score);
  const reasons = buildReasons({ purchaseCount, lastPurchaseDays, activity: breakdown.activity, followUp: breakdown.followUp, rank });
  const inactivityDays = daysSince(lastActivityAt, now);
  return {
    score, ...classified, stars: score >= 85 ? 5 : score >= 70 ? 4 : score >= 50 ? 3 : score >= 25 ? 2 : 0, maturity, maturityLabel,
    needsAttention: score < 50 && (inactivityDays == null || inactivityDays > 30),
    reasons, lastPurchaseAt, lastActivityAt,
    lastFollowUpAt: completedFollowUps[0]?.toISOString() || null,
    purchaseCount, repurchaseCount: Math.max(0, purchaseCount - 1), rank, breakdown, maximums: MAXIMUMS,
  };
}

function chunks<T>(items: T[], size = 200) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}
async function loadRowsByClientIds(admin: any, table: string, columns: string, clientColumn: string, clientIds: string[], configure?: (query: any) => any) {
  const rows: any[] = [];
  for (const clientChunk of chunks(Array.from(new Set(clientIds.filter(Boolean))))) {
    for (let from = 0; ; from += 1000) {
      let query = admin.from(table).select(columns).in(clientColumn, clientChunk);
      if (configure) query = configure(query);
      const { data, error } = await query.range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
  }
  return rows;
}
function groupByClient(rows: any[], column: string) {
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const clientId = String(row?.[column] || "").trim();
    if (!clientId) continue;
    const current = grouped.get(clientId) || [];
    current.push(row); grouped.set(clientId, current);
  }
  return grouped;
}

/** Single source of truth for Admin and Central. Queries are batched, never issued per client. */
export async function loadClientFidelityBatch(admin: any, clients: FidelityClient[], options: LoadClientFidelityOptions = {}) {
  const uniqueClients = Array.from(new Map(clients.map((client) => [String(client.id), client])).values());
  const clientIds = uniqueClients.map((client) => String(client.id)).filter(Boolean);
  const output = new Map<string, ClientFidelityResult>();
  if (!clientIds.length) return output;
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const since30Iso = new Date(now.getTime() - 30 * DAY).toISOString();
  const [payments, calls, interactions, followUps, rankTotals] = await Promise.all([
    loadRowsByClientIds(admin, "crm_cliente_pagos", "id,cliente_id,importe,created_at,estado,source_rendimiento_id", "cliente_id", clientIds, (query) => query.eq("estado", "completed")),
    loadRowsByClientIds(admin, "rendimiento_llamadas", "id,cliente_id,importe,fecha_hora,created_at,cliente_compra_minutos,tiempo", "cliente_id", clientIds),
    loadRowsByClientIds(admin, "crm_interacciones", "id,cliente_id,estado,created_at,cerrado_at", "cliente_id", clientIds),
    loadRowsByClientIds(admin, "crm_client_followups", "id,client_id,status,result,completed_at,created_at,updated_at", "client_id", clientIds),
    loadRecentRankTotals(admin, uniqueClients, since30Iso, nowIso),
  ]);
  const effectiveRanks = await loadEffectiveRanksBatch(admin, uniqueClients, rankTotals);
  const paymentsByClient = groupByClient(payments, "cliente_id");
  const callsByClient = groupByClient(calls, "cliente_id");
  const interactionsByClient = groupByClient(interactions, "cliente_id");
  const followUpsByClient = groupByClient(followUps, "client_id");
  for (const client of uniqueClients) {
    const clientId = String(client.id);
    const clientPayments = paymentsByClient.get(clientId) || [];
    const linkedCallIds = new Set(clientPayments.map((row: any) => String(row.source_rendimiento_id || "")).filter(Boolean));
    const clientCalls = callsByClient.get(clientId) || [];
    const callPurchases = clientCalls.filter((row: any) => Boolean(row.cliente_compra_minutos) && Number(row.importe || 0) > 0 && !linkedCallIds.has(String(row.id)))
      .map((row: any) => ({ id: row.id, created_at: row.fecha_hora || row.created_at || null, importe: row.importe }));
    const rank = effectiveRanks.get(clientId)?.effective || normalizeRank(client.rango_actual);
    output.set(clientId, calculateClientFidelity({
      capturedAt: options.capturedAtByClient?.get(clientId) || client.captured_at || client.created_at || null,
      purchases: [...clientPayments, ...callPurchases],
      calls: clientCalls.map((row: any) => ({ created_at: row.fecha_hora || row.created_at || null })),
      interactions: (interactionsByClient.get(clientId) || []).map((row: any) => ({ created_at: row.created_at || null, closed_at: row.cerrado_at || null, estado: row.estado || null })),
      followUps: (followUpsByClient.get(clientId) || []).map((row: any) => ({ created_at: row.created_at || null, completed_at: row.completed_at || null, estado: row.status || null, result: row.result || null })),
      rank, now,
    }));
  }
  return output;
}

export function averageClientFidelity(results: Iterable<ClientFidelityResult>) {
  const values = Array.from(results);
  return values.length ? Math.round(values.reduce((sum, result) => sum + result.score, 0) / values.length) : null;
}
