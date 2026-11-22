export type ClientCaptureStage = "captured" | "pending" | "untouched";

export type ClientCaptureStatus = {
  stage: ClientCaptureStage;
  first_purchase_at: string | null;
  last_interaction_at: string | null;
  free_minutes_used: number;
};

type CaptureClient = { id: string };

const COMPLETED_INTERACTION_STATES = new Set([
  "completed",
  "complete",
  "completado",
  "cerrado",
  "closed",
  "done",
  "atendido",
  "finalizado",
]);

function chunks<T>(items: T[], size = 200) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function loadRows(admin: any, table: string, columns: string, clientColumn: string, clientIds: string[]) {
  const rows: any[] = [];
  for (const clientChunk of chunks(Array.from(new Set(clientIds.filter(Boolean))))) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from(table)
        .select(columns)
        .in(clientColumn, clientChunk)
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
  }
  return rows;
}

function validIso(value: unknown) {
  const date = value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function firstPurchaseDates(admin: any, clientIds: string[]) {
  const dates = new Map<string, string>();
  for (const ids of chunks(clientIds)) {
    const { data, error } = await admin.rpc("tc_crm_first_purchases_batch", { p_client_ids: ids });
    if (error) throw error;
    for (const row of data || []) {
      const at = validIso(row.first_purchase_at);
      if (at) dates.set(row.client_id, at);
    }
  }
  return dates;
}

function latest(values: Array<string | null>) {
  const sorted = values.filter((value): value is string => Boolean(value)).sort();
  return sorted[sorted.length - 1] || null;
}

function freeMinutesInCall(row: any) {
  const explicit = (String(row?.codigo_1 || "").toUpperCase() === "FREE" ? Number(row?.minutos_1 || 0) : 0)
    + (String(row?.codigo_2 || "").toUpperCase() === "FREE" ? Number(row?.minutos_2 || 0) : 0);
  return Math.max(explicit, row?.usa_7_free ? 7 : 0, 0);
}

/**
 * Derives the commercial capture state from existing structured data.
 * All reads are batched by client IDs; this never issues one query per row.
 */
export async function loadClientCaptureStatusBatch(admin: any, clients: CaptureClient[]) {
  const clientIds = Array.from(new Set(clients.map((client) => String(client.id || "")).filter(Boolean)));
  const output = new Map<string, ClientCaptureStatus>();
  if (!clientIds.length) return output;

  const [purchaseDates, calls, interactions] = await Promise.all([
    firstPurchaseDates(admin, clientIds),
    loadRows(
      admin,
      "rendimiento_llamadas",
      "cliente_id,tiempo,usa_7_free,codigo_1,minutos_1,codigo_2,minutos_2,fecha_hora,created_at",
      "cliente_id",
      clientIds,
    ),
    loadRows(admin, "crm_interacciones", "cliente_id,estado,created_at,cerrado_at", "cliente_id", clientIds),
  ]);

  const callsByClient = new Map<string, any[]>();
  const interactionsByClient = new Map<string, any[]>();
  const group = (target: Map<string, any[]>, rows: any[]) => {
    for (const row of rows) {
      const clientId = String(row?.cliente_id || "");
      if (!clientId) continue;
      const current = target.get(clientId) || [];
      current.push(row);
      target.set(clientId, current);
    }
  };
  group(callsByClient, calls);
  group(interactionsByClient, interactions);

  for (const clientId of clientIds) {
    const clientCalls = callsByClient.get(clientId) || [];
    const clientInteractions = interactionsByClient.get(clientId) || [];

    const firstPurchaseAt = purchaseDates.get(clientId) || null;

    let freeMinutesUsed = 0;
    const validCallDates: Array<string | null> = [];
    for (const row of clientCalls) {
      const freeUsed = freeMinutesInCall(row);
      const usedMinutes = Number(row?.minutos_1 || 0) + Number(row?.minutos_2 || 0);
      if (Number(row?.tiempo || 0) > 0 || usedMinutes > 0 || freeUsed > 0) {
        validCallDates.push(validIso(row?.fecha_hora || row?.created_at));
        freeMinutesUsed += freeUsed;
      }
    }
    const closedInteractionDates = clientInteractions
      .filter((row) => Boolean(row?.cerrado_at) || COMPLETED_INTERACTION_STATES.has(String(row?.estado || "").toLowerCase()))
      .map((row) => validIso(row?.cerrado_at || row?.created_at));
    const lastInteractionAt = latest([...validCallDates, ...closedInteractionDates]);

    output.set(clientId, {
      stage: firstPurchaseAt ? "captured" : lastInteractionAt ? "pending" : "untouched",
      first_purchase_at: firstPurchaseAt,
      last_interaction_at: lastInteractionAt,
      free_minutes_used: Number(freeMinutesUsed.toFixed(2)),
    });
  }

  return output;
}
