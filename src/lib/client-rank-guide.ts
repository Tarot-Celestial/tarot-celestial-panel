import type { RankPackageBenefitConfig, DiamondDailyBonusConfig } from "./rank-benefit-config";

export const CLIENT_GUIDE_RANKS = ["bronce", "plata", "oro", "diamante"] as const;
export type GuideRankKey = typeof CLIENT_GUIDE_RANKS[number];
export type GuideRank = {
  key: GuideRankKey;
  label: string;
  min_spend: number;
  active: boolean;
  benefits: string[];
  package_benefits: Omit<RankPackageBenefitConfig, "revision">[] | null;
};
export type ClientRankGuide = {
  ok: true;
  cliente_id: string;
  currency: "USD";
  window_days: 30;
  refreshed_at: string;
  state: {
    effective: GuideRankKey | null;
    automatic: GuideRankKey | null;
    total: number;
    purchases: number | null;
    has_override: boolean;
    override_ends_at: string | null;
  };
  ranks: GuideRank[];
  daily_bonus: Omit<DiamondDailyBonusConfig, "id" | "revision"> | null;
  daily_bonus_available: boolean;
  warnings: string[];
};

export function guideRankKey(value: unknown): GuideRankKey | null {
  return CLIENT_GUIDE_RANKS.includes(value as GuideRankKey) ? value as GuideRankKey : null;
}

export function rankMoney(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", currencyDisplay: "code", maximumFractionDigits: 2 }).format(value);
}

/** Presentation only. The effective and automatic ranks are owned by the server. */
export function guideProgress(guide: ClientRankGuide) {
  const total = guide.state.total;
  const ranks = [...guide.ranks].sort((a, b) => a.min_spend - b.min_spend);
  const next = ranks.find(rank => rank.min_spend > total) || null;
  const previous = next ? ranks[ranks.indexOf(next) - 1] : ranks[ranks.length - 1];
  const base = previous?.min_spend || 0;
  return {
    next,
    remaining: next ? Math.max(0, Math.round((next.min_spend - total) * 100) / 100) : 0,
    percent: next ? Math.max(0, Math.min(100, ((total - base) / (next.min_spend - base)) * 100)) : 100,
  };
}