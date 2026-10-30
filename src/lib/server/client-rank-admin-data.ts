import { loadRolling30ClientTotals } from "@/lib/server/client-ranks";
import { calcClientRank } from "@/lib/server/client-ranks";
import { normalizeClientRank, type EffectiveClientRank } from "@/lib/server/client-rank-effective";

const CHUNK_SIZE = 400;

function chunks<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function isMissingRelation(error: any) {
  return error?.code === "42P01" || /does not exist/i.test(String(error?.message || ""));
}

async function safeActivityIds(query: any, field = "cliente_id") {
  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error)) return [] as string[];
    throw error;
  }
  return (data || []).map((row: any) => String(row?.[field] || "").trim()).filter(Boolean);
}

export type RankAdminClient = {
  id: string;
  nombre: string | null;
  apellido: string | null;
  telefono: string | null;
  email: string | null;
  origen?: string | null;
  negocio?: string | null;
  business?: string | null;
  created_at?: string | null;
};

/**
 * Returns only clients created or active during the requested window.
 * The restriction is centralized here so UI components never repeat it.
 */
export async function loadRecentRankClients(admin: any, sinceIso: string, nowIso: string): Promise<RankAdminClient[]> {
  const [createdRes, paymentIds, callDateIds, callCreatedIds, followUpCreatedIds, followUpUpdatedIds, interactionCreatedIds, interactionClosedIds, noteIds, overrideIds] = await Promise.all([
    admin
      .from("crm_clientes")
      .select("id,nombre,apellido,telefono,email,origen,created_at")
      .gte("created_at", sinceIso)
      .lte("created_at", nowIso),
    safeActivityIds(
      admin.from("crm_cliente_pagos").select("cliente_id").gte("created_at", sinceIso).lte("created_at", nowIso)
    ),
    safeActivityIds(
      admin.from("rendimiento_llamadas").select("cliente_id").gte("fecha_hora", sinceIso).lte("fecha_hora", nowIso)
    ),
    safeActivityIds(
      admin.from("rendimiento_llamadas").select("cliente_id").gte("created_at", sinceIso).lte("created_at", nowIso)
    ),
    safeActivityIds(
      admin.from("crm_client_followups").select("client_id").gte("created_at", sinceIso).lte("created_at", nowIso),
      "client_id"
    ),
    safeActivityIds(
      admin.from("crm_client_followups").select("client_id").gte("updated_at", sinceIso).lte("updated_at", nowIso),
      "client_id"
    ),
    safeActivityIds(
      admin.from("crm_interacciones").select("cliente_id").gte("created_at", sinceIso).lte("created_at", nowIso)
    ),
    safeActivityIds(
      admin.from("crm_interacciones").select("cliente_id").gte("cerrado_at", sinceIso).lte("cerrado_at", nowIso)
    ),
    safeActivityIds(
      admin.from("crm_client_notes").select("cliente_id").gte("created_at", sinceIso).lte("created_at", nowIso)
    ),
    safeActivityIds(
      admin.from("client_rank_overrides").select("client_id").gte("created_at", sinceIso).lte("created_at", nowIso),
      "client_id"
    ),
  ]);

  if (createdRes.error) throw createdRes.error;

  const byId = new Map<string, RankAdminClient>();
  for (const client of createdRes.data || []) byId.set(String(client.id), client as RankAdminClient);

  const candidateIds = new Set<string>([
    ...paymentIds,
    ...callDateIds,
    ...callCreatedIds,
    ...followUpCreatedIds,
    ...followUpUpdatedIds,
    ...interactionCreatedIds,
    ...interactionClosedIds,
    ...noteIds,
    ...overrideIds,
  ]);
  for (const id of byId.keys()) candidateIds.delete(id);

  for (const idChunk of chunks([...candidateIds])) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id,nombre,apellido,telefono,email,origen,created_at")
      .in("id", idChunk);
    if (error) throw error;
    for (const client of data || []) byId.set(String(client.id), client as RankAdminClient);
  }

  return [...byId.values()];
}

export async function loadRecentRankTotals(
  admin: any,
  clients: RankAdminClient[],
  sinceIso: string,
  nowIso: string
) {
  return loadRolling30ClientTotals(admin, clients, sinceIso, nowIso);
}

export async function loadEffectiveRanksBatch(admin: any, clients: RankAdminClient[], totals: Map<string, any>) {
  const ids = clients.map((client) => String(client.id)).filter(Boolean);
  const nowIso = new Date().toISOString();
  const latest = new Map<string, any>();

  for (const idChunk of chunks(ids)) {
    const { data, error } = await admin
      .from("client_rank_overrides")
      .select("id,client_id,assigned_rank,intervention_type,starts_at,ends_at,reason,notes,created_at")
      .in("client_id", idChunk)
      .eq("active", true)
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      if (isMissingRelation(error)) break;
      throw error;
    }
    for (const row of data || []) {
      const clientId = String(row.client_id || "");
      if (clientId && !latest.has(clientId)) latest.set(clientId, row);
    }
  }

  const result = new Map<string, EffectiveClientRank>();
  for (const client of clients) {
    const clientId = String(client.id);
    const automatic = normalizeClientRank(calcClientRank(Number(totals.get(clientId)?.total || 0)));
    const row = latest.get(clientId);
    const assigned = normalizeClientRank(row?.assigned_rank);
    result.set(clientId, row && assigned ? {
      automatic,
      effective: assigned,
      override: {
        id: String(row.id),
        rank: assigned,
        intervention_type: row.intervention_type,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        reason: row.reason,
        notes: row.notes || null,
      },
    } : { automatic, effective: automatic, override: null });
  }
  return result;
}
