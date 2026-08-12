export const XP_LEVEL_STEPS = [
  100, 150, 250, 350,
  500, 650, 800, 1000,
  1250, 1500, 1800, 2100,
  2500, 3000, 3500, 4000,
  4500, 5000, 6000,
] as const;

export const XP_MAX_LEVEL = 20;
export const XP_TO_LEVEL_20 = XP_LEVEL_STEPS.reduce((sum, value) => sum + value, 0);

export type XpTierKey = "bronze" | "silver" | "gold" | "elite" | "master" | "legend";

export type XpTierDefinition = {
  key: XpTierKey;
  name: string;
  minLevel: number;
  maxLevel: number;
};

export const XP_TIERS: readonly XpTierDefinition[] = [
  { key: "bronze", name: "Bronce", minLevel: 1, maxLevel: 4 },
  { key: "silver", name: "Plata", minLevel: 5, maxLevel: 8 },
  { key: "gold", name: "Oro", minLevel: 9, maxLevel: 12 },
  { key: "elite", name: "Élite", minLevel: 13, maxLevel: 16 },
  { key: "master", name: "Maestra", minLevel: 17, maxLevel: 19 },
  { key: "legend", name: "Leyenda", minLevel: 20, maxLevel: 20 },
] as const;

export function xpRequiredToReachLevel(level: number) {
  const target = Math.min(XP_MAX_LEVEL, Math.max(1, Math.trunc(level)));
  let total = 0;
  for (let current = 1; current < target; current += 1) {
    total += XP_LEVEL_STEPS[current - 1] ?? 0;
  }
  return total;
}

export function xpTierForLevel(level: number) {
  const safeLevel = Math.min(XP_MAX_LEVEL, Math.max(1, Math.trunc(level)));
  return XP_TIERS.find((tier) => safeLevel >= tier.minLevel && safeLevel <= tier.maxLevel) ?? XP_TIERS[0];
}

export function xpLevelProgress(totalXp: number) {
  const total = Math.max(0, Number(totalXp) || 0);
  let floor = 0;

  for (let level = 1; level < XP_MAX_LEVEL; level += 1) {
    const span = XP_LEVEL_STEPS[level - 1] ?? 0;
    const next = floor + span;
    if (total < next) {
      return {
        level,
        floor,
        next,
        current: total - floor,
        span,
        remaining: Math.max(0, next - total),
        nextLevel: level + 1,
        maxed: false,
        tier: xpTierForLevel(level),
      };
    }
    floor = next;
  }

  return {
    level: XP_MAX_LEVEL,
    floor: XP_TO_LEVEL_20,
    next: null,
    current: Math.max(0, total - XP_TO_LEVEL_20),
    span: 0,
    remaining: 0,
    nextLevel: null,
    maxed: true,
    tier: xpTierForLevel(XP_MAX_LEVEL),
  };
}

export function xpTierRanges() {
  return XP_TIERS.map((tier) => ({
    ...tier,
    startXp: xpRequiredToReachLevel(tier.minLevel),
    endXp: tier.maxLevel >= XP_MAX_LEVEL ? null : xpRequiredToReachLevel(tier.maxLevel + 1),
  }));
}
