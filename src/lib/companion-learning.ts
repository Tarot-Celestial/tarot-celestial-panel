/** Pure, evidence-based learning for the private companion. This XP never affects staff XP. */
export type StrategyId = 'recovery_loyal' | 'recovery_recent' | 'followup_due' | 'incident_pending';
export type LearningState = 'suggested' | 'trying' | 'observed' | 'no_result' | 'dismissed' | 'invalidated';
export type LearningEvidence = { id: string; kind: string; occurredAt: string; detail: string };

export type LearningEpisode = {
  id: string;
  worker_id: string;
  source_key: string;
  source_id: string;
  client_id: string | null;
  strategy: StrategyId;
  title: string;
  reason: string;
  expected_outcome: string;
  baseline: Record<string, unknown>;
  state: LearningState;
  created_at: string;
  updated_at: string;
  tried_at: string | null;
  deadline_at: string | null;
  resolved_at: string | null;
  evidence: LearningEvidence | null;
  feedback: 'helpful' | 'not_helpful' | null;
  feedback_note: string | null;
  feedback_at: string | null;
};

export type LearningCardRef = {
  episodeId: string;
  strategy: StrategyId;
  reason: string;
  expectedOutcome: string;
  /** Keep in the manual briefing, but do not initiate another automatic suggestion. */
  quiet?: boolean;
};

export type LearningLesson = {
  strategy: StrategyId;
  label: string;
  attempts: number;
  observed: number;
  noResult: number;
  helpful: number;
  notHelpful: number;
  confidence: 'initial' | 'emerging' | 'supported';
  adjustment: number;
  explanation: string;
  nextStep: string;
};

export type LearningSummary = {
  level: number;
  title: string;
  xp: number;
  /** XP earned within this level, and the XP required to complete this level. */
  levelXp: number;
  nextLevelXp: number;
  /** Percentage, 0 through 100. */
  progress: number;
  observedCount: number;
  feedbackCount: number;
  tryingCount: number;
  lessons: LearningLesson[];
  recent: LearningEpisode[];
};

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  recovery_loyal: 'Recuperar clientas habituales',
  recovery_recent: 'Retomar clientas recientes',
  followup_due: 'Resolver seguimientos pendientes',
  incident_pending: 'Resolver incidencias pendientes',
};

const STRATEGIES = Object.keys(STRATEGY_LABELS) as StrategyId[];
const DAY_MS = 24 * 60 * 60 * 1000;
const LEARNING_WINDOW_MS = 90 * DAY_MS;
const madridDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
});
const STATE_ORDER: Record<LearningState, number> = {
  suggested: 0, trying: 1, no_result: 2, observed: 3, dismissed: 4, invalidated: 5,
};

function time(value: unknown): number {
  // Reject timezone-free values: every observation must identify one real instant.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function uniqueEpisodes(episodes: readonly LearningEpisode[], nowMs: number): LearningEpisode[] {
  const unique = new Map<string, LearningEpisode>();
  for (const episode of episodes) {
    if (!episode || !nonempty(episode.id) || !STRATEGIES.includes(episode.strategy) || !Object.hasOwn(STATE_ORDER, episode.state)) continue;
    const created = time(episode.created_at), updated = time(episode.updated_at);
    if (!Number.isFinite(created) || !Number.isFinite(updated) || created > nowMs || updated < created || updated > nowMs) continue;
    const existing = unique.get(episode.id);
    if (!existing || updated > time(existing.updated_at)
      || (updated === time(existing.updated_at) && (STATE_ORDER[episode.state] > STATE_ORDER[existing.state]
        || (episode.state === existing.state && compareText(canonical(episode), canonical(existing)) > 0)))) unique.set(episode.id, episode);
  }
  return [...unique.values()];
}

function validAttempt(episode: LearningEpisode, nowMs: number): boolean {
  const tried = time(episode.tried_at), deadline = time(episode.deadline_at);
  return Number.isFinite(tried) && Number.isFinite(deadline)
    && tried >= time(episode.created_at) && tried <= nowMs && deadline > tried;
}

function validOutcome(episode: LearningEpisode, nowMs: number): boolean {
  if (!validAttempt(episode, nowMs)) return false;
  const resolved = time(episode.resolved_at), tried = time(episode.tried_at), deadline = time(episode.deadline_at);
  if (!Number.isFinite(resolved) || resolved < tried || resolved > nowMs) return false;
  if (episode.state === 'no_result') {
    // Missing permissions or an unavailable data source must never be interpreted as failure.
    return episode.baseline?.observation_complete === true && resolved >= deadline && deadline <= nowMs;
  }
  if (episode.state !== 'observed' || !episode.evidence) return false;
  const evidence = episode.evidence, occurred = time(evidence.occurredAt);
  return nonempty(evidence.id) && nonempty(evidence.kind) && nonempty(evidence.detail)
    && Number.isFinite(occurred) && occurred >= tried && occurred <= deadline && occurred <= resolved;
}

function validFeedback(episode: LearningEpisode, nowMs: number): boolean {
  const at = time(episode.feedback_at);
  return episode.state !== 'invalidated' && (episode.feedback === 'helpful' || episode.feedback === 'not_helpful')
    && Number.isFinite(at) && at >= time(episode.created_at) && at <= nowMs;
}

function verifiedOutcomes(episodes: readonly LearningEpisode[], nowMs: number): LearningEpisode[] {
  const outcomes = episodes.filter(episode => validOutcome(episode, nowMs));
  // Defense against corrupt imports: one underlying event cannot farm several missions.
  // Keep its earliest persisted observation, matching the database's unique evidence claim.
  const observed = outcomes.filter(episode => episode.state === 'observed')
    .sort((a, b) => time(a.resolved_at) - time(b.resolved_at) || time(a.tried_at) - time(b.tried_at) || compareText(a.id, b.id));
  const seen = new Set<string>();
  const distinct = observed.filter(episode => {
    const key = JSON.stringify([episode.worker_id, episode.evidence!.kind, episode.evidence!.id]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...distinct, ...outcomes.filter(episode => episode.state === 'no_result')];
}

function lessonFor(strategy: StrategyId, episodes: readonly LearningEpisode[], verified: readonly LearningEpisode[], nowMs: number): LearningLesson {
  const since = nowMs - LEARNING_WINDOW_MS;
  const rows = episodes.filter(episode => episode.strategy === strategy && episode.state !== 'invalidated');
  const outcomes = verified.filter(episode => episode.strategy === strategy && time(episode.resolved_at) >= since);
  const ratings = rows.filter(episode => time(episode.feedback_at) >= since && validFeedback(episode, nowMs));
  const observed = outcomes.filter(episode => episode.state === 'observed').length;
  const noResult = outcomes.length - observed;
  const helpful = ratings.filter(episode => episode.feedback === 'helpful').length;
  const notHelpful = ratings.length - helpful;
  const attempts = outcomes.length;
  // A small symmetric prior prevents a handful of outcomes from dominating recovery order.
  const outcomeAdjustment = attempts >= 5 ? ((observed + 2) / (attempts + 4) - 0.5) * 0.4 : 0;
  // Feedback can reduce nuisance, but positive ratings alone never boost sales predictions.
  const nuisanceReduction = ratings.length >= 3 ? Math.max(0, notHelpful / ratings.length - 0.5) * 0.3 : 0;
  const adjustment = Math.max(-0.2, Math.min(0.2, outcomeAdjustment - nuisanceReduction));
  const confidence: LearningLesson['confidence'] = attempts >= 20 ? 'supported' : attempts >= 5 ? 'emerging' : 'initial';
  let nextStep = 'Seguir observando resultados antes de cambiar la prioridad.';
  if (nuisanceReduction > 0) nextStep = 'Reducir estas sugerencias y revisar el momento o el motivo contigo.';
  else if (adjustment > 0) nextStep = strategy.startsWith('recovery_') ? 'Dar algo más de prioridad a esta estrategia y seguir comprobando resultados.' : 'Mantener esta ayuda y comprobar los resultados sin desplazar avisos urgentes.';
  else if (adjustment < 0) nextStep = 'Probar otro momento o enfoque antes de repetir esta estrategia.';
  return {
    strategy, label: STRATEGY_LABELS[strategy], attempts, observed, noResult, helpful, notHelpful, confidence, adjustment,
    explanation: attempts
      ? `En los últimos 90 días: ${observed} cambios posteriores observados y ${noResult} intentos sin cambio dentro del plazo. La coincidencia temporal no demuestra que la sugerencia causara el resultado.`
      : 'Todavía no hay observaciones completas en los últimos 90 días. Un intento pendiente o sin datos suficientes no cuenta como resultado negativo.',
    nextStep,
  };
}

/** Conservative additive ranking adjustment; safe for a missing or malformed lesson. */
export function strategyAdjustment(strategy: StrategyId, lessons: readonly LearningLesson[]): number {
  const adjustment = lessons.find(lesson => lesson.strategy === strategy)?.adjustment;
  return typeof adjustment === 'number' && Number.isFinite(adjustment) ? Math.max(-0.2, Math.min(0.2, adjustment)) : 0;
}

/** Recompute from persisted events; refreshing, clicking, or reordering inputs never farms XP. */
export function buildLearningSummary(episodes: readonly LearningEpisode[], nowMs = Date.now()): LearningSummary {
  if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be a finite timestamp');
  const rows = uniqueEpisodes(episodes, nowMs);
  const outcomes = verifiedOutcomes(rows, nowMs);
  const observations = outcomes.filter(episode => episode.state === 'observed');
  const ratings = rows.filter(episode => validFeedback(episode, nowMs));
  const dailyXp = new Map<string, number>();
  const earn = (at: string, amount: number) => {
    const day = madridDate.format(time(at));
    dailyXp.set(day, Math.min(100, (dailyXp.get(day) ?? 0) + amount));
  };
  for (const episode of observations) earn(episode.resolved_at!, 20);
  for (const episode of ratings) earn(episode.feedback_at!, 5);
  const xp = [...dailyXp.values()].reduce((total, value) => total + value, 0);
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const floor = 100 * (level - 1) ** 2;
  const nextLevelXp = 100 * level ** 2 - floor;
  const levelXp = xp - floor;
  const titles = ['Aprendiz celestial', 'Observador curioso', 'Explorador atento', 'Estratega en formación', 'Guardián de aprendizajes'];
  return {
    level, title: titles[Math.min(level - 1, titles.length - 1)], xp, levelXp, nextLevelXp,
    progress: levelXp / nextLevelXp * 100,
    observedCount: observations.length,
    feedbackCount: ratings.length,
    tryingCount: rows.filter(episode => episode.state === 'trying' && validAttempt(episode, nowMs)).length,
    lessons: STRATEGIES.map(strategy => lessonFor(strategy, rows, outcomes, nowMs)),
    recent: [...rows].sort((a, b) => time(b.updated_at) - time(a.updated_at) || compareText(a.id, b.id)).slice(0, 20),
  };
}
