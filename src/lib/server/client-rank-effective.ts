import { calcClientRank } from "@/lib/server/client-ranks";

export type ClientRankName = "bronce" | "plata" | "oro" | null;

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

export function normalizeClientRank(value: unknown): ClientRankName {
  const rank = String(value || "").trim().toLowerCase();
  return rank === "bronce" || rank === "plata" || rank === "oro" ? rank : null;
}

export function rankThresholds(rank: ClientRankName) {
  if (rank === "oro") return { currentMin: 500, next: null, nextMin: null };
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
