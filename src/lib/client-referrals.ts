export const REFERRALS_CHANGED = "tc-client-referrals-changed";
export type ReferralRewardType = "free_minutes" | "normal_minutes" | "coins" | "oracle" | "roulette" | "rank";
export type ReferralReward = {
  id: string; title: string; referrals_required: number; reward_type: ReferralRewardType;
  amount: number; roulette_level: number | null; rank_key: "oro" | "diamante" | null;
  rank_days: number | null; enabled: boolean; version: number;
  claimable?: boolean; unavailable_reason?: string | null;
};
export type ReferralSummary = { total: number; available: number; claimed: number; pending: number; oracle_credits?: number };
export type ReferralRecord = { id: string; referred_id?: string; name: string; status: "available" | "claimed" | "pending"; created_at: string; claimed_at: string | null; reward_title: string | null; paid_total?: number };
export type ReferralClaim = { id: string; reward_title: string; reward_description: string; created_at: string };
export type ReferralState = { summary: ReferralSummary; rewards: ReferralReward[]; referrals: ReferralRecord[]; claims: ReferralClaim[]; qualification: "purchases_over_10"; claim_mode: "consume" };
export type ReferralSnapshot = ReferralState;

export function referralRewardDescription(reward: Pick<ReferralReward, "reward_type" | "amount" | "roulette_level" | "rank_key" | "rank_days">): string {
  const amount = Number(reward.amount).toLocaleString("es-ES");
  switch (reward.reward_type) {
    case "free_minutes": return `${amount} minutos FREE`;
    case "normal_minutes": return `${amount} minutos normales`;
    case "coins": return `${amount} Coins`;
    case "oracle": return `${amount} tirada${reward.amount === 1 ? "" : "s"} de Oráculo`;
    case "roulette": return `${amount} giro${reward.amount === 1 ? "" : "s"} · ${reward.roulette_level === 4 ? "Especial" : reward.roulette_level === 5 ? "Diamante" : `Nivel ${reward.roulette_level}`}`;
    case "rank": return `Rango ${reward.rank_key === "oro" ? "Oro" : "Diamante"} durante ${reward.rank_days} días`;
  }
}
export const referralRewardLabel = referralRewardDescription;
export class ReferralInputError extends Error {}
export const isReferralUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function requireReferralUuid(value: unknown): string {
  if (!isReferralUuid(value)) throw new ReferralInputError("La referencia no es válida. Actualiza e inténtalo de nuevo.");
  return value.toLowerCase();
}
function positiveInteger(value: unknown, max: number, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) throw new ReferralInputError(message);
  return value;
}
export function parseReferralReward(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReferralInputError("Revisa los datos del premio.");
  const r = value as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title || title.length > 100) throw new ReferralInputError("Escribe un título de hasta 100 caracteres.");
  const types: ReferralRewardType[] = ["free_minutes", "normal_minutes", "coins", "oracle", "roulette", "rank"];
  if (!types.includes(r.reward_type as ReferralRewardType)) throw new ReferralInputError("Selecciona un tipo de premio válido.");
  const type = r.reward_type as ReferralRewardType;
  if (typeof r.enabled !== "boolean") throw new ReferralInputError("Indica si el premio está activo.");
  const amount = type === "rank" ? 1 : positiveInteger(r.amount, type === "coins" ? 1_000_000 : type === "free_minutes" || type === "normal_minutes" ? 10_000 : 100, "La cantidad debe ser un entero positivo dentro del límite indicado.");
  const cost = positiveInteger(r.referrals_required, 1000, "Indica entre 1 y 1.000 referidos necesarios.");
  const rouletteLevel = type === "roulette" ? positiveInteger(r.roulette_level, 5, "Selecciona una ruleta de nivel 1 a 5.") : null;
  const rankKey = type === "rank" ? r.rank_key : null;
  if (type === "rank" && rankKey !== "oro" && rankKey !== "diamante") throw new ReferralInputError("Selecciona el rango Oro o Diamante.");
  const rankDays = type === "rank" ? positiveInteger(r.rank_days, 365, "Indica una duración de 1 a 365 días.") : null;
  return { title, referrals_required: cost, reward_type: type, amount, roulette_level: rouletteLevel, rank_key: rankKey as "oro" | "diamante" | null, rank_days: rankDays, enabled: r.enabled };
}
