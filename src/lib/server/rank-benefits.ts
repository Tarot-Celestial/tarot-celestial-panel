export type ClientRankBenefits = { rank_key: string | null; purchase_coins: number; ritual_access: boolean };
export async function clientRankBenefits(admin: any, clientId: string): Promise<ClientRankBenefits> {
  const { data, error } = await admin.rpc("tc_rank_phase_one_state", { p_cliente_id: clientId });
  if (error) throw error;
  if (!data || typeof data.ritual_access !== "boolean") throw new Error("RANK_BENEFITS_NOT_CONFIGURED");
  return data;
}

import { pointsFromAmount } from "@/lib/server/cliente-platform";
/** Database-owned purchase benefits. Never calculate eligibility in a browser. */
export async function rankState(admin: any, clientId: string) {
  const { data, error } = await admin.rpc("tc_client_rank_state", { p_cliente_id: clientId });
  if (error) throw error;
  return data;
}

export async function purchaseQuote(admin: any, amount: number, currency: string, clientId?: string) {
  const { data, error } = await admin.rpc("tc_purchase_benefit_quote", {
    p_amount: amount, p_currency: currency, p_cliente_id: clientId || null,
  });
  if (error) throw error;
  return data;
}

export async function decoratePacks(admin: any, packs: any[], currency = "EUR") {
  const { data, error } = await admin.rpc("tc_purchase_benefit_quotes", {
    p_packs: packs.map(p => ({ id: p.id, amount: Number(p.price ?? p.priceUsd), currency: p.currency || currency })),
  });
  if (error) throw error;
  const quotes = new Map<string, any>((data || []).map((q: any) => [String(q.id), q]));
  return packs.map(pack => {
    const quote = quotes.get(String(pack.id));
    const special = Number(pack.roulette_level) === 4;
    return { ...pack,
      currency:pack.currency || currency,
      rewardCoins:pack.rewardCoins ?? pointsFromAmount(Number(pack.price ?? pack.priceUsd)),
      rouletteLevel: quote?.roulette_level || null,
      rouletteSpins: quote?.roulette_spins || 0,
      roulette_level: special ? 4 : quote?.roulette_level || null,
      roulette_spins: special ? pack.roulette_spins : quote?.roulette_spins || 0,
    };
  });
}
