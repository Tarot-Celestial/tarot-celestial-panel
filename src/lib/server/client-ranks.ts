export function normalizeRankClientName(v: any) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const CLIENT_RANK_THRESHOLDS = { bronce: 0.01, plata: 100, oro: 500, diamante: 1000 } as const;

export function calcClientRank(total: number) {
  if (total >= CLIENT_RANK_THRESHOLDS.diamante) return "diamante";
  if (total >= CLIENT_RANK_THRESHOLDS.oro) return "oro";
  if (total >= 100) return "plata";
  if (total > 0) return "bronce";
  return null;
}

export function roundMoney(n: any) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function buildClienteNameMap(clientes: any[]) {
  const byName = new Map<string, string>();
  for (const c of clientes || []) {
    const full = [c?.nombre, c?.apellido].filter(Boolean).join(" ").trim();
    const key1 = normalizeRankClientName(full);
    const key2 = normalizeRankClientName(c?.nombre);
    if (key1) byName.set(key1, String(c.id));
    if (key2 && !byName.has(key2)) byName.set(key2, String(c.id));
  }
  return byName;
}

export async function loadRolling30ClientTotals(
  admin: any,
  clientes: any[],
  sinceIso: string,
  nowIso: string
) {
  const clientIds = [...new Set((clientes || []).map(client => String(client?.id || "").trim()).filter(Boolean))];
  const totals = new Map<string, { total: number; compras: number; pagos: number; llamadas: number }>();
  const clientIdSet = new Set(clientIds);
  const add = (row: any, kind: "pagos" | "llamadas") => {
    const clienteId = String(row?.cliente_id || "");
    const amount = Number(row?.importe);
    if (!clientIdSet.has(clienteId) || !Number.isFinite(amount) || amount <= 0) return;
    const prev = totals.get(clienteId) || { total: 0, compras: 0, pagos: 0, llamadas: 0 };
    prev.total += amount;
    prev.compras += 1;
    prev[kind] += 1;
    totals.set(clienteId, prev);
  };

  const pageSize = 1000;
  const batchSize = 200;
  async function allPages(query: () => any): Promise<any[]> {
    const rows: any[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await query().order("id", { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  for (let start = 0; start < clientIds.length; start += batchSize) {
    const ids = clientIds.slice(start, start + batchSize);
    const calls = () => admin.from("rendimiento_llamadas")
      .select("id,cliente_id,importe,fecha_hora,created_at").in("cliente_id", ids).gt("importe", 0);
    const [payments, datedCalls, fallbackCalls] = await Promise.all([
      allPages(() => admin.from("crm_cliente_pagos")
        .select("id,cliente_id,importe").in("cliente_id", ids)
        .eq("estado", "completed").gt("importe", 0).gte("created_at", sinceIso).lte("created_at", nowIso)),
      allPages(() => calls().gte("fecha_hora", sinceIso).lte("fecha_hora", nowIso)),
      // Match COALESCE(fecha_hora, created_at): creation time is only a fallback.
      allPages(() => calls().is("fecha_hora", null).gte("created_at", sinceIso).lte("created_at", nowIso)),
    ]);
    const callsById = new Map<string, any>();
    for (const row of [...datedCalls, ...fallbackCalls]) callsById.set(String(row.id), row);
    const callIds = [...callsById.keys()];
    const linkedCallIds = new Set<string>();
    for (let index = 0; index < callIds.length; index += batchSize) {
      const callBatch = callIds.slice(index, index + batchSize);
      // The canonical RPC excludes a call when ANY payment references it, even
      // a refunded payment or one outside the window. Never filter this lookup.
      const links = await allPages(() => admin.from("crm_cliente_pagos")
        .select("id,source_rendimiento_id").in("source_rendimiento_id", callBatch));
      for (const row of links) linkedCallIds.add(String(row.source_rendimiento_id));
    }
    for (const payment of payments) add(payment, "pagos");
    for (const [callId, call] of callsById) {
      if (!linkedCallIds.has(callId)) add(call, "llamadas");
    }
  }

  for (const [clienteId, info] of totals.entries()) {
    info.total = roundMoney(info.total);
    totals.set(clienteId, info);
  }

  return totals;
}
