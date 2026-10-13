type VisualInput = {
  state: string;
  current: number;
  count: number;
  progress: number;
  phaseFrom?: number;
  phaseTo?: number;
};

const bounded = (value: number, low: number, high: number, fallback = low) =>
  Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

type CompletionRecord = {
  id: string;
  estado: string;
  fecha_fin_real?: string | null;
  created_at?: string | null;
};

function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

/** Prefer an actual closing date; creation date and ID make legacy/tied records deterministic. */
export function latestCompletedRitual<T extends CompletionRecord>(history: readonly T[]): T | undefined {
  let latest: T | undefined;
  let latestClosed = -Infinity;
  let latestCreated = -Infinity;
  for (const ritual of history) {
    if (ritual.estado !== "completado") continue;
    const closed = timestamp(ritual.fecha_fin_real);
    const created = timestamp(ritual.created_at);
    if (!latest || closed > latestClosed || (closed === latestClosed && (
      created > latestCreated || (created === latestCreated && ritual.id > latest.id)
    ))) {
      latest = ritual;
      latestClosed = closed;
      latestCreated = created;
    }
  }
  return latest;
}

/** The recorded phase owns the artwork; elapsed time never completes a ritual. */
export function ritualVisualState({ state, current, count, progress, phaseFrom, phaseTo }: VisualInput) {
  if (state === "completado") return { frame: 5, energy: 1 };
  if (state === "pendiente" || state === "cancelado") return { frame: 0, energy: .035 };
  const total = Math.floor(bounded(count, 1, 100));
  const index = Math.floor(bounded(current, 0, total - 1));
  const position = total > 1 ? index / (total - 1) : 0;
  const frame = Math.round(position * 4);
  const from = Number(phaseFrom), to = Number(phaseTo);
  const within = Number.isFinite(from) && Number.isFinite(to) && to > from
    ? bounded((progress - from) / (to - from), 0, 1) : 0;
  // A manual phase override can disagree with progress: only a small glow change is allowed.
  return { frame, energy: Math.min(.88, .08 + position * .72 + within * .07) };
}
