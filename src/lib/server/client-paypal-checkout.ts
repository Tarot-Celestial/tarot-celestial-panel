import type { ClienteMinutePack } from "@/lib/server/cliente-minute-packs";
import { rouletteLevelForPurchaseAmount } from "@/lib/ruleta";
import type { PromotionPackageSnapshot } from "@/lib/server/client-promotions";

export function buildPromotionPurchaseSnapshot(snapshot: PromotionPackageSnapshot) {
  // Match the EUR card settlement contract before creating a payable order.
  if (snapshot.currency !== "EUR" || !Number.isFinite(snapshot.price) || snapshot.price <= 0 ||
      ![snapshot.paid_minutes, snapshot.free_minutes, snapshot.oracle_credits].every(value => Number.isSafeInteger(value) && value >= 0) ||
      snapshot.paid_minutes + snapshot.free_minutes <= 0) {
    throw new Error("Esta promoción necesita tramitarse con tu central.");
  }
  return {
    pack_id: `promo:${snapshot.package_id}`, pack_name: snapshot.package_name,
    total_minutes: snapshot.paid_minutes + snapshot.free_minutes,
    normal: snapshot.paid_minutes, free: snapshot.free_minutes, points: 0,
    oracle_credits: snapshot.oracle_credits, roulette_level: null,
    roulette_spins: 0, promotion_snapshot: { ...snapshot, coins: 0, roulette_level: null,
      roulette_spins: 0, roulette_assignment: null, special_roulette_granted: false,
      reward_policy_version: 1, pricing_mode: "promotion", purchase_classification: "promo", rewards_eligible: false },
    reward_policy_version: 1, pricing_mode: "promotion", purchase_classification: "promo", rewards_eligible: false,
    created_by_role: "cliente", notas: "Compra de promoción desde el panel cliente · PayPal · EUR",
  };
}

// Purchased package minutes, approved by the business. This does not rewrite
// historical purchases or the staff's separate call-registration workflow.
const NORMAL_MINUTES: Readonly<Record<number, number>> = {
  10: 10, 20: 20, 30: 20, 40: 30, 50: 30, 60: 40, 80: 50, 120: 80, 180: 120,
};
export function splitPurchasedPackMinutes(totalMinutes: number) {
  const normal = NORMAL_MINUTES[totalMinutes];
  if (!Number.isInteger(totalMinutes) || normal === undefined) throw new Error("Unsupported purchased package");
  return { normal, free: totalMinutes - normal };
}
export function buildClientPurchaseSnapshot(pack: ClienteMinutePack) {
  const level = rouletteLevelForPurchaseAmount(pack.priceUsd);
  if (!level) throw new Error("Package has no configured roulette level");
  return {
    pack_id: pack.id, pack_name: pack.nombre, total_minutes: pack.totalMinutes,
    ...splitPurchasedPackMinutes(pack.totalMinutes), points: pack.rewardCoins || 0,
    oracle_credits: pack.oracleCredits || 0, roulette_level: level, roulette_spins: pack.rouletteSpins,
    reward_policy_version: 1, pricing_mode: "regular", purchase_classification: "nada", rewards_eligible: true,
    package_level: pack.rouletteLevel,
    created_by_role: "cliente", notas: "Compra desde el panel cliente · PayPal · EUR",
  };
}
