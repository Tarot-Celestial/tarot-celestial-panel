import { pointsFromAmount } from "@/lib/server/cliente-platform";

export type ClientRankBenefits = { rank_key: string | null; ritual_access: boolean };

export async function clientRankBenefits(admin: any, clientId: string): Promise<ClientRankBenefits> {
  const { data, error } = await admin.rpc("tc_client_rank_state", { p_cliente_id: clientId });
  if (error) throw error;
  const rankKey = String(data?.effective || "").trim() || null;
  const ritualAccess = data?.config?.ritual_access === true;
  return { rank_key: rankKey, ritual_access: ritualAccess };
}

/** Database-owned effective rank. Never calculate eligibility in a browser. */
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

function isMissingMatrix(error: any) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return /42P01|PGRST205|tc_purchase_package_levels|tc_rank_package_benefits/i.test(text);
}

/**
 * Adds the DB-owned package level and rank×level benefit preview to real standard packs.
 * It does not grant anything. Supabase remains the only source of truth for delivery.
 */
export async function rankPackageBenefitsForPacks(admin: any, clientId: string, packs: any[], packageSource: "standard" | "promotion" = "standard") {
  const rank = await rankState(admin, clientId);
  const effective = String(rank?.effective || "").trim() || null;
  if (!effective) return packs.map((pack) => ({ ...pack, packageLevel: null, rankBenefits: null }));

  const packIds = packs.map((pack) => String(pack.id));
  const [mappingResult, benefitResult] = await Promise.all([
    admin.from("tc_purchase_package_levels").select("package_key,package_level").eq("package_source", packageSource).in("package_key", packIds),
    admin.from("tc_rank_package_benefits").select("*").eq("rank_key", effective),
  ]);
  if (mappingResult.error) {
    if (isMissingMatrix(mappingResult.error)) return packs.map((pack) => ({ ...pack, packageLevel: null, rankBenefits: null }));
    throw mappingResult.error;
  }
  if (benefitResult.error) {
    if (isMissingMatrix(benefitResult.error)) return packs.map((pack) => ({ ...pack, packageLevel: null, rankBenefits: null }));
    throw benefitResult.error;
  }

  const mapping = new Map((mappingResult.data || []).map((row: any) => [String(row.package_key), Number(row.package_level) || null]));
  const matrix = new Map((benefitResult.data || []).map((row: any) => [Number(row.package_level), row]));
  return packs.map((pack) => {
    const packageLevel = mapping.get(String(pack.id)) || null;
    const rankBenefits = packageLevel ? matrix.get(packageLevel) || null : null;
    return { ...pack, packageLevel, rankBenefits };
  });
}
