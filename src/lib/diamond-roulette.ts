import type { RouletteReward } from "./ruleta";

export const DIAMOND_MANUAL_INSTRUCTIONS = "Toma una captura de pantalla de este premio y envíala al número de Tarot Celestial, o llámanos informando de que lo has ganado. Indica la referencia del premio para que podamos gestionarlo.";
export const DIAMOND_DAILY_INSTRUCTIONS = "Reclama 10 minutos cada día durante 7 días naturales, desde hoy, en horario de España (Europe/Madrid). Los días no reclamados no se acumulan. Encontrarás tu premio en Inicio y en la ruleta; Leonaris te recordará cuándo puedes reclamar.";

export type DiamondBenefit = {
  id: string;
  spin_id: string;
  reward_name: string;
  delivery_kind: "manual" | "daily_minutes";
  status: "active" | "pending" | "completed" | "expired";
  daily_minutes: number;
  total_claims: number;
  claims_used: number;
  claimed_today: boolean;
  can_claim: boolean;
  business_day: string;
  next_claim_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export function rouletteRewardMessage(reward: Pick<RouletteReward, "reward_type" | "fulfillment_mode" | "reward_meta">) {
  if (reward.fulfillment_mode === "manual") return DIAMOND_MANUAL_INSTRUCTIONS;
  if (reward.reward_type === "streak_minutes") return DIAMOND_DAILY_INSTRUCTIONS;
  if (reward.reward_type === "roulette_spins") return "Tu giro ya está acreditado. Puedes usarlo en la ruleta del nivel premiado.";
  if (reward.reward_type === "oracle_credits") return "Tus tiradas del Oráculo ya están acreditadas en tu cuenta.";
  if (["minutes", "coins"].includes(reward.reward_type)) return "Premio acreditado automáticamente en tu saldo real.";
  return "Premio registrado en tu cuenta. Puedes seguir su estado aquí mismo.";
}

/** Keep the existing database reward_type constraints: extended deliveries are perks. */
export function diamondRewardStorage(type: string, metadata: Record<string, unknown>) {
  if (type === "roulette_spins") return { reward_type: "perk", metadata: { ...metadata, delivery_kind: "roulette_spins" } };
  if (type === "oracle_credits") return { reward_type: "perk", metadata: { ...metadata, delivery_kind: "oracle_credits" } };
  const delivery_kind = type === "minutes" ? "minutes" : type === "streak_minutes" ? "daily_minutes" : "manual";
  return { reward_type: type, metadata: { ...metadata, delivery_kind } };
}

export function diamondRewardType(row: { reward_type: string; metadata?: Record<string, unknown> | null }) {
  const kind = row.metadata?.delivery_kind;
  return row.reward_type === "perk" && (kind === "roulette_spins" || kind === "oracle_credits") ? kind : row.reward_type;
}
