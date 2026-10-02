
export type ClientRankName = string | null;

export type EffectiveClientRank = {
  automatic: ClientRankName;
  effective: ClientRankName;
  config?: any;
  next?: any;
  override: null | {
    id: string;
    rank: Exclude<ClientRankName, null>;
    intervention_type: "temporary" | "permanent" | "penalty";
    starts_at: string;
    ends_at: string | null;
    reason: string;
    notes: string | null;
  };
};

export function normalizeClientRank(value: unknown): ClientRankName {
  const rank = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{1,39}$/.test(rank) ? rank : null;
}

export async function loadEffectiveClientRank(admin: any, clientId: string, rollingTotal: number): Promise<EffectiveClientRank> {
  const { data, error } = await admin.rpc("tc_client_rank_state", { p_cliente_id: clientId });
  if (error) throw error;
  return { automatic: data.automatic, effective: data.effective, override: data.override, config:data.config, next:data.next };
}
