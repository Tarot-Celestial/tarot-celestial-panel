"use client";

import {
  ArrowRight,
  BadgeEuro,
  Check,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  Crown,
  Gem,
  HeartPulse,
  LockKeyhole,
  MoonStar,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Trophy,
  TrendingUp,
  UserRoundCheck,
} from "lucide-react";
import styles from "./TarotistaRanksPanel.module.css";

type RankCode = "C" | "B" | "A" | "S";

type Requirements = {
  min_minutes_total: number | null;
  min_minutes_cliente: number | null;
  min_minutes_repite: number | null;
  min_cliente_pct: number | null;
  min_repite_pct: number | null;
  min_captadas: number | null;
};

type BenefitConfig = {
  cliente_rate_bonus: number;
  repite_rate_bonus: number;
  health_bonus: number;
  rank_bonus: number;
  extras: string[];
};

type RankConfig = {
  code: RankCode;
  name: string;
  subtitle: string;
  description?: string | null;
  min_cliente_pct: number | null;
  requirement_label: string;
  benefits: string[];
  requirements?: Requirements;
  benefit_config?: BenefitConfig;
  professional_mode?: boolean;
  sort_order: number;
};

type RequirementProgress = {
  key: keyof Requirements;
  label: string;
  current: number;
  target: number;
  unit: "min" | "%" | "clientes";
  met: boolean;
  progress: number;
  remaining: number;
};

type RankProgress = {
  configured: boolean;
  eligible: boolean;
  progress: number | null;
  requirements: RequirementProgress[];
};

type RankState = {
  current: RankConfig;
  next: RankConfig | null;
  metrics?: {
    minutes_total: number;
    minutes_cliente: number;
    minutes_repite: number;
    pct_cliente: number;
    pct_repite: number;
    captadas_total: number;
  };
  pct_cliente: number;
  progress_to_next: number | null;
  remaining_to_next: number | null;
  max_reached: boolean;
  rank_progress?: Partial<Record<RankCode, RankProgress>>;
  next_requirements?: RequirementProgress[];
};

const RANK_ORDER: RankCode[] = ["C", "B", "A", "S"];
const EMPTY_REQ: Requirements = { min_minutes_total: null, min_minutes_cliente: null, min_minutes_repite: null, min_cliente_pct: null, min_repite_pct: null, min_captadas: null };
const EMPTY_BEN: BenefitConfig = { cliente_rate_bonus: 0, repite_rate_bonus: 0, health_bonus: 0, rank_bonus: 0, extras: [] };

const FALLBACK_RANKS: RankConfig[] = [
  { code: "C", name: "Rango C", subtitle: "Iniciado del Arcano", description: "El primer sello del camino profesional.", min_cliente_pct: null, requirement_label: "Rango de entrada", benefits: [], requirements: { ...EMPTY_REQ }, benefit_config: { ...EMPTY_BEN }, sort_order: 1 },
  { code: "B", name: "Rango B", subtitle: "Guardián del Oráculo", description: "Constancia, conexión y crecimiento.", min_cliente_pct: 0, requirement_label: "Crecimiento profesional", benefits: [], requirements: { ...EMPTY_REQ, min_cliente_pct: 0 }, benefit_config: { ...EMPTY_BEN }, sort_order: 2 },
  { code: "A", name: "Rango A", subtitle: "Maestra del Destino", description: "Rendimiento destacado y fidelización sólida.", min_cliente_pct: 25.000001, requirement_label: "Más de 25 % Cliente", benefits: [], requirements: { ...EMPTY_REQ, min_cliente_pct: 25.000001 }, benefit_config: { ...EMPTY_BEN }, sort_order: 3 },
  { code: "S", name: "Rango S", subtitle: "Oráculo Supremo", description: "La cima del camino profesional.", min_cliente_pct: null, requirement_label: "Pendiente de configurar", benefits: [], requirements: { ...EMPTY_REQ }, benefit_config: { ...EMPTY_BEN }, sort_order: 4 },
];

function safe(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function safePct(value: unknown) {
  return Math.min(100, safe(value));
}

function normalizeRank(value: unknown): RankCode {
  const code = String(value || "C").toUpperCase();
  return RANK_ORDER.includes(code as RankCode) ? code as RankCode : "C";
}

function formatMetric(value: number, unit: RequirementProgress["unit"]) {
  if (unit === "%") return `${value.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;
  if (unit === "clientes") return `${Math.round(value).toLocaleString("es-ES")} clientes`;
  return `${value.toLocaleString("es-ES", { maximumFractionDigits: 1 })} min`;
}

function RankEmblem({ code, large = false }: { code: RankCode; large?: boolean }) {
  const Icon = code === "C" ? MoonStar : code === "B" ? ShieldCheck : code === "A" ? Gem : Crown;
  return (
    <div className={`${styles.emblem} ${large ? styles.emblemLarge : ""}`} data-rank={code} aria-label={`Insignia Rango ${code}`}>
      <span className={styles.orbitOne}/><span className={styles.orbitTwo}/>
      <Icon className={styles.emblemIcon} size={large ? 48 : 30} strokeWidth={1.35}/>
      <strong>{code}</strong>
      <i className={styles.emblemSpark}>✦</i>
    </div>
  );
}

function rankStatus(rank: RankConfig, current: RankCode, progress?: RankProgress) {
  if (rank.code === current) return "current";
  const idx = RANK_ORDER.indexOf(rank.code);
  const currentIdx = RANK_ORDER.indexOf(current);
  if (idx < currentIdx) return "completed";
  if (progress && !progress.configured) return "unconfigured";
  return "locked";
}

function BenefitList({ rank }: { rank: RankConfig }) {
  const benefit = { ...EMPTY_BEN, ...(rank.benefit_config || {}) };
  const rows: Array<{ icon: any; text: string }> = [];
  if (benefit.cliente_rate_bonus > 0) rows.push({ icon: CircleDollarSign, text: `+${benefit.cliente_rate_bonus.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/min Cliente` });
  if (benefit.repite_rate_bonus > 0) rows.push({ icon: Repeat2, text: `+${benefit.repite_rate_bonus.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/min Repite` });
  if (benefit.health_bonus > 0) rows.push({ icon: HeartPulse, text: `Bono de salud ${benefit.health_bonus.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}` });
  if (benefit.rank_bonus > 0) rows.push({ icon: BadgeEuro, text: `Bono de rango ${benefit.rank_bonus.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}` });
  for (const extra of benefit.extras || []) rows.push({ icon: Sparkles, text: extra });
  if (!rows.length && rank.benefits?.length) for (const legacy of rank.benefits) rows.push({ icon: Check, text: legacy });

  if (!rows.length) return <div className={styles.emptyBenefits}>Sin beneficios configurados todavía.</div>;
  return <ul className={styles.benefitList}>{rows.map(({ icon: Icon, text }, index) => <li key={`${text}-${index}`}><Icon size={13}/><span>{text}</span></li>)}</ul>;
}

export default function TarotistaRanksPanel({ stats, month, onOpenRanking }: { stats: any; month: string; onOpenRanking: () => void }) {
  const configuredRanks: RankConfig[] = Array.isArray(stats?.tarotista_rangos_config) && stats.tarotista_rangos_config.length
    ? RANK_ORDER.map((code) => stats.tarotista_rangos_config.find((row: any) => String(row?.code || "").toUpperCase() === code) || FALLBACK_RANKS.find((row) => row.code === code)!)
    : FALLBACK_RANKS;

  const serverState = stats?.tarotista_rango_state as RankState | undefined;
  const currentCode = normalizeRank(serverState?.current?.code || stats?.tarotista_rango);
  const currentRank = configuredRanks.find((row) => row.code === currentCode) || FALLBACK_RANKS[0];
  const currentIndex = Math.max(0, RANK_ORDER.indexOf(currentCode));
  const nextRank = serverState?.next
    ? configuredRanks.find((row) => row.code === serverState.next?.code) || serverState.next
    : currentIndex < configuredRanks.length - 1 ? configuredRanks[currentIndex + 1] : null;
  const progress = serverState?.progress_to_next == null ? null : safePct(serverState.progress_to_next);
  const nextRequirements = Array.isArray(serverState?.next_requirements) ? serverState!.next_requirements! : [];
  const position = Number(stats?.tarotista_rango_position || 0) || null;
  const totalCompared = Math.max(0, Number(stats?.tarotista_rango_total || 0));
  const maxReached = Boolean(serverState?.max_reached || currentCode === "S");
  const metrics = {
    minutes_total: safe(serverState?.metrics?.minutes_total ?? stats?.minutes_total),
    minutes_cliente: safe(serverState?.metrics?.minutes_cliente ?? stats?.minutes_cliente),
    minutes_repite: safe(serverState?.metrics?.minutes_repite ?? stats?.minutes_repite),
    pct_cliente: safePct(serverState?.metrics?.pct_cliente ?? stats?.pct_cliente),
    pct_repite: safePct(serverState?.metrics?.pct_repite ?? stats?.pct_repite),
    captadas_total: safe(serverState?.metrics?.captadas_total ?? stats?.captadas_total),
  };
  const missingCount = nextRequirements.filter((item) => !item.met).length;

  return (
    <div className={`${styles.page} tc-rank-panel`}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}><Sparkles size={14}/> Tarot Leonaris · senda profesional</span>
          <h2>Tu ascenso por los Arcanos</h2>
          <p>Cada rango se calcula con tu producción real. Cumple todos los sellos del siguiente nivel para desbloquearlo.</p>
        </div>
        <span className={styles.period}>Periodo {month}</span>
      </header>

      <section className={styles.hero} data-rank={currentCode}>
        <div className={styles.heroGlow}/><div className={styles.starDust}>✦ · ✧ · ✦</div>
        <div className={styles.heroIdentity}>
          <RankEmblem code={currentCode} large/>
          <div>
            <span className={styles.heroLabel}>Arcano actual</span>
            <h3>{currentRank.name}</h3>
            <strong>{currentRank.subtitle}</strong>
            <p>{currentRank.description || "Categoría calculada con tus datos reales del periodo."}</p>
          </div>
        </div>

        <div className={styles.heroProgress}>
          <div className={styles.progressHeading}>
            <div><span>{maxReached ? "Rango máximo" : nextRank ? `Ascenso hacia ${nextRank.name}` : "Próximo rango"}</span><strong>{progress == null ? "—" : `${progress.toFixed(0)} %`}</strong></div>
            <div className={styles.sealCount}><Target size={16}/><span>{maxReached ? "Cima alcanzada" : nextRequirements.length ? `${nextRequirements.length - missingCount}/${nextRequirements.length} sellos cumplidos` : "Configurable por Admin"}</span></div>
          </div>
          <div className={styles.progressTrack} data-unconfigured={progress == null ? "true" : "false"}><span style={{ width: `${progress ?? 0}%` }}/></div>
          <div className={styles.progressFoot}>
            {maxReached ? <><Crown size={16}/> Has alcanzado el nivel supremo.</> : progress == null ? <><LockKeyhole size={16}/> El siguiente rango todavía necesita requisitos configurados.</> : missingCount === 0 ? <><CheckCircle2 size={16}/> Has cumplido todos los requisitos del siguiente rango.</> : <><Target size={16}/> Te faltan {missingCount} {missingCount === 1 ? "requisito" : "requisitos"} para completar el ascenso.</>}
          </div>
        </div>
      </section>

      <section className={styles.metricStrip}>
        <article><Timer size={18}/><span>Minutos totales</span><b>{metrics.minutes_total.toLocaleString("es-ES", { maximumFractionDigits: 1 })}</b></article>
        <article><UserRoundCheck size={18}/><span>Min. Cliente</span><b>{metrics.minutes_cliente.toLocaleString("es-ES", { maximumFractionDigits: 1 })}</b></article>
        <article><Repeat2 size={18}/><span>Min. Repite</span><b>{metrics.minutes_repite.toLocaleString("es-ES", { maximumFractionDigits: 1 })}</b></article>
        <article><Target size={18}/><span>Captadas</span><b>{Math.round(metrics.captadas_total)}</b></article>
        <article><Sparkles size={18}/><span>% Cliente</span><b>{metrics.pct_cliente.toFixed(2)}%</b></article>
        <article><TrendingUp size={18}/><span>% Repite</span><b>{metrics.pct_repite.toFixed(2)}%</b></article>
      </section>

      {!maxReached && nextRank ? <section className={styles.nextMission} data-rank={nextRank.code}>
        <div className={styles.sectionHeading}><div><span>Tu siguiente misión</span><h3>Desbloquear {nextRank.name}</h3><p>Cada sello se alimenta directamente de Rendimiento del periodo.</p></div><RankEmblem code={nextRank.code}/></div>
        {nextRequirements.length ? <div className={styles.requirementGrid}>{nextRequirements.map((item) => <article key={item.key} className={item.met ? styles.reqDone : ""}>
          <div className={styles.reqTop}>{item.met ? <CheckCircle2 size={17}/> : <Circle size={17}/>}<div><b>{item.label}</b><span>{formatMetric(item.current, item.unit)} / {formatMetric(item.target, item.unit)}</span></div><strong>{Math.min(100, item.progress).toFixed(0)}%</strong></div>
          <div className={styles.reqTrack}><span style={{ width: `${Math.min(100, item.progress)}%` }}/></div>
          <small>{item.met ? "Sello cumplido" : `Faltan ${formatMetric(item.remaining, item.unit)}`}</small>
        </article>)}</div> : <div className={styles.unconfigured}><LockKeyhole size={20}/><div><b>Requisitos pendientes de configurar</b><span>Administración todavía no ha definido los sellos de este rango.</span></div></div>}
      </section> : null}

      <section className={styles.ranksSection}>
        <div className={styles.sectionHeading}><div><span>Mapa de Arcanos</span><h3>Tu camino de progresión</h3><p>Cada nivel tiene su propia identidad, requisitos y recompensas.</p></div></div>
        <div className={styles.rankGrid}>
          {configuredRanks.map((rank) => {
            const rankProgress = serverState?.rank_progress?.[rank.code];
            const status = rankStatus(rank, currentCode, rankProgress);
            return <article key={rank.code} className={styles.rankCard} data-rank={rank.code} data-status={status}>
              <div className={styles.rankCardAura}/>
              <div className={styles.rankCardTop}><RankEmblem code={rank.code}/><div className={styles.rankStatus}>{status === "current" ? "TU RANGO" : status === "completed" ? "DESBLOQUEADO" : status === "unconfigured" ? "POR CONFIGURAR" : "BLOQUEADO"}</div></div>
              <span className={styles.rankName}>{rank.name}</span><h4>{rank.subtitle}</h4><p>{rank.description}</p>
              <div className={styles.cardBlock}><span>Progreso del nivel</span><strong>{rankProgress?.progress == null ? (rank.requirement_label || "Pendiente") : `${rankProgress.progress.toFixed(0)} %`}</strong>
                {rankProgress?.requirements?.length ? <div className={styles.miniReqs}>{rankProgress.requirements.map((req) => <span key={req.key} className={req.met ? styles.miniDone : ""}>{req.met ? <Check size={11}/> : <LockKeyhole size={10}/>} {req.label}</span>)}</div> : null}
              </div>
              <div className={styles.cardBlock}><span>Beneficios</span><BenefitList rank={rank}/></div>
            </article>;
          })}
        </div>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.infoCard}><div className={styles.infoIcon}><Trophy size={22}/></div><span>Tu posición actual</span><strong className={styles.position}>{position ? `#${position}` : "—"}</strong><p>{totalCompared > 0 ? `Entre ${totalCompared} tarotistas comparadas con datos reales del periodo.` : "Aún no hay suficiente actividad para comparar."}</p><button type="button" onClick={onOpenRanking}>Ver ranking completo <ArrowRight size={15}/></button></article>
        <article className={styles.infoCard}><div className={styles.infoIcon}><TrendingUp size={22}/></div><span>Cómo ascender</span><h4>Cumple todos los sellos</h4><ol className={styles.steps}><li>Aumenta tu producción real de minutos.</li><li>Construye Cliente y Repite de forma sostenible.</li><li>Las captadas confirmadas cuentan automáticamente.</li><li>El sistema recalcula tu rango con los datos del periodo.</li></ol></article>
        <article className={`${styles.infoCard} ${styles.nextCard}`} data-rank={nextRank?.code || currentCode}><div className={styles.infoIcon}>{maxReached ? <Crown size={22}/> : <BadgeEuro size={22}/>}</div><span>{maxReached ? "Rango máximo alcanzado" : nextRank ? `Recompensas de ${nextRank.name}` : "Próximo objetivo"}</span><h4>{maxReached ? "Oráculo Supremo" : nextRank?.subtitle || "Pendiente de configurar"}</h4>{maxReached ? <p>Has completado el mapa de progresión profesional.</p> : nextRank ? <BenefitList rank={nextRank}/> : <p>Sin siguiente rango configurado.</p>}</article>
      </section>
    </div>
  );
}
