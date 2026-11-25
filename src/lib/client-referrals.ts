export const REFERRALS_CHANGED = "tc-client-referrals-changed";
export type ReferralRewardType = "free_minutes" | "normal_minutes" | "coins" | "oracle" | "roulette" | "rank";
export type ReferralRewardItem = {
  reward_type: ReferralRewardType;
  amount: number; roulette_level: number | null; rank_key: "oro" | "diamante" | null;
  rank_days: number | null;
};
export type ReferralReward = ReferralRewardItem & {
  id: string; title: string; referrals_required: number;
  reward_items?: ReferralRewardItem[] | null;
  enabled: boolean; version: number;
  claimable?: boolean; unavailable_reason?: string | null;
};
export type ReferralAdminClaim = {
  id: string; created_at: string; cliente_id: string; client_name: string;
  client_phone: string | null; reward_id: string; reward_title: string;
  reward_description: string; reward_items: ReferralRewardItem[];
  referrals_used: number; status: "delivered";
};
export type ReferralHistoryQuery = {
  p_query: string | null; p_reward_id: string | null;
  p_from: string | null; p_to: string | null; p_offset: number; p_limit: number;
};
export const MAX_REFERRAL_REWARD_ITEMS = 10;
export type ReferralSummary = { total: number; available: number; claimed: number; pending: number; oracle_credits?: number };
export type ReferralRecord = { id: string; referred_id?: string; name: string; status: "available" | "claimed" | "pending"; created_at: string; claimed_at: string | null; reward_title: string | null; paid_total?: number };
export type ReferralClaim = { id: string; reward_title: string; reward_description: string; created_at: string };
export type ReferralState = { summary: ReferralSummary; rewards: ReferralReward[]; referrals: ReferralRecord[]; claims: ReferralClaim[]; qualification: "purchases_over_10"; claim_mode: "consume" };
export type ReferralSnapshot = ReferralState;

type ReferralRewardLike = Partial<ReferralRewardItem> & { reward_items?: ReferralRewardItem[] | null };

/** Old catalog entries and receipts remain valid as single-item rewards. */
export function referralRewardItems(reward: ReferralRewardLike | null | undefined): ReferralRewardItem[] {
  if (Array.isArray(reward?.reward_items) && reward.reward_items.length) return reward.reward_items;
  if (!reward?.reward_type) return [];
  return [{
    reward_type: reward.reward_type,
    amount: Number(reward.amount ?? 0),
    roulette_level: reward.roulette_level ?? null,
    rank_key: reward.rank_key ?? null,
    rank_days: reward.rank_days ?? null,
  }];
}

export function referralRewardItemDescription(reward: ReferralRewardItem): string {
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
export function referralRewardDescription(reward: ReferralRewardLike | null | undefined): string {
  return referralRewardItems(reward).map(referralRewardItemDescription).join(" + ") || "Premio de referidos";
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
function parseReferralRewardItem(value: unknown, strictRankAmount: boolean): ReferralRewardItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReferralInputError("Revisa los datos de cada recompensa.");
  const r = value as Record<string, unknown>;
  const types: ReferralRewardType[] = ["free_minutes", "normal_minutes", "coins", "oracle", "roulette", "rank"];
  if (!types.includes(r.reward_type as ReferralRewardType)) throw new ReferralInputError("Selecciona un tipo de premio válido.");
  const type = r.reward_type as ReferralRewardType;
  if (type === "rank" && strictRankAmount && r.amount !== 1) throw new ReferralInputError("Un premio puede incluir una sola asignación de rango.");
  const amount = type === "rank" ? 1 : positiveInteger(r.amount, type === "coins" ? 1_000_000 : type === "free_minutes" || type === "normal_minutes" ? 10_000 : 100, "La cantidad debe ser un entero positivo dentro del límite indicado.");
  const rouletteLevel = type === "roulette" ? positiveInteger(r.roulette_level, 5, "Selecciona una ruleta de nivel 1 a 5.") : null;
  const rankKey = type === "rank" ? r.rank_key : null;
  if (type === "rank" && rankKey !== "oro" && rankKey !== "diamante") throw new ReferralInputError("Selecciona el rango Oro o Diamante.");
  const rankDays = type === "rank" ? positiveInteger(r.rank_days, 365, "Indica una duración de 1 a 365 días.") : null;
  return { reward_type: type, amount, roulette_level: rouletteLevel, rank_key: rankKey as "oro" | "diamante" | null, rank_days: rankDays };
}

export function parseReferralReward(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReferralInputError("Revisa los datos del premio.");
  const r = value as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title || title.length > 100) throw new ReferralInputError("Escribe un título de hasta 100 caracteres.");
  if (typeof r.enabled !== "boolean") throw new ReferralInputError("Indica si el premio está activo.");
  const cost = positiveInteger(r.referrals_required, 1000, "Indica entre 1 y 1.000 referidos necesarios.");
  const hasItems = Object.prototype.hasOwnProperty.call(r, "reward_items");
  if (hasItems && (!Array.isArray(r.reward_items) || r.reward_items.length < 1 || r.reward_items.length > MAX_REFERRAL_REWARD_ITEMS)) {
    throw new ReferralInputError(`Añade entre 1 y ${MAX_REFERRAL_REWARD_ITEMS} recompensas al premio.`);
  }
  const items = hasItems
    ? (r.reward_items as unknown[]).map(item => parseReferralRewardItem(item, true))
    : [parseReferralRewardItem(r, false)];
  const keys = new Set<string>();
  for (const item of items) {
    const key = item.reward_type === "roulette" ? `roulette:${item.roulette_level}` : item.reward_type;
    if (keys.has(key)) throw new ReferralInputError("Esta recompensa ya está incluida. Ajusta su cantidad en lugar de repetirla.");
    keys.add(key);
  }
  // Preserve absent reward_items for old admin tabs: the database rejects an
  // outdated single-item editor overwriting a reward that already has a bundle.
  return { title, referrals_required: cost, ...items[0], enabled: r.enabled, ...(hasItems ? { reward_items: items } : {}) };
}

const madridDateParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid", calendar: "iso8601", numberingSystem: "latn",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** Convert a calendar-day boundary, including DST, to an absolute instant. */
function madridMidnightUtc(calendarMidnight: number): string {
  let instant = calendarMidnight;
  for (let pass = 0; pass < 2; pass++) {
    const parts = Object.fromEntries(madridDateParts.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const local = new Date(0);
    local.setUTCFullYear(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    local.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), 0);
    instant -= local.getTime() - calendarMidnight;
  }
  return new Date(instant).toISOString();
}

function referralCalendarDate(value: string | null): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReferralInputError("Selecciona una fecha válida.");
  const stamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value || value.startsWith("0000")) {
    throw new ReferralInputError("Selecciona una fecha válida.");
  }
  return stamp;
}

export function parseReferralHistoryQuery(params: URLSearchParams): ReferralHistoryQuery {
  const query = (params.get("q") || "").trim();
  if (query.length > 200) throw new ReferralInputError("La búsqueda admite hasta 200 caracteres.");
  const rewardId = params.get("reward_id");
  const from = referralCalendarDate(params.get("from"));
  const to = referralCalendarDate(params.get("to"));
  if (from !== null && to !== null && from > to) throw new ReferralInputError("La fecha final debe ser igual o posterior a la inicial.");
  function integerParam(name: string, fallback: number, min: number, max: number) {
    const raw = params.get(name);
    if (raw === null || raw === "") return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new ReferralInputError("Revisa la paginación del historial.");
    }
    return value;
  }
  return {
    p_query: query || null,
    p_reward_id: rewardId ? requireReferralUuid(rewardId) : null,
    p_from: from === null ? null : madridMidnightUtc(from),
    p_to: to === null ? null : madridMidnightUtc(to + 86_400_000),
    p_offset: integerParam("offset", 0, 0, 2_147_483_647),
    p_limit: integerParam("limit", 25, 1, 100),
  };
}
