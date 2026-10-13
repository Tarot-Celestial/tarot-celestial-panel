import "server-only";
import { CLIENTE_MINUTE_PACKS } from "@/lib/server/cliente-minute-packs";
import { ORACLE_PACKS } from "@/lib/server/oracle-premium";
import { ORACLE_QUESTION_PACK } from "@/lib/server/oracle-questions";
import type { RankPackageResolution } from "@/lib/server/rank-benefits";

const BENEFITS_TIMEOUT_MS = 5000;
const resolutionStatuses = new Set(["ready", "disabled", "unmapped_package", "no_effective_rank", "config_missing"]);
const visibleBenefitFields = ["enabled", "coins", "oracle_credits", "roulette_level_1_spins", "roulette_level_2_spins", "roulette_level_3_spins", "roulette_special_spins"] as const;

function unavailableCatalog() {
  return {
    rankKey: null as string | null,
    rankLabel: null as string | null,
    packs: CLIENTE_MINUTE_PACKS.map(pack => ({
      ...pack, packageLevel: null, rankBenefits: null, rankBenefitsStatus: "unavailable",
    })),
  };
}

async function resolveCatalogPacks(admin: any, clientId: string, signal: AbortSignal) {
  // The database remains the authority for automatic AND manually assigned ranks.
  const rank = await admin.rpc("tc_client_rank_state", { p_cliente_id: clientId }).abortSignal(signal);
  if (rank.error) throw rank.error;
  const state = rank.data;
  if (!state || !Object.prototype.hasOwnProperty.call(state, "effective")) throw new Error("CATALOG_RANK_UNAVAILABLE");
  const effective = state.effective;
  // An explicit null is a verified account without a rank, not a failed lookup.
  if (effective !== null && (
    typeof effective !== "string" || !effective.trim() || state.config?.rank_key !== effective
  )) throw new Error("CATALOG_RANK_UNAVAILABLE");
  if (signal.aborted) throw new Error("CATALOG_BENEFITS_TIMEOUT");

  // The existing resolver uses cliente_id only to obtain this same rank state.
  // Supplying its verified effective rank avoids recalculating purchase history
  // for each of the nine packs. Checkout still resolves benefits independently.
  const result = await admin.rpc("tc_resolve_rank_package_benefits", {
    p_cliente_id: null,
    p_rank_key_override: effective,
    p_packages: CLIENTE_MINUTE_PACKS.map(pack => ({ package_source: "standard", package_key: pack.id })),
  }).abortSignal(signal);
  if (result.error) throw result.error;
  const rows: RankPackageResolution[] = Array.isArray(result.data) ? result.data : [];
  const byKey = new Map(rows.filter(row => row?.package_source === "standard").map(row => [row.package_key, row]));
  const packs = CLIENTE_MINUTE_PACKS.map(pack => {
    const resolved = byKey.get(pack.id);
    const valid = resolved && resolved.rank_key === effective && resolutionStatuses.has(resolved.status);
    const level = resolved?.package_level;
    return {
      ...pack,
      packageLevel: valid && [1, 2, 3].includes(Number(level)) ? level : null,
      rankBenefits: valid && resolved.rank_benefits
        ? Object.fromEntries(visibleBenefitFields.map(key => [key, resolved.rank_benefits[key]]))
        : null,
      rankBenefitsStatus: valid ? resolved.status : "unavailable",
    };
  });
  return {
    packs,
    rankKey: effective as string | null,
    // Only the public label is exposed; rank history and override notes stay private.
    rankLabel: effective !== null && typeof state.config?.label === "string"
      ? state.config.label.trim() || null
      : null,
  };
}

/** Read-only catalogue: no wallet, greeting grants, oracle readings or payment history. */
export async function loadClientePriceCatalog(admin: any, clientId: string, timeoutMs = BENEFITS_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReturnType<typeof unavailableCatalog>>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(unavailableCatalog());
    }, timeoutMs);
  });
  try {
    const catalog = await Promise.race([
      resolveCatalogPacks(admin, clientId, controller.signal).catch(() => unavailableCatalog()),
      timeout,
    ]);
    return { ...catalog, oraclePacks: ORACLE_PACKS, questionPack: ORACLE_QUESTION_PACK };
  } finally {
    clearTimeout(timer);
  }
}
