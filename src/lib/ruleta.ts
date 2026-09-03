export type RouletteLevel = 1 | 2;
export type RoulettePrize = {
  id: string; nivel: RouletteLevel; reward_type: "minutes" | "coins";
  reward_value: number; probability: number; special: boolean;
};
export type RouletteSummary = {
  cliente_id: string; available_spins: number; level_1_spins: number; level_2_spins: number;
  next_spin_1: string | null; next_spin_2: string | null; next_level: RouletteLevel;
  level_2_from: number; catalogue: RoulettePrize[];
};
export type RouletteReward = {
  spin_id: string; spin_level: RouletteLevel; reward_id: string; reward_type: "minutes" | "coins";
  reward_value: number; balance_before: number; balance_after: number; special: boolean;
};
export function prizeLabel(prize: Pick<RoulettePrize, "reward_type" | "reward_value">) {
  return "+" + prize.reward_value + (prize.reward_type === "coins" ? " Coins" : " min");
}
export function winningRotation(previous: number, index: number, count: number) {
  const target = (360 - (index + 0.5) * 360 / count) % 360;
  return previous + 5 * 360 + (target - previous % 360 + 360) % 360;
}
