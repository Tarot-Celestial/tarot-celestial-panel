export const XP_LEVEL_STEPS = [
  100, 150, 250, 350,
  500, 650, 800, 1000,
  1250, 1500, 1800, 2100,
  2500, 3000, 3500, 4000,
  4500, 5000, 6000,
] as const;

export const XP_MAX_LEVEL = 20;
export const XP_TO_LEVEL_20 = XP_LEVEL_STEPS.reduce((sum, value) => sum + value, 0);

export type XpTierKey = "bronze" | "silver" | "gold" | "elite" | "master" | "legend" | string;

export type XpTierConfig = {
  key: string;
  name: string;
  display_order: number;
  active: boolean;
  reward_type: string | null;
  reward_amount: number | null;
  reward_label: string | null;
};

export type XpLevelConfig = {
  level: number;
  xp_to_next: number | null;
  tier_key: string;
  reward_type: string | null;
  reward_amount: number | null;
  reward_label: string | null;
  active: boolean;
  display_order: number;
};

export type XpConfiguredLevel = XpLevelConfig & {
  cumulative_xp: number;
  next_active_level: number | null;
};

export const DEFAULT_XP_TIERS: readonly XpTierConfig[] = [
  { key: "bronze", name: "Bronce", display_order: 1, active: true, reward_type: null, reward_amount: null, reward_label: null },
  { key: "silver", name: "Plata", display_order: 2, active: true, reward_type: null, reward_amount: null, reward_label: null },
  { key: "gold", name: "Oro", display_order: 3, active: true, reward_type: null, reward_amount: null, reward_label: null },
  { key: "elite", name: "Élite", display_order: 4, active: true, reward_type: null, reward_amount: null, reward_label: null },
  { key: "master", name: "Maestra", display_order: 5, active: true, reward_type: null, reward_amount: null, reward_label: null },
  { key: "legend", name: "Leyenda", display_order: 6, active: true, reward_type: null, reward_amount: null, reward_label: null },
] as const;

function defaultTierForLevel(level: number) {
  if (level <= 4) return "bronze";
  if (level <= 8) return "silver";
  if (level <= 12) return "gold";
  if (level <= 16) return "elite";
  if (level <= 19) return "master";
  return "legend";
}

export const DEFAULT_XP_LEVELS: readonly XpLevelConfig[] = Array.from({ length: XP_MAX_LEVEL }, (_, index) => {
  const level = index + 1;
  return {
    level,
    xp_to_next: level < XP_MAX_LEVEL ? XP_LEVEL_STEPS[index] ?? 0 : null,
    tier_key: defaultTierForLevel(level),
    reward_type: null,
    reward_amount: null,
    reward_label: null,
    active: true,
    display_order: level,
  };
});

export function normalizeXpTiers(rows?: readonly Partial<XpTierConfig>[] | null): XpTierConfig[] {
  const source = rows?.length ? rows : DEFAULT_XP_TIERS;
  return source
    .map((row, index) => ({
      key: String(row.key || `tier_${index + 1}`).trim(),
      name: String(row.name || row.key || `Rango ${index + 1}`).trim(),
      display_order: Number(row.display_order ?? index + 1) || index + 1,
      active: row.active !== false,
      reward_type: row.reward_type ? String(row.reward_type) : null,
      reward_amount: row.reward_amount == null ? null : Number(row.reward_amount),
      reward_label: row.reward_label ? String(row.reward_label) : null,
    }))
    .filter((row) => row.key)
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, "es"));
}

export function normalizeXpLevels(rows?: readonly Partial<XpLevelConfig>[] | null): XpLevelConfig[] {
  const source = rows?.length ? rows : DEFAULT_XP_LEVELS;
  const normalized = source
    .map((row, index) => {
      const level = Math.max(1, Math.min(XP_MAX_LEVEL, Math.trunc(Number(row.level ?? index + 1) || index + 1)));
      return {
        level,
        xp_to_next: level >= XP_MAX_LEVEL || row.xp_to_next == null ? null : Math.max(0, Math.trunc(Number(row.xp_to_next) || 0)),
        tier_key: String(row.tier_key || defaultTierForLevel(level)),
        reward_type: row.reward_type ? String(row.reward_type) : null,
        reward_amount: row.reward_amount == null ? null : Number(row.reward_amount),
        reward_label: row.reward_label ? String(row.reward_label) : null,
        active: row.active !== false,
        display_order: Number(row.display_order ?? level) || level,
      };
    })
    .sort((a, b) => a.display_order - b.display_order || a.level - b.level);

  const byLevel = new Map(normalized.map((row) => [row.level, row]));
  return Array.from({ length: XP_MAX_LEVEL }, (_, index) => byLevel.get(index + 1) ?? DEFAULT_XP_LEVELS[index]);
}

export function buildConfiguredLevels(rows?: readonly Partial<XpLevelConfig>[] | null): XpConfiguredLevel[] {
  const levels = normalizeXpLevels(rows);
  const active = levels.filter((row) => row.active).sort((a, b) => a.display_order - b.display_order || a.level - b.level);
  let cumulative = 0;

  return active.map((row, index) => {
    const next = active[index + 1] ?? null;
    const current = {
      ...row,
      cumulative_xp: cumulative,
      next_active_level: next?.level ?? null,
    };
    if (next) cumulative += Math.max(0, Number(row.xp_to_next) || 0);
    return current;
  });
}

export function configuredXpProgress(
  totalXp: number,
  levelRows?: readonly Partial<XpLevelConfig>[] | null,
  tierRows?: readonly Partial<XpTierConfig>[] | null,
) {
  const total = Math.max(0, Number(totalXp) || 0);
  const levels = buildConfiguredLevels(levelRows);
  const tiers = normalizeXpTiers(tierRows);
  const safeLevels = levels.length ? levels : buildConfiguredLevels(DEFAULT_XP_LEVELS);

  for (let index = 0; index < safeLevels.length; index += 1) {
    const row = safeLevels[index];
    const next = safeLevels[index + 1] ?? null;
    const span = next ? Math.max(0, Number(row.xp_to_next) || 0) : 0;
    const threshold = row.cumulative_xp + span;

    if (next && total < threshold) {
      const tier = tiers.find((item) => item.key === row.tier_key) ?? null;
      return {
        level: row.level,
        floor: row.cumulative_xp,
        next: threshold,
        current: Math.max(0, total - row.cumulative_xp),
        span,
        remaining: Math.max(0, threshold - total),
        nextLevel: next.level,
        maxed: false,
        tier,
        levels: safeLevels,
        tiers,
        totalRequiredForMax: safeLevels[safeLevels.length - 1]?.cumulative_xp ?? 0,
      };
    }
  }

  const last = safeLevels[safeLevels.length - 1];
  const tier = tiers.find((item) => item.key === last.tier_key) ?? null;
  return {
    level: last.level,
    floor: last.cumulative_xp,
    next: null,
    current: Math.max(0, total - last.cumulative_xp),
    span: 0,
    remaining: 0,
    nextLevel: null,
    maxed: true,
    tier,
    levels: safeLevels,
    tiers,
    totalRequiredForMax: last.cumulative_xp,
  };
}

export function xpRequiredToReachLevel(level: number) {
  const target = Math.min(XP_MAX_LEVEL, Math.max(1, Math.trunc(level)));
  let total = 0;
  for (let current = 1; current < target; current += 1) {
    total += XP_LEVEL_STEPS[current - 1] ?? 0;
  }
  return total;
}
