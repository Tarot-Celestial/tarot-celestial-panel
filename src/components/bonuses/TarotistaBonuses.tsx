"use client";

import {
  CheckCircle2,
  Clock3,
  Coins,
  Crown,
  Gem,
  Lock,
  RefreshCw,
  Sparkles,
  Star,
  Target,
  Trophy,
  TrendingUp,
} from "lucide-react";
import {
  captureTier,
  applicable,
  METRICS,
  type BonusRule,
} from "@/lib/bonuses/engine";
import { euro, useBonuses } from "./useBonuses";
import styles from "./Bonuses.module.css";

const RANK_LABELS: Record<string, string> = {
  captadas: "Captadas",
  cliente: "Cliente",
  repite: "Repite",
};

function formatMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const label = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "Activo durante el periodo";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return `Hasta ${new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed)}`;
}

function clampPct(value: unknown) {
  const number = Number(value || 0);
  return Math.max(0, Math.min(100, Number.isFinite(number) ? number : 0));
}

export default function TarotistaBonuses({
  month,
  compact = false,
}: {
  month: string;
  compact?: boolean;
}) {
  const { data, error, loading, load } = useBonuses(
    `/api/bonuses?month=${encodeURIComponent(month)}`,
  );

  const progress = data?.progress || [];
  const awards = data?.awards || [];
  const hide = Boolean(data?.money_hidden);
  const total = (list: any[]) =>
    hide
      ? null
      : list.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);

  const rules = (data?.rules || []) as BonusRule[];
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const tiers = rules
    .filter((rule) => rule.kind === "tier" && applicable(rule, month))
    .sort((a, b) => a.minimum - b.minimum);

  const count = Number(data?.stats?.captadas_total || 0);
  const tier = captureTier(tiers, count, month);
  const next = tiers.find((rule) => rule.minimum > count);
  const confirmed = awards.filter((award: any) => award.status === "included");
  const challenges = progress
    .filter((item: any) => item.kind === "challenge")
    .sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  const confirmedTotal = total(confirmed);
  const provisionalTotal = total(progress);
  const rankingTotal = total(progress.filter((item: any) => item.kind === "ranking"));

  type PotentialRow = { item: any; rule: BonusRule | undefined; remainingClaims: number; amount: number };
  const potentialRows: PotentialRow[] = challenges.map((item: any) => {
    const rule = ruleById.get(String(item.rule_id));
    const maxClaims = Math.max(1, Number(rule?.max_claims || 1));
    const units = Math.max(0, Number(item.units || 0));
    const remainingClaims = Math.max(0, maxClaims - units);
    return {
      item,
      rule,
      remainingClaims,
      amount: remainingClaims * Number(rule?.reward ?? item.reward ?? 0),
    };
  });

  const stackablePotential = potentialRows
    .filter(({ rule }: PotentialRow) => rule?.stackable !== false)
    .reduce((sum: number, row: PotentialRow) => sum + row.amount, 0);
  const exclusiveRows = potentialRows.filter(({ rule }: PotentialRow) => rule?.stackable === false);
  const exclusiveAlreadyWon = exclusiveRows.some(
    ({ item }: PotentialRow) => Number(item.units || 0) > 0 && !item.suppressed,
  );
  const exclusivePotential = exclusiveAlreadyWon
    ? 0
    : Math.max(0, ...exclusiveRows.map((row: PotentialRow) => row.amount));
  const potentialExtra = hide ? null : stackablePotential + exclusivePotential;

  const visibleGoal = hide
    ? null
    : Number(provisionalTotal || 0) + Number(potentialExtra || 0);
  const economicProgress =
    !hide && Number(visibleGoal || 0) > 0
      ? clampPct((Number(provisionalTotal || 0) / Number(visibleGoal)) * 100)
      : 0;

  const rankingPositions = Object.entries(data?.stats?.positions || {})
    .filter(([, position]) => Number(position) > 0)
    .map(([key, position]) => ({ key, position: Number(position) }))
    .sort((a, b) => a.position - b.position);
  const bestRank = rankingPositions[0] || null;

  const unlocks: Array<{
    id: string;
    title: string;
    condition: string;
    reward: string;
    kind: "tier" | "ranking";
  }> = [];

  for (const futureTier of tiers.filter((rule) => rule.minimum > count)) {
    unlocks.push({
      id: futureTier.id,
      title: futureTier.name,
      condition: `${futureTier.minimum} captadas`,
      reward: `${euro(futureTier.reward)} / captada`,
      kind: "tier",
    });
  }

  for (const rankingRule of rules
    .filter((rule) => rule.kind === "ranking")
    .sort((a, b) => Number(a.position || 999) - Number(b.position || 999))) {
    const current = progress.find((item: any) => item.rule_id === rankingRule.id);
    if (Number(current?.amount || 0) > 0) continue;
    unlocks.push({
      id: rankingRule.id,
      title: rankingRule.name,
      condition: `Puesto #${rankingRule.position} · ${METRICS[rankingRule.metric]}`,
      reward: euro(rankingRule.reward),
      kind: "ranking",
    });
  }

  if (compact) {
    return (
      <section className={styles.shell} aria-busy={loading}>
        <header className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Tarot Celestial · Recompensas</span>
            <h1>Bonos de tu factura</h1>
            <p className={styles.muted}>Captaciones, posiciones y retos · {month}</p>
          </div>
          <button onClick={() => void load()} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </header>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {data && (
          <>
            <div className={styles.summary}>
              <div className={styles.metric}>
                <span>Bonos confirmados del periodo</span>
                <strong>{euro(confirmedTotal)}</strong>
                <small className={styles.muted}>Incluidos en tu factura.</small>
              </div>
              <div className={styles.metric}>
                <span>Estimación del periodo</span>
                <strong>{euro(provisionalTotal)}</strong>
                <small className={styles.muted}>Puede variar hasta la confirmación.</small>
              </div>
              <div className={styles.metric}>
                <span>Ranking provisional</span>
                <strong>{euro(rankingTotal)}</strong>
                <small className={styles.muted}>La posición definitiva se confirma al cierre.</small>
              </div>
            </div>
            <section className={styles.section}>
              <h2>Bonos conseguidos y confirmados</h2>
              <div className={styles.history}>
                {awards.map((award: any) => (
                  <div className={styles.historyItem} key={award.id}>
                    <div>
                      <strong>{award.name}</strong>
                      <small>
                        {new Date(award.created_at).toLocaleDateString("es-ES")} · {award.invoice_month} · {award.status === "void" ? "Anulado" : "Confirmado · incluido en factura"}
                      </small>
                    </div>
                    <strong>{euro(award.amount)}</strong>
                  </div>
                ))}
              </div>
              {!awards.length && (
                <p className={styles.muted}>Todavía no hay bonos confirmados en este periodo.</p>
              )}
            </section>
          </>
        )}
      </section>
    );
  }

  return (
    <section className={`${styles.shell} ${styles.rewardCenter}`} aria-busy={loading}>
      <header className={styles.rewardHero}>
        <div className={styles.rewardHeroCopy}>
          <span className={styles.rewardEyebrow}>
            <Sparkles size={14} aria-hidden="true" /> Centro de recompensas · Tarotista
          </span>
          <h1>Tus bonos y recompensas</h1>
          <p>
            Tu dedicación transforma vidas. Sigue avanzando y este mes puedes ganar aún más.
          </p>
          <div className={styles.periodPill}>
            <Clock3 size={14} aria-hidden="true" />
            <span>Periodo</span>
            <strong>{formatMonth(month)}</strong>
          </div>
        </div>

        <div className={styles.heroRewardArt} aria-hidden="true">
          <span className={styles.heroOrbitOne} />
          <span className={styles.heroOrbitTwo} />
          <div className={styles.heroGem}><Gem size={48} /></div>
          <div className={styles.heroCoin}><Coins size={30} /></div>
          <div className={styles.heroStar}><Star size={24} /></div>
          <small>La intuición también tiene sus recompensas.</small>
        </div>

        <button
          className={styles.rewardRefresh}
          onClick={() => void load()}
          disabled={loading}
          aria-label="Actualizar bonos"
        >
          <RefreshCw size={16} className={loading ? styles.spinning : ""} />
          {loading ? "Actualizando" : "Actualizar"}
        </button>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {!data && loading && (
        <div className={styles.rewardLoading} aria-label="Cargando recompensas">
          <span />
          <span />
          <span />
        </div>
      )}

      {data && (
        <>
          <div className={styles.rewardSummary}>
            <article className={`${styles.rewardKpi} ${styles.rewardKpiGold}`}>
              <div className={styles.rewardKpiIcon}><Coins size={24} /></div>
              <div>
                <span>Ganado este mes</span>
                <strong>{euro(confirmedTotal)}</strong>
                <small>Recompensas ya confirmadas.</small>
              </div>
            </article>

            <article className={`${styles.rewardKpi} ${styles.rewardKpiViolet}`}>
              <div className={styles.rewardKpiIcon}><TrendingUp size={24} /></div>
              <div>
                <span>Estimación del periodo</span>
                <strong>{euro(provisionalTotal)}</strong>
                <small>Puede variar hasta la confirmación.</small>
              </div>
            </article>

            <article className={`${styles.rewardKpi} ${styles.rewardKpiMagenta}`}>
              <div className={styles.rewardKpiIcon}><Star size={24} /></div>
              <div>
                <span>Aún puedes ganar</span>
                <strong>{euro(potentialExtra)}</strong>
                <small>Completando los retos activos pendientes.</small>
              </div>
            </article>
          </div>

          <section className={styles.economicPanel}>
            <div className={styles.economicMain}>
              <div className={styles.sectionTitleRow}>
                <div>
                  <span className={styles.rewardEyebrow}>Progreso económico</span>
                  <h2>Tu progreso este mes</h2>
                </div>
                <div className={styles.progressPercent}>{Math.round(economicProgress)}%</div>
              </div>

              <div className={styles.moneyProgressCopy}>
                <strong>{euro(provisionalTotal)}</strong>
                <span>
                  {!hide && Number(visibleGoal || 0) > 0
                    ? `encaminados de ${euro(visibleGoal)} de potencial visible`
                    : "Progreso calculado con las recompensas visibles del periodo"}
                </span>
              </div>
              <div
                className={styles.bigRewardProgress}
                role="progressbar"
                aria-label="Progreso económico del periodo"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(economicProgress)}
              >
                <span style={{ width: `${economicProgress}%` }} />
              </div>
              <div className={styles.progressFooter}>
                <span>
                  {!hide && Number(potentialExtra || 0) > 0
                    ? `${euro(potentialExtra)} todavía disponibles en retos activos`
                    : "No hay premio adicional pendiente en los retos visibles"}
                </span>
                <small>
                  No incluye premios futuros de ranking o tramos que dependan de resultados aún desconocidos.
                </small>
              </div>
            </div>

            <aside className={styles.rankingPanel}>
              <div className={styles.rankingIcon}><Trophy size={28} /></div>
              <span>Tu posición actual</span>
              {bestRank ? (
                <>
                  <strong>#{bestRank.position}</strong>
                  <p>Mejor posición · {RANK_LABELS[bestRank.key] || bestRank.key}</p>
                </>
              ) : (
                <>
                  <strong>—</strong>
                  <p>Sin posición todavía.</p>
                </>
              )}
              <div className={styles.rankMiniList}>
                {["captadas", "cliente", "repite"].map((key) => (
                  <div key={key}>
                    <span>{RANK_LABELS[key]}</span>
                    <b>{data.stats?.positions?.[key] ? `#${data.stats.positions[key]}` : "—"}</b>
                  </div>
                ))}
              </div>
              <small>La posición definitiva se confirma al cierre.</small>
            </aside>
          </section>

          <section className={styles.challengesSection}>
            <div className={styles.sectionTitleRow}>
              <div>
                <span className={styles.rewardEyebrow}>Misiones del periodo</span>
                <h2>Retos activos</h2>
                <p>Completa tus objetivos y gana premios extra.</p>
              </div>
              <div className={styles.challengeCount}>
                <Target size={16} /> {challenges.length} {challenges.length === 1 ? "reto" : "retos"}
              </div>
            </div>

            {challenges.length ? (
              <div
                className={`${styles.challengeGrid} ${
                  challenges.length === 1
                    ? styles.challengeGridSingle
                    : challenges.length === 2
                      ? styles.challengeGridDouble
                      : ""
                }`}
              >
                {challenges.map((item: any) => {
                  const rule = ruleById.get(String(item.rule_id));
                  const maxClaims = Math.max(1, Number(rule?.max_claims || 1));
                  const units = Math.max(0, Number(item.units || 0));
                  const fullTarget = Math.max(0, Number(item.target || 0)) * maxClaims;
                  const value = Math.max(0, Number(item.value || 0));
                  const fullyReached = maxClaims > 1 ? units >= maxClaims : Boolean(item.reached);
                  const visualProgress = maxClaims > 1 && fullTarget > 0
                    ? clampPct((value / fullTarget) * 100)
                    : clampPct(item.progress);
                  const nextTarget = Number(item.target || 0) * Math.min(maxClaims, units + 1);
                  const remainingToNext = fullyReached
                    ? 0
                    : Math.max(0, nextTarget - value);
                  const almost = !fullyReached && visualProgress >= 80;
                  const stateClass = item.suppressed
                    ? styles.challengeSuppressed
                    : fullyReached
                      ? styles.challengeComplete
                      : almost
                        ? styles.challengeAlmost
                        : styles.challengeActive;
                  const status = item.suppressed
                    ? "No acumulable"
                    : fullyReached
                      ? data.invoice?.bonus_closed_at
                        ? "Periodo cerrado"
                        : "Objetivo alcanzado"
                      : almost
                        ? "Casi logrado"
                        : units > 0
                          ? `Avanzando · ${units}/${maxClaims}`
                          : "En progreso";
                  const metricLabel = METRICS[item.metric as keyof typeof METRICS] || item.metric;

                  return (
                    <article className={`${styles.challengeCard} ${stateClass}`} key={item.rule_id}>
                      <div className={styles.challengeTopRow}>
                        <div className={styles.challengeMissionIdentity}>
                          <div className={styles.challengeIcon}>
                            {fullyReached ? <CheckCircle2 size={23} /> : <Target size={23} />}
                          </div>
                          <span className={styles.challengeMissionLabel}>
                            <Sparkles size={12} /> Misión activa
                          </span>
                        </div>
                        <span className={styles.challengeStatus}>{status}</span>
                      </div>

                      <div className={styles.challengeCopy}>
                        <h3>{item.name}</h3>
                        {item.description && <p>{item.description}</p>}
                      </div>

                      <div className={styles.challengeNumbers}>
                        <div>
                          <strong>{value}</strong>
                          <span>/ {fullTarget || item.target}</span>
                          <small>{metricLabel}</small>
                        </div>
                        <div className={styles.challengeReward}>
                          <span>Recompensa</span>
                          <strong>+ {euro(item.reward)}</strong>
                          {maxClaims > 1 && <small>por logro · máx. {maxClaims}</small>}
                        </div>
                      </div>

                      <div className={styles.challengeProgressWrap}>
                        <div
                          className={styles.challengeProgress}
                          role="progressbar"
                        aria-label={item.name}
                        aria-valuenow={Math.round(visualProgress)}
                        aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <span style={{ width: `${visualProgress}%` }} />
                        </div>
                        <strong className={styles.challengePct}>{Math.round(visualProgress)}%</strong>
                      </div>

                      <div className={styles.challengeFooter}>
                        <strong>
                          {item.suppressed
                            ? "Prevalece otra recompensa no acumulable"
                            : fullyReached
                              ? `✓ ${euro(item.amount)} encaminados en este reto`
                              : remainingToNext > 0
                                ? `Te faltan ${remainingToNext}`
                                : "Sigue avanzando"}
                        </strong>
                        <span><Clock3 size={13} /> {formatShortDate(rule?.end_date)}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyRewards}>
                <Target size={30} />
                <div>
                  <strong>No hay retos activos</strong>
                  <p>Administración todavía no ha configurado objetivos para este periodo.</p>
                </div>
              </div>
            )}
          </section>

          {unlocks.length > 0 && (
            <section className={styles.unlockSection}>
              <div className={styles.sectionTitleRow}>
                <div>
                  <span className={styles.rewardEyebrow}>Próximas metas</span>
                  <h2>Lo que puedes desbloquear</h2>
                  <p>Recompensas reales que ya están configuradas para este periodo.</p>
                </div>
                <Lock size={21} />
              </div>
              <div className={styles.unlockGrid}>
                {unlocks.slice(0, 4).map((unlock) => (
                  <article className={styles.unlockCard} key={unlock.id}>
                    <div className={styles.unlockIcon}>
                      {unlock.kind === "tier" ? <Crown size={21} /> : <Trophy size={21} />}
                    </div>
                    <div>
                      <span>{unlock.kind === "tier" ? "Siguiente tramo" : "Premio de ranking"}</span>
                      <h3>{unlock.title}</h3>
                      <p>{unlock.condition}</p>
                    </div>
                    <strong>{unlock.reward}</strong>
                    <Lock size={15} className={styles.unlockLock} />
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className={styles.secondaryRewardsGrid}>
            <section className={styles.capturePanel}>
              <div className={styles.sectionTitleRow}>
                <div>
                  <span className={styles.rewardEyebrow}>Captaciones</span>
                  <h2>Tu tramo actual</h2>
                </div>
                <div className={styles.captureMedal}><Crown size={22} /></div>
              </div>
              <div className={styles.captureValue}>
                <strong>{count}</strong>
                <span>captadas registradas</span>
              </div>
              <div className={styles.captureRate}>
                <span>Recompensa actual</span>
                <strong>{tier ? `${euro(tier.reward)} / captada` : "Sin tramo activo"}</strong>
              </div>
              {next ? (
                <>
                  <div className={styles.captureNext}>
                    <span>Siguiente tramo</span>
                    <strong>{next.minimum} captadas · {euro(next.reward)} / captada</strong>
                  </div>
                  <div className={styles.challengeProgress}>
                    <span style={{ width: `${clampPct((count / next.minimum) * 100)}%` }} />
                  </div>
                  <small>Te faltan {Math.max(0, next.minimum - count)} captadas para el siguiente tramo.</small>
                </>
              ) : (
                <small>No hay un tramo superior activo en este periodo.</small>
              )}
            </section>

            <section className={styles.currentRankingPanel}>
              <div className={styles.sectionTitleRow}>
                <div>
                  <span className={styles.rewardEyebrow}>Competición</span>
                  <h2>Ranking provisional</h2>
                </div>
                <Trophy size={24} />
              </div>
              <p>Tu posición se calcula con la actividad real del periodo.</p>
              <div className={styles.rankingRows}>
                {["captadas", "cliente", "repite"].map((key) => {
                  const amount = total(
                    progress.filter(
                      (item: any) => item.kind === "ranking" && item.metric === `rank_${key}`,
                    ),
                  );
                  return (
                    <div key={key}>
                      <span>{RANK_LABELS[key]}</span>
                      <b>{data.stats?.positions?.[key] ? `#${data.stats.positions[key]}` : "Sin posición"}</b>
                      <strong>{euro(amount)}</strong>
                    </div>
                  );
                })}
              </div>
              <small>Los empates se ordenan por el identificador estable de tarotista.</small>
            </section>
          </div>



          <section className={styles.confirmedSection}>
            <div className={styles.sectionTitleRow}>
              <div>
                <span className={styles.rewardEyebrow}>Historial del periodo</span>
                <h2>Recompensas confirmadas</h2>
                <p>
                  {data.invoice?.bonus_closed_at
                    ? "El periodo ya está confirmado; las reglas posteriores no cambian sus premios guardados."
                    : "Los objetivos alcanzados se confirman al cerrar el periodo desde Administración."}
                </p>
              </div>
              <div className={styles.confirmedAmount}>
                <span>Total confirmado</span>
                <strong>{euro(confirmedTotal)}</strong>
              </div>
            </div>

            {awards.length ? (
              <div className={styles.confirmedList}>
                {awards.map((award: any) => (
                  <article className={styles.confirmedRow} key={award.id}>
                    <div className={styles.confirmedIcon}>
                      {award.status === "void" ? <Lock size={17} /> : <CheckCircle2 size={17} />}
                    </div>
                    <div>
                      <strong>{award.name}</strong>
                      <small>
                        {new Date(award.created_at).toLocaleDateString("es-ES")} · {award.invoice_month} · {award.status === "void" ? "Anulado" : "Confirmado · incluido en factura"}
                      </small>
                      {award.void_reason && <small>{award.void_reason}</small>}
                    </div>
                    <strong>{euro(award.amount)}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyRewards}>
                <Coins size={28} />
                <div>
                  <strong>Todavía no hay bonos confirmados</strong>
                  <p>Completa retos y objetivos para conseguir tus primeras recompensas del periodo.</p>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
