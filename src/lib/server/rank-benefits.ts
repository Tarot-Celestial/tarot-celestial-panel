export type ClientRankBenefits = {
  rank_key: string | null;
  ritual_access: boolean;
};

export type RankPackageResolutionStatus =
  | "ready"
  | "disabled"
  | "unmapped_package"
  | "no_effective_rank"
  | "config_missing"
  | "unavailable";

export type RankPackageResolution = {
  status: RankPackageResolutionStatus;
  rank_key: string | null;
  package_source: "standard" | "promotion";
  package_key: string;
  package_level: 1 | 2 | 3 | null;
  rank_benefits: any | null;
  legacy_purchase_benefits?: any | null;
  legacy_general_applies?: boolean;
};

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
    p_amount: amount,
    p_currency: currency,
    p_cliente_id: clientId || null,
  });
  if (error) throw error;
  return data;
}

export async function decoratePacks(admin: any, packs: any[], currency = "EUR") {
  const { data, error } = await admin.rpc("tc_purchase_benefit_quotes", {
    p_packs: packs.map((p) => ({ id: p.id, amount: Number(p.price ?? p.priceUsd), currency: p.currency || currency })),
  });
  if (error) throw error;
  const quotes = new Map<string, any>((data || []).map((q: any) => [String(q.id), q]));
  return packs.map((pack) => {
    const quote = quotes.get(String(pack.id));
    const special = Number(pack.roulette_level) === 4;
    return {
      ...pack,
      currency: pack.currency || currency,
      rewardCoins: Number(pack.rewardCoins || 0),
      rouletteLevel: quote?.roulette_level || null,
      rouletteSpins: quote?.roulette_spins || 0,
      roulette_level: special ? 4 : quote?.roulette_level || null,
      roulette_spins: special ? pack.roulette_spins : quote?.roulette_spins || 0,
    };
  });
}

function isResolverMissing(error: any) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return /PGRST202|42883|tc_resolve_rank_package_benefits|tc_resolve_rank_package_benefit/i.test(text);
}

/**
 * Resolves the exact rank×package benefit that Supabase will use when the
 * corresponding purchase is confirmed. This RPC is also consumed by the
 * database delivery path, so client display and accreditation share one evaluator.
 */
export async function rankPackageBenefitsForPacks(
  admin: any,
  clientId: string,
  packs: any[],
  packageSource: "standard" | "promotion" = "standard",
) {
  if (!packs.length) return [];

  const input = packs.map((pack) => ({
    package_source: packageSource,
    package_key: String(pack.id),
  }));

  const { data, error } = await admin.rpc("tc_resolve_rank_package_benefits", {
    p_cliente_id: clientId,
    p_rank_key_override: null,
    p_packages: input,
  });

  if (error) {
    // The catalogue must remain usable if the additional-benefits resolver is
    // temporarily unavailable. Never replace that failure with a fake zero.
    console.error("[rank-benefits/resolve-packages]", error);
    if (!isResolverMissing(error)) {
      return packs.map((pack) => ({
        ...pack,
        packageLevel: null,
        rankBenefits: null,
        rankBenefitsStatus: "unavailable" as const,
      }));
    }
    return packs.map((pack) => ({
      ...pack,
      packageLevel: null,
      rankBenefits: null,
      rankBenefitsStatus: "unavailable" as const,
    }));
  }

  const rows = Array.isArray(data) ? data : [];
  const byKey = new Map<string, RankPackageResolution>(
    rows.map((row: RankPackageResolution) => [`${row.package_source}:${row.package_key}`, row]),
  );

  return packs.map((pack) => {
    const resolution = byKey.get(`${packageSource}:${String(pack.id)}`) || null;
    return {
      ...pack,
      packageLevel: resolution?.package_level ?? null,
      rankBenefits: resolution?.rank_benefits ?? null,
      rankBenefitsStatus: resolution?.status ?? "unavailable",
      rankBenefitsResolution: resolution,
    };
  });
}
