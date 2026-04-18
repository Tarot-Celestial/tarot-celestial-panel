export function normalizeRankClientName(v: any) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function calcClientRank(total: number) {
  if (total >= 500) return "oro";
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
  const byName = buildClienteNameMap(clientes);

  const [llamadasFechaRes, llamadasCreatedRes, pagosRes] = await Promise.all([
    admin
      .from("rendimiento_llamadas")
      .select("id, cliente_id, cliente_nombre, importe, fecha_hora, created_at")
      .gte("fecha_hora", sinceIso),
    admin
      .from("rendimiento_llamadas")
      .select("id, cliente_id, cliente_nombre, importe, fecha_hora, created_at")
      .gte("created_at", sinceIso)
      .lte("created_at", nowIso),
    admin
      .from("crm_cliente_pagos")
      .select("id, cliente_id, importe, created_at, estado")
      .eq("estado", "completed")
      .gte("created_at", sinceIso)
      .lte("created_at", nowIso),
  ]);

  if (llamadasFechaRes.error) throw llamadasFechaRes.error;
  if (llamadasCreatedRes.error) throw llamadasCreatedRes.error;
  if (pagosRes.error) throw pagosRes.error;

  const llamadasMap = new Map<string, any>();
  for (const row of [...(llamadasFechaRes.data || []), ...(llamadasCreatedRes.data || [])]) {
    const key = String(row?.id || `${row?.cliente_id || ""}:${row?.cliente_nombre || ""}:${row?.fecha_hora || row?.created_at || ""}:${row?.importe || 0}`);
    if (!llamadasMap.has(key)) llamadasMap.set(key, row);
  }

  const totals = new Map<string, { total: number; compras: number; pagos: number; llamadas: number }>();

  for (const row of llamadasMap.values()) {
    const amount = Number(row?.importe || 0);
    if (!(amount > 0)) continue;
    let clienteId = String(row?.cliente_id || "").trim();
    if (!clienteId) clienteId = byName.get(normalizeRankClientName(row?.cliente_nombre)) || "";
    if (!clienteId) continue;
    const prev = totals.get(clienteId) || { total: 0, compras: 0, pagos: 0, llamadas: 0 };
    prev.total += amount;
    prev.compras += 1;
    prev.llamadas += 1;
    totals.set(clienteId, prev);
  }

  for (const row of pagosRes.data || []) {
    const amount = Number(row?.importe || 0);
    const clienteId = String(row?.cliente_id || "").trim();
    if (!clienteId || !(amount > 0)) continue;
    const prev = totals.get(clienteId) || { total: 0, compras: 0, pagos: 0, llamadas: 0 };
    prev.total += amount;
    prev.compras += 1;
    prev.pagos += 1;
    totals.set(clienteId, prev);
  }

  for (const [clienteId, info] of totals.entries()) {
    info.total = roundMoney(info.total);
    totals.set(clienteId, info);
  }

  return totals;
}
