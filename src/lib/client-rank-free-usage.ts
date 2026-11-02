export type RankFreeUsageRank = "sin_rango" | "bronce" | "plata" | "oro" | "diamante";

export type RankFreeOffer = {
  workerId: string;
  workerName: string;
  eligibilityKey: string;
  eligible: boolean;
  reason: string | null;
  grantMinutes: number;
  consumeMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  usedAt: string | null;
  benefitEventId: string | null;
  callId: string | null;
};

const RANK_FREE_BLOCKS: Record<RankFreeUsageRank, { label: string }> = {
  sin_rango: { label: "Sin rango" },
  bronce: { label: "Bronce" },
  plata: { label: "Plata" },
  oro: { label: "Oro" },
  diamante: { label: "Diamante" },
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
  const minutes = Number(preview.minutes);
  const valid = Boolean(block && Number.isSafeInteger(minutes) && minutes > 0 && minutes <= 60 && policyKey === "new_tarotista_once_v1");
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
    const eligible = valid && offer.eligible === true && offer.reason == null && consumeMinutes === minutes
      && grantMinutes === minutes;
    offers.push({ workerId, workerName, eligibilityKey, eligible, reason: typeof offer.reason === "string" ? offer.reason : null, grantMinutes, consumeMinutes,
      usedMinutes: Math.max(0, Number(offer.used_minutes) || 0),
      remainingMinutes: Math.max(0, Number(offer.remaining_minutes ?? (eligible ? consumeMinutes : 0)) || 0),
      usedAt: typeof offer.used_at === "string" ? offer.used_at : null,
      benefitEventId: typeof offer.benefit_event_id === "string" ? offer.benefit_event_id : null,
      callId: typeof offer.call_id === "string" ? offer.call_id : null,
    });
  }
  return {
    rank,
    rankLabel: block?.label || null,
    minutes: valid ? minutes : 0,
    policyKey,
    offers,
    available: offers.filter(offer => offer.eligible),
    explanation: rankFreeReason(preview.reason || (value == null ? null : !block ? "RANK_NOT_ELIGIBLE" : "NO_ELIGIBLE_SOURCE")),
  };
}

export function rankFreeOfferLabel(preview: ReturnType<typeof rankFreeUsage>) {
  return `${preview.minutes} minutos FREE · ${preview.rankLabel}`;
}
