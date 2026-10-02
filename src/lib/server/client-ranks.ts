export function normalizeRankClientName(v: any) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const { data, error } = await admin.rpc("tc_client_rank_states", { p_client_ids: clientes.map(c => c.id) });
  if (error) throw error;
  return new Map<string, any>((data || []).map((r: any) =>
    [String(r.cliente_id), { total: Number(r.total), compras: Number(r.compras), pagos: 0, llamadas: 0, state:r, automatic:r.automatic, effective:r.effective }]));
}
