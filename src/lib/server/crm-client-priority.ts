import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CRM_LIST_FIELDS = "id, nombre, apellido, telefono, telefono_normalizado, email, pais, notas, origen, updated_at, created_at, onboarding_completado, total_accesos, ultimo_acceso_at, ultima_actividad_at, minutos_free_pendientes, minutos_normales_pendientes, deuda_pendiente";

type PriorityFilters = {
  tagIds: string[];
  search: string;
  phoneCandidates: string[];
  country: string;
  webFilter: string;
  rank: string;
};
type PriorityPosition = {
  cliente_id: string;
  gasto_total: number;
  compras: number;
  ultima_actividad_at: string | null;
};
type PriorityRow = PriorityPosition & { gasto_por_moneda: Record<string, number> };

export class CrmPriorityError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validPosition(value: any): value is PriorityPosition {
  return value && UUID.test(String(value.cliente_id || ""))
    && typeof value.gasto_total === "number" && Number.isFinite(value.gasto_total) && value.gasto_total >= 0
    && Number.isSafeInteger(value.compras) && value.compras >= 0
    && (value.ultima_actividad_at === null || validTime(value.ultima_actividad_at));
}

function contextFor(filters: PriorityFilters) {
  return createHash("sha256").update(JSON.stringify({
    ...filters, tagIds: [...filters.tagIds].sort(), phoneCandidates: [...filters.phoneCandidates].sort(),
  })).digest("hex");
}

function readCursor(cursor: string, context: string) {
  try {
    if (cursor.length > 2000 || !/^cp1\.[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor.slice(4), "base64url").toString("utf8"));
    if (value.v !== 1 || value.context !== context || !validTime(value.asOf)
      || Date.parse(value.asOf) > Date.now() + 30_000 || !validPosition(value.after)
      || (value.after.ultima_actividad_at !== null && Date.parse(value.after.ultima_actividad_at) > Date.parse(value.asOf))) throw new Error();
    return { asOf: value.asOf, after: value.after as PriorityPosition };
  } catch {
    throw new CrmPriorityError("PAGINA_INVALIDA", 400);
  }
}

/** Global ordering lives in Postgres; the page boundary is never a locally sorted UUID page. */
export async function loadPriorityClientPage(db: any, filters: PriorityFilters, cursor: string, pageSize = 120) {
  const context = contextFor(filters);
  const { asOf, after } = cursor ? readCursor(cursor, context) : { asOf: new Date().toISOString(), after: null };
  const { data, error } = await db.rpc("tc_crm_client_priority_page", {
    p_tag_ids: filters.tagIds,
    p_search: filters.search,
    p_phone_candidates: filters.phoneCandidates,
    p_country: filters.country,
    p_web_filter: filters.webFilter,
    p_after: after,
    p_as_of: asOf,
    p_limit: pageSize + 1,
  });
  if (error) throw new CrmPriorityError("No se pudo ordenar el historial de compras. Vuelve a cargar el CRM.", 500);
  const ranked: PriorityRow[] = (data || []).map((row: any) => ({
    ...row, gasto_total: Number(row.gasto_total), compras: Number(row.compras),
  }));
  if (ranked.some(row => !validPosition(row))) throw new CrmPriorityError("No se pudo comprobar el orden del CRM. Vuelve a cargarlo.", 500);
  const page = ranked.slice(0, pageSize);
  const hasMore = ranked.length > pageSize;
  let clientes: any[] = [];
  if (page.length) {
    const result = await db.from("crm_clientes").select(CRM_LIST_FIELDS).in("id", page.map(row => row.cliente_id));
    if (result.error) throw new CrmPriorityError("No se pudieron cargar los clientes. Vuelve a cargar el CRM.", 500);
    const byId = new Map<string, any>((result.data || []).map((row: any) => [String(row.id), row]));
    // IN does not promise an order. Restore the server's financial/activity order explicitly.
    clientes = page.filter(row => byId.has(row.cliente_id)).map(row => ({
      ...byId.get(row.cliente_id),
      prioridad_gasto_total: row.gasto_total,
      prioridad_compras: row.compras,
      prioridad_ultima_actividad_at: row.ultima_actividad_at,
      prioridad_gasto_por_moneda: row.gasto_por_moneda,
    }));
  }
  const last = page[page.length - 1];
  const nextPosition = last ? {
    cliente_id: last.cliente_id, gasto_total: last.gasto_total,
    compras: last.compras, ultima_actividad_at: last.ultima_actividad_at,
  } : null;
  return {
    clientes,
    has_more: hasMore,
    next_cursor: hasMore ? "cp1." + Buffer.from(JSON.stringify({ v: 1, context, asOf, after: nextPosition })).toString("base64url") : null,
    scanned_count: page.length,
    sort_order: "purchase_priority",
    sort_as_of: asOf,
  };
}
