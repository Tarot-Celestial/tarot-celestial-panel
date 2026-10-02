import { buildClienteNameMap, roundMoney } from "@/lib/server/client-ranks";
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
  const result = new Map<string, {total:number;compras:number;pagos:number;llamadas:number}>();
  for (const part of chunks(clients)) {
    const { data, error } = await admin.rpc("tc_client_rank_states", { p_client_ids: part.map(c => c.id) });
    if (error) throw error;
    for (const row of data || []) result.set(String(row.cliente_id), { total:Number(row.total), compras:Number(row.compras), pagos:0, llamadas:0 });
  }
  return result;
}

export async function loadEffectiveRanksBatch(admin: any, clients: RankAdminClient[], totals: Map<string, any>) {
  const result = new Map<string, EffectiveClientRank>();
  for (const part of chunks(clients)) {
    const { data, error } = await admin.rpc("tc_client_rank_states", { p_client_ids: part.map(c => c.id) });
    if (error) throw error;
    for (const row of data || []) result.set(String(row.cliente_id), { automatic:row.automatic, effective:row.effective, override:row.override, config:row.config, next:row.next });
  }
  return result;
}
