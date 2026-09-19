"use client";

import {
  ArrowRight,
  Check,
  Crown,
  LockKeyhole,
  Shield,
  Sparkles,
  Target,
  Trophy,
  TrendingUp,
} from "lucide-react";
import styles from "./TarotistaRanksPanel.module.css";

type RankCode = "C" | "B" | "A" | "S";

type RankConfig = {
  code: RankCode;
  name: string;
  subtitle: string;
  description?: string | null;
  min_cliente_pct: number | null;
  requirement_label: string;
  benefits: string[];
  sort_order: number;
};

type RankState = {
  current: RankConfig;
  next: RankConfig | null;
  pct_cliente: number;
  progress_to_next: number | null;
  remaining_to_next: number | null;
  max_reached: boolean;
};

const RANK_ORDER: RankCode[] = ["C", "B", "A", "S"];

const FALLBACK_RANKS: RankConfig[] = [
  { code: "C", name: "Rango C", subtitle: "Inicio del camino", description: "Nivel inicial.", min_cliente_pct: null, requirement_label: "Requisito pendiente de configurar", benefits: [], sort_order: 1 },
  { code: "B", name: "Rango B", subtitle: "Crecimiento", description: "Crecimiento profesional.", min_cliente_pct: 0, requirement_label: "Hasta 25 % de minutos con código Cliente", benefits: [], sort_order: 2 },
  { code: "A", name: "Rango A", subtitle: "Rendimiento destacado", description: "Rendimiento destacado.", min_cliente_pct: 25.000001, requirement_label: "Más de 25 % de minutos con código Cliente", benefits: [], sort_order: 3 },
  { code: "S", name: "Rango S", subtitle: "Élite profesional", description: "Élite profesional.", min_cliente_pct: null, requirement_label: "Requisito pendiente de configurar", benefits: [], sort_order: 4 },
];

function safePct(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function normalizeRank(value: unknown): RankCode {
  const code = String(value || "B").toUpperCase();
  return RANK_ORDER.includes(code as RankCode) ? (code as RankCode) : "B";
}

function buildFallbackState(stats: any, ranks: RankConfig[]): RankState {
  const pct = safePct(stats?.pct_cliente);
  const currentCode = normalizeRank(stats?.tarotista_rango);
  const current = ranks.find((row) => row.code === currentCode) || ranks[1] || FALLBACK_RANKS[1];
  const index = Math.max(0, ranks.findIndex((row) => row.code === current.code));
  const next = index < ranks.length - 1 ? ranks[index + 1] : null;
  if (!next || next.min_cliente_pct === null || current.min_cliente_pct === null) {
    return { current, next, pct_cliente: pct, progress_to_next: current.code === "S" ? 100 : null, remaining_to_next: null, max_reached: current.code === "S" };
  }
  const from = Number(current.min_cliente_pct);
  const to = Number(next.min_cliente_pct);
  const span = Math.max(0.000001, to - from);
  return {
    current,
    next,
    pct_cliente: pct,
    progress_to_next: Math.max(0, Math.min(100, ((pct - from) / span) * 100)),
    remaining_to_next: Math.max(0, to - pct),
    max_reached: current.code === "S",
  };
}

function rankStatus(rank: RankConfig, current: RankCode) {
  if (rank.code === current) return "current";
  if (rank.min_cliente_pct === null) return "unconfigured";
  const idx = RANK_ORDER.indexOf(rank.code);
  const currentIdx = RANK_ORDER.indexOf(current);
  if (idx < currentIdx) return "completed";
  return "locked";
}

function RankEmblem({ code, large = false }: { code: RankCode; large?: boolean }) {
  return (
    <div className={`${styles.emblem} ${large ? styles.emblemLarge : ""}`} data-rank={code} aria-label={`Insignia Rango ${code}`}>
      <Shield size={large ? 52 : 34} strokeWidth={1.45} />
      <strong>{code}</strong>
      {code === "S" ? <Crown className={styles.crown} size={large ? 22 : 16} /> : null}
    </div>
  );
}

export default function TarotistaRanksPanel({ stats, month, onOpenRanking }: { stats: any; month: string; onOpenRanking: () => void }) {
  const configuredRanks: RankConfig[] = Array.isArray(stats?.tarotista_rangos_config) && stats.tarotista_rangos_config.length
    ? RANK_ORDER.map((code) => stats.tarotista_rangos_config.find((row: any) => String(row?.code || "").toUpperCase() === code) || FALLBACK_RANKS.find((row) => row.code === code)!)
    : FALLBACK_RANKS;

  const serverState = stats?.tarotista_rango_state as RankState | undefined;
  const state = serverState?.current ? serverState : buildFallbackState(stats, configuredRanks);
  const currentCode = normalizeRank(state.current?.code || stats?.tarotista_rango);
  const currentRank = configuredRanks.find((row) => row.code === currentCode) || state.current || configuredRanks[1];
  const nextRank = state.next ? configuredRanks.find((row) => row.code === state.next?.code) || state.next : null;
  const pctCliente = safePct(state.pct_cliente ?? stats?.pct_cliente);
  const progress = state.progress_to_next == null ? null : safePct(state.progress_to_next);
  const remaining = state.remaining_to_next == null ? null : Math.max(0, Number(state.remaining_to_next || 0));
  const position = Number(stats?.tarotista_rango_position || 0) || null;
  const totalCompared = Math.max(0, Number(stats?.tarotista_rango_total || 0));
  const maxReached = Boolean(state.max_reached || currentCode === "S");

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}><Sparkles size={14} /> Evolución profesional</span>
          <h2>Tu evolución como tarotista</h2>
          <p>Cuanto más conectas, más creces. Cada rango te acerca a nuevos beneficios.</p>
        </div>
        <span className={styles.period}>Periodo {month}</span>
      </header>

      <section className={styles.hero} data-rank={currentCode}>
        <div className={styles.heroGlow} />
        <div className={styles.heroIdentity}>
          <RankEmblem code={currentCode} large />
          <div>
            <span className={styles.heroLabel}>Tu rango actual</span>
            <h3>Rango {currentCode}</h3>
            <strong>{currentRank.subtitle}</strong>
            <p>{currentRank.description || "Categoría calculada con tus datos reales del periodo."}</p>
          </div>
        </div>

        <div className={styles.heroProgress}>
          <div className={styles.progressHeading}>
            <div>
              <span>{maxReached ? "Rango máximo" : nextRank ? `Progreso hacia Rango ${nextRank.code}` : "Próximo rango"}</span>
              <strong>{progress == null ? "—" : `${progress.toFixed(1)} %`}</strong>
            </div>
            <div className={styles.metricBadge}>
              <small>% Cliente real</small>
              <b>{pctCliente.toFixed(2)} %</b>
            </div>
          </div>

          <div className={styles.progressTrack} data-unconfigured={progress == null ? "true" : "false"}>
            <span style={{ width: `${progress ?? 0}%` }} />
          </div>

          <div className={styles.progressFoot}>
            {maxReached ? (
              <><Crown size={16} /> Has alcanzado el rango máximo.</>
            ) : progress == null ? (
              <><LockKeyhole size={16} /> El requisito del siguiente rango todavía no está configurado.</>
            ) : (
              <><Target size={16} /> {progress.toFixed(1)} % completado · Te faltan {remaining?.toFixed(2)} puntos de % Cliente.</>
            )}
          </div>
        </div>
      </section>

      <section className={styles.ranksSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span>Todos los rangos</span>
            <h3>Tu camino de progresión</h3>
            <p>Conoce lo que necesita cada rango y los beneficios que estén realmente configurados.</p>
          </div>
        </div>

        <div className={styles.rankGrid}>
          {configuredRanks.map((rank) => {
            const status = rankStatus(rank, currentCode);
            return (
              <article key={rank.code} className={styles.rankCard} data-rank={rank.code} data-status={status}>
                <div className={styles.rankCardTop}>
                  <RankEmblem code={rank.code} />
                  <div className={styles.rankStatus}>
                    {status === "current" ? "TU RANGO" : status === "completed" ? "COMPLETADO" : status === "unconfigured" ? "POR CONFIGURAR" : "SIGUIENTE"}
                  </div>
                </div>
                <span className={styles.rankName}>Rango {rank.code}</span>
                <h4>{rank.subtitle}</h4>
                <p>{rank.description}</p>

                <div className={styles.cardBlock}>
                  <span>Requisito</span>
                  <strong>{rank.requirement_label || "Pendiente de configurar"}</strong>
                </div>

                <div className={styles.cardBlock}>
                  <span>Beneficios</span>
                  {Array.isArray(rank.benefits) && rank.benefits.length ? (
                    <ul className={styles.benefitList}>
                      {rank.benefits.map((benefit) => <li key={benefit}><Check size={14} /> {benefit}</li>)}
                    </ul>
                  ) : (
                    <div className={styles.emptyBenefits}>Sin beneficios configurados todavía.</div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.infoCard}>
          <div className={styles.infoIcon}><Trophy size={22} /></div>
          <span>Tu posición actual</span>
          <strong className={styles.position}>{position ? `#${position}` : "—"}</strong>
          <p>{totalCompared > 0 ? `Entre ${totalCompared} tarotistas comparadas con datos reales del periodo.` : "Aún no hay suficiente actividad para comparar."}</p>
          <button type="button" onClick={onOpenRanking}>Ver ranking completo <ArrowRight size={15} /></button>
        </article>

        <article className={styles.infoCard}>
          <div className={styles.infoIcon}><TrendingUp size={22} /></div>
          <span>Cómo mejorar tu rango</span>
          <h4>Más porcentaje Cliente</h4>
          <ol className={styles.steps}>
            <li>Registra correctamente los minutos válidos con código Cliente.</li>
            <li>Mantén actividad real durante el periodo seleccionado.</li>
            <li>El porcentaje se recalcula desde Rendimiento, no desde valores manuales.</li>
          </ol>
        </article>

        <article className={`${styles.infoCard} ${styles.nextCard}`} data-rank={nextRank?.code || currentCode}>
          <div className={styles.infoIcon}>{maxReached ? <Crown size={22} /> : <Target size={22} />}</div>
          <span>{maxReached ? "Rango máximo alcanzado" : nextRank ? `Próximo objetivo · Rango ${nextRank.code}` : "Próximo objetivo"}</span>
          <h4>{maxReached ? "Élite profesional" : nextRank?.subtitle || "Pendiente de configurar"}</h4>
          {maxReached ? (
            <p>Has alcanzado el último rango del sistema.</p>
          ) : (
            <>
              <p><b>Requisito:</b> {nextRank?.requirement_label || "Pendiente de configurar"}</p>
              {remaining != null ? <p><b>Te falta:</b> {remaining.toFixed(2)} puntos de % Cliente.</p> : null}
              <div className={styles.nextBenefits}>
                <b>Beneficios al desbloquear</b>
                {nextRank?.benefits?.length ? nextRank.benefits.map((benefit) => <span key={benefit}>✦ {benefit}</span>) : <span>Sin beneficios configurados todavía.</span>}
              </div>
            </>
          )}
        </article>
      </section>
    </div>
  );
}
