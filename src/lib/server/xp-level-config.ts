import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_XP_LEVELS,
  DEFAULT_XP_TIERS,
  normalizeXpLevels,
  normalizeXpTiers,
  type XpLevelConfig,
  type XpTierConfig,
} from "@/lib/xp-levels";

function missingConfigTable(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("worker_xp_level_config") || message.includes("worker_xp_tier_config");
}

export async function loadXpLevelConfiguration(admin: SupabaseClient): Promise<{
  levels: XpLevelConfig[];
  tiers: XpTierConfig[];
  persisted: boolean;
}> {
  const [levelsResult, tiersResult] = await Promise.all([
    admin
      .from("worker_xp_level_config")
      .select("level,xp_to_next,tier_key,reward_type,reward_amount,reward_label,active,display_order")
      .order("display_order", { ascending: true }),
    admin
      .from("worker_xp_tier_config")
      .select("key,name,display_order,active,reward_type,reward_amount,reward_label")
      .order("display_order", { ascending: true }),
  ]);

  if (levelsResult.error || tiersResult.error) {
    const errors = [levelsResult.error, tiersResult.error].filter(Boolean);
    if (errors.every((error) => missingConfigTable(error))) {
      return {
        levels: normalizeXpLevels(DEFAULT_XP_LEVELS),
        tiers: normalizeXpTiers(DEFAULT_XP_TIERS),
        persisted: false,
      };
    }
    throw levelsResult.error || tiersResult.error;
  }

  return {
    levels: normalizeXpLevels(levelsResult.data || []),
    tiers: normalizeXpTiers(tiersResult.data || []),
    persisted: true,
  };
}
