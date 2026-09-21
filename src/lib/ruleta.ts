export type RouletteLevel = 1 | 2 | 3;
export type RouletteRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "ultra" | "diamond" | "jackpot";
export type RouletteRewardType = "minutes" | "coins" | "rank" | "ritual" | "streak_minutes" | "perk";
export type RouletteFulfillmentMode = "immediate" | "temporary" | "manual" | "claim" | "scheduled";

export type RoulettePrize = {
  id: string;
  nivel: RouletteLevel;
  reward_type: RouletteRewardType;
  reward_value: number;
  probability: number;
  weight?: number;
  special: boolean;
  name?: string;
  description?: string | null;
  label?: string | null;
  rarity?: RouletteRarity;
  icon_key?: string | null;
  fulfillment_mode?: RouletteFulfillmentMode;
  meta?: Record<string, any> | null;
  sort_order?: number;
};

export type RouletteHistoryItem = {
  spin_id: string;
  level: RouletteLevel;
  reward_id?: string | null;
  reward_type: RouletteRewardType;
  reward_value: number;
  reward_label: string;
  rarity?: RouletteRarity;
  created_at: string;
  used_at?: string | null;
  status?: string | null;
};

export type RouletteEntitlement = {
  id: string;
  reward_name: string;
  reward_type: RouletteRewardType;
  status: "active" | "pending" | "completed" | "expired" | string;
  fulfillment_mode: RouletteFulfillmentMode | string;
  total_claims?: number;
  claims_used?: number;
  next_claim_at?: string | null;
  expires_at?: string | null;
  meta?: Record<string, any> | null;
  created_at?: string;
};

export type RouletteCampaign = {
  id: string;
  name: string;
  title?: string | null;
  subtitle?: string | null;
  status?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  active_until_disabled?: boolean;
};

export type RouletteSummary = {
  cliente_id: string;
  available_spins: number;
  level_1_spins: number;
  level_2_spins: number;
  level_3_spins: number;
  next_spin_1: string | null;
  next_spin_2: string | null;
  next_spin_3: string | null;
  next_level: RouletteLevel;
  level_2_from: number;
  level_3_from: number;
  catalogue: RoulettePrize[];
  campaign?: RouletteCampaign | null;
  history?: RouletteHistoryItem[];
  entitlements?: RouletteEntitlement[];
};

export type RouletteReward = {
  spin_id: string;
  spin_level: RouletteLevel;
  reward_id: string;
  reward_type: RouletteRewardType;
  reward_value: number;
  reward_label?: string | null;
  reward_description?: string | null;
  reward_rarity?: RouletteRarity;
  reward_meta?: Record<string, any> | null;
  balance_before: number;
  balance_after: number;
  special: boolean;
  fulfillment_mode?: RouletteFulfillmentMode | string;
  entitlement_id?: string | null;
};

export const rarityLabel: Record<RouletteRarity, string> = {
  common: "Común",
  uncommon: "Poco común",
  rare: "Raro",
  epic: "Épico",
  legendary: "Legendario",
  ultra: "Ultra",
  diamond: "Diamante",
  jackpot: "Jackpot",
};

export function prizeLabel(prize: Pick<RoulettePrize, "reward_type" | "reward_value" | "label" | "name" | "meta"> | Pick<RouletteReward, "reward_type" | "reward_value" | "reward_label" | "reward_meta">) {
  const anyPrize = prize as any;
  if (anyPrize.reward_label) return String(anyPrize.reward_label);
  if (anyPrize.label) return String(anyPrize.label);
  if (anyPrize.name) return String(anyPrize.name);
  if (prize.reward_type === "coins") return `+${prize.reward_value} Coins`;
  if (prize.reward_type === "minutes") return `+${prize.reward_value} min`;
  if (prize.reward_type === "rank") return `Rango ${String(anyPrize.meta?.rank || anyPrize.reward_meta?.rank || "premium").toUpperCase()}`;
  if (prize.reward_type === "ritual") return "Ritual especial";
  if (prize.reward_type === "streak_minutes") return `${Number(anyPrize.meta?.daily_minutes || anyPrize.reward_meta?.daily_minutes || prize.reward_value || 10)} min diarios`;
  return "Premio especial";
}

export function winningRotation(previous: number, index: number, count: number) {
  const safeCount = Math.max(1, count);
  const target = (360 - (index + 0.5) * 360 / safeCount) % 360;
  return previous + 5 * 360 + (target - previous % 360 + 360) % 360;
}
