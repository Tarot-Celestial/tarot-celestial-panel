import type { RouletteLevel, RouletteReward, RouletteSummary } from "./ruleta";

export type PendingRouletteSpin = { spin_id: string; level: RouletteLevel };
export type PendingRouletteSpins = Partial<Record<RouletteLevel, PendingRouletteSpin>>;
export const ROULETTE_PENDING_CHANGED = "tc-roulette-pending-changed";
export const roulettePendingKey = (clientId: string) => "tc-ruleta-pending:" + clientId;
const levels = [1, 2, 3, 4, 5] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validRouletteSpinId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function validPending(value: unknown): value is PendingRouletteSpin {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PendingRouletteSpin;
  return validRouletteSpinId(candidate.spin_id) && levels.includes(candidate.level);
}

/** Accept the former single pending operation without discarding its exact ID. */
export function parseRoulettePending(value: unknown): PendingRouletteSpins {
  if (validPending(value)) return { [value.level]: { spin_id: value.spin_id, level: value.level } };
  if (!value || typeof value !== "object") return {};
  const saved = value as { version?: unknown; spins?: PendingRouletteSpins };
  if (saved.version !== 2 || !saved.spins || typeof saved.spins !== "object") return {};
  const result: PendingRouletteSpins = {};
  for (const level of levels) {
    const spin = saved.spins[level];
    if (validPending(spin) && spin.level === level) result[level] = { spin_id: spin.spin_id, level };
  }
  return result;
}

export function readRoulettePending(clientId: string): PendingRouletteSpins {
  try {
    return parseRoulettePending(JSON.parse(sessionStorage.getItem(roulettePendingKey(clientId)) || "null"));
  } catch { return {}; }
}

export function writeRoulettePending(clientId: string, spins: PendingRouletteSpins): void {
  const checked = parseRoulettePending({ version: 2, spins });
  try {
    if (Object.keys(checked).length) sessionStorage.setItem(roulettePendingKey(clientId), JSON.stringify({ version: 2, spins: checked }));
    else sessionStorage.removeItem(roulettePendingKey(clientId));
  } catch { /* Keep the component's in-memory recovery when browser storage is unavailable. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ROULETTE_PENDING_CHANGED, { detail: { clientId } }));
}

export function clearRoulettePending(spins: PendingRouletteSpins, completed: PendingRouletteSpin): PendingRouletteSpins {
  if (spins[completed.level]?.spin_id !== completed.spin_id) return spins;
  const next = { ...spins };
  delete next[completed.level];
  return next;
}

/** An HTTP 200 alone does not prove that this particular spin was credited. */
export function confirmedRouletteReward(value: unknown, request: PendingRouletteSpin, clientId: string): value is RouletteReward & RouletteSummary {
  if (!value || typeof value !== "object") return false;
  const response = value as RouletteReward & RouletteSummary & { ok?: boolean };
  return response.ok === true && response.cliente_id === clientId && response.spin_id === request.spin_id && response.spin_level === request.level &&
    typeof response.reward_id === "string" && response.reward_id.length > 0 &&
    ["minutes", "coins", "oracle_credits", "rank", "ritual", "streak_minutes", "perk"].includes(response.reward_type) &&
    typeof response.reward_value === "number" && Number.isFinite(response.reward_value) && response.reward_value >= 0 &&
    Array.isArray(response.catalogue) && levels.every(level => {
      const count = response[`level_${level}_spins`];
      const next = response[`next_spin_${level}`];
      // The supported legacy RPC only returns levels 1–3. The requested level must always be complete.
      if (count === undefined && next === undefined && level !== request.level) return true;
      return typeof count === "number" && Number.isInteger(count) && count >= 0 && (next === null || validRouletteSpinId(next));
    }) && (!(response.reward_type === "coins" || response.reward_type === "minutes") ||
      (typeof response.balance_before === "number" && Number.isFinite(response.balance_before) &&
       typeof response.balance_after === "number" && Number.isFinite(response.balance_after)));
}
