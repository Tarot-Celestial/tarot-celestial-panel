import type { ClienteMinutePack } from "@/lib/server/cliente-minute-packs";
import { rouletteLevelForPurchaseAmount } from "@/lib/ruleta";

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
    created_by_role: "cliente", notas: "Compra desde el panel cliente · PayPal · EUR",
  };
}
