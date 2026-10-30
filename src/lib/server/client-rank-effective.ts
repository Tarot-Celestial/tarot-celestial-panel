import { calcClientRank } from "@/lib/server/client-ranks";

export type ClientRankName = "bronce" | "plata" | "oro" | "diamante" | null;

export type EffectiveClientRank = {
  automatic: ClientRankName;
  effective: ClientRankName;
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

export type CanonicalClientRank = EffectiveClientRank & { total: number; compras: number };

/** Keep the spend, count and rank intervention from one database snapshot. */
export async function loadCanonicalClientRank(admin: any, clientId: string): Promise<CanonicalClientRank> {
  const { data, error } = await admin.rpc("tc_client_rank_state", { p_cliente_id: clientId });
  if (error) throw new Error("CLIENT_RANK_UNAVAILABLE");
  const invalid = () => { throw new Error("CLIENT_RANK_INVALID_RESPONSE"); };
  const validRank = (value: unknown) => value === null ||
    (typeof value === "string" && ["bronce", "plata", "oro", "diamante"].includes(value));
  const validDate = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      typeof data.total !== "number" || !Number.isFinite(data.total) || data.total < 0 ||
      !Number.isSafeInteger(data.compras) || data.compras < 0 ||
      !validRank(data.automatic) || !validRank(data.effective)) invalid();

  const override = data.override;
  if (override !== null) {
    if (!override || typeof override !== "object" || Array.isArray(override) ||
        typeof override.id !== "string" || !override.id.trim() ||
        override.rank === null || !validRank(override.rank) ||
        !["temporary", "permanent", "penalty"].includes(override.intervention_type) ||
        !validDate(override.starts_at) || (override.ends_at !== null && !validDate(override.ends_at)) ||
        typeof override.reason !== "string" || (override.notes !== null && typeof override.notes !== "string") ||
        data.effective !== override.rank) invalid();
  } else if (data.effective !== data.automatic) invalid();

  return {
    automatic: data.automatic,
    effective: data.effective,
    override: override === null ? null : {
      id: override.id,
      rank: override.rank,
      intervention_type: override.intervention_type,
      starts_at: override.starts_at,
      ends_at: override.ends_at,
      reason: override.reason,
      notes: override.notes,
    },
    total: data.total,
    compras: data.compras,
  };
}

export function normalizeClientRank(value: unknown): ClientRankName {
  const rank = String(value || "").trim().toLowerCase();
  return rank === "bronce" || rank === "plata" || rank === "oro" || rank === "diamante" ? rank : null;
}

export function rankThresholds(rank: ClientRankName) {
  if (rank === "diamante") return { currentMin: 1000, next: null, nextMin: null };
  if (rank === "oro") return { currentMin: 500, next: "diamante" as const, nextMin: 1000 };
  if (rank === "plata") return { currentMin: 100, next: "oro" as const, nextMin: 500 };
  return { currentMin: rank === "bronce" ? 0.01 : 0, next: "plata" as const, nextMin: 100 };
}

export function rankProgress(total: number, rank: ClientRankName) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const config = rankThresholds(rank);
  if (!config.next || !config.nextMin) return 100;
  const span = Math.max(1, config.nextMin - config.currentMin);
  return Math.max(0, Math.min(100, ((safeTotal - config.currentMin) / span) * 100));
}

export async function loadEffectiveClientRank(admin: any, clientId: string, rollingTotal: number): Promise<EffectiveClientRank> {
  const automatic = normalizeClientRank(calcClientRank(rollingTotal));
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("client_rank_overrides")
    .select("id,assigned_rank,intervention_type,starts_at,ends_at,reason,notes")
    .eq("client_id", clientId)
    .eq("active", true)
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "42P01") throw error;
  const assigned = normalizeClientRank(data?.assigned_rank);
  if (!data || !assigned) return { automatic, effective: automatic, override: null };

  return {
    automatic,
    effective: assigned,
    override: {
      id: String(data.id),
      rank: assigned,
      intervention_type: data.intervention_type,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      reason: data.reason,
      notes: data.notes || null,
    },
  };
}
