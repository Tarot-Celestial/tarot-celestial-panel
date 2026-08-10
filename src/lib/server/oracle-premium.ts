export type OraclePack = {
  id: "oracle_2" | "destino_3";
  nombre: string;
  descripcion: string;
  priceEur: number;
  credits: number;
};

export const ORACLE_PACKS: OraclePack[] = [
  { id: "oracle_2", nombre: "Pack Oráculo", descripcion: "2 tiradas premium · 1 pregunta incluida por cada tirada.", priceEur: 1, credits: 2 },
  { id: "destino_3", nombre: "Pack Destino", descripcion: "3 tiradas premium · 1 pregunta incluida por cada tirada.", priceEur: 2, credits: 3 },
];

export function getOraclePack(value: unknown): OraclePack | null {
  return ORACLE_PACKS.find((pack) => pack.id === String(value || "").trim()) || null;
}

export async function getOracleCreditBalance(admin: any, clienteId: string): Promise<number> {
  const { data, error } = await admin.rpc("get_cliente_oracle_balance", { p_cliente_id: clienteId });
  if (error) {
    if (error.code === "42883" || /does not exist/i.test(String(error.message || ""))) return 0;
    throw error;
  }
  return Math.max(0, Number(data || 0));
}

export async function grantOracleCredits(admin: any, params: {
  clienteId: string;
  credits: number;
  reference: string;
  packId: string;
  notes: string;
  meta?: Record<string, unknown>;
}) {
  const { data, error } = await admin.rpc("grant_cliente_oracle_credits", {
    p_cliente_id: params.clienteId,
    p_amount: params.credits,
    p_reference: params.reference,
    p_pack_id: params.packId,
    p_notes: params.notes,
    p_meta: params.meta || {},
  });
  if (error) throw error;
  return Number(data || 0);
}

export async function consumeOracleCredit(admin: any, params: {
  clienteId: string;
  drawKey: string;
  drawType: string;
  notes: string;
}) {
  const { data, error } = await admin.rpc("consume_cliente_oracle_credit", {
    p_cliente_id: params.clienteId,
    p_draw_key: params.drawKey,
    p_draw_type: params.drawType,
    p_notes: params.notes,
  });
  if (error) throw error;
  return Number(data || 0);
}
