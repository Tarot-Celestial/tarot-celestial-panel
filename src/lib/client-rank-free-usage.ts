export type RankFreeUsageRank = "sin_rango" | "bronce" | "plata" | "oro" | "diamante";

export type RankFreeOffer = {
  workerId: string;
  workerName: string;
  eligibilityKey: string;
  eligible: boolean;
  reason: string | null;
  grantMinutes: number;
  consumeMinutes: number;
};

const RANK_FREE_BLOCKS: Record<RankFreeUsageRank, { label: string; minutes: number }> = {
  sin_rango: { label: "Sin rango", minutes: 7 },
  bronce: { label: "Bronce", minutes: 7 },
  plata: { label: "Plata", minutes: 10 },
  oro: { label: "Oro", minutes: 12 },
  diamante: { label: "Diamante", minutes: 15 },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function rankFreeReason(reason: unknown) {
  switch (reason) {
    case "RANK_NOT_ELIGIBLE": return "No se pudo confirmar el rango actual para este regalo. Actualiza la ficha antes de continuar.";
    case "ALREADY_USED": return "Este cliente ya utilizó el regalo para conocer a esta tarotista.";
    case "TAROTISTA_INACTIVE": return "Esta tarotista ya no está disponible para el regalo de bienvenida.";
    case "SOURCE_REQUIRED": return "Selecciona una tarotista nueva con un regalo disponible.";
    case "NO_ELIGIBLE_SOURCE": return "No hay regalos disponibles para conocer a una tarotista nueva.";
    case "POLICY_NOT_CONFIGURED": return "El regalo por rango todavía no está disponible para registrar llamadas.";
    default: return "No se pudo confirmar este regalo. Cierra y vuelve a abrir el registro para actualizarlo.";
  }
}

/** Read-only presentation of a server preview. Rank alone, an existing FREE
 * balance or a seven-minute pass never authorizes this once-per-worker gift. */
export function rankFreeUsage(value: unknown) {
  const preview = record(value);
  const rawRank = typeof preview.effective_rank === "string" ? preview.effective_rank.trim().toLowerCase() : "";
  const rank: RankFreeUsageRank | null = rawRank === "sin_rango" || rawRank === "bronce" || rawRank === "plata" || rawRank === "oro" || rawRank === "diamante" ? rawRank : null;
  const block = rank ? RANK_FREE_BLOCKS[rank] : null;
  const policyKey = typeof preview.policy_key === "string" ? preview.policy_key.trim() : "";
  const valid = Boolean(block && Number(preview.minutes) === block.minutes && policyKey === "new_tarotista_once_v1");
  const seen = new Set<string>();
  const offers: RankFreeOffer[] = [];
  for (const entry of Array.isArray(preview.offers) ? preview.offers : []) {
    const offer = record(entry);
    const workerId = typeof offer.tarotista_worker_id === "string" ? offer.tarotista_worker_id.trim() : "";
    const workerName = typeof offer.tarotista_name === "string" ? offer.tarotista_name.trim() : "";
    const eligibilityKey = typeof offer.eligibility_key === "string" ? offer.eligibility_key.trim() : "";
    if (!UUID_PATTERN.test(workerId) || !workerName || eligibilityKey !== workerId || seen.has(workerId)) continue;
    seen.add(workerId);
    const grantMinutes = typeof offer.grant_minutes === "number" ? offer.grant_minutes : NaN;
    const consumeMinutes = typeof offer.consume_minutes === "number" ? offer.consume_minutes : NaN;
    const eligible = valid && offer.eligible === true && offer.reason == null && consumeMinutes === block?.minutes
      && grantMinutes === block?.minutes;
    offers.push({ workerId, workerName, eligibilityKey, eligible, reason: typeof offer.reason === "string" ? offer.reason : null, grantMinutes, consumeMinutes });
  }
  return {
    rank,
    rankLabel: block?.label || null,
    minutes: valid && block ? block.minutes : 0,
    policyKey,
    offers,
    available: offers.filter(offer => offer.eligible),
    explanation: rankFreeReason(preview.reason || (value == null ? null : !block ? "RANK_NOT_ELIGIBLE" : "NO_ELIGIBLE_SOURCE")),
  };
}

export function rankFreeOfferLabel(preview: ReturnType<typeof rankFreeUsage>) {
  return `${preview.minutes} minutos FREE · ${preview.rankLabel}`;
}
