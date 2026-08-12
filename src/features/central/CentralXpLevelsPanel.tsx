"use client";

import {
  CheckCircle2,
  Crown,
  Gem,
  LockKeyhole,
  Medal,
  RefreshCw,
  Shield,
  Sparkles,
  Star,
  Trophy,
} from "lucide-react";
import { XP_LEVEL_STEPS, XP_MAX_LEVEL, XP_TO_LEVEL_20, xpTierRanges } from "@/lib/xp-levels";
import { useCentralXpData } from "./useCentralXpData";
import styles from "./CentralXpLevelsPanel.module.css";

const fmt = (value: number) => new Intl.NumberFormat("es-ES").format(Number(value) || 0);

const TIER_ICONS = {
  bronze: Shield,
  silver: Medal,
  gold: Trophy,
  elite: Gem,
  master: Crown,
  legend: Sparkles,
} as const;

export default function CentralXpLevelsPanel() {
  const { data, error, busy, load } = useCentralXpData();

  if (!data && !error) return <div className={styles.loading}>Cargando niveles…</div>;
  if (!data) {
    return (
      <div className={styles.error}>
        {error}
        <button type="button" onClick={() => void load()}>Reintentar</button>
      </div>
    );
  }

  const progress = data.progress;
  const currentTier = progress.tier;
  const progressPercent = progress.next_level
    ? Math.min(100, Math.max(0, (progress.level_xp / Math.max(1, progress.level_span)) * 100))
    : 100;

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={`${styles.heroBadge} ${styles[`tone_${currentTier?.key || "bronze"}`]}`}>
          <Shield />
          <strong>{progress.level}</strong>
        </div>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>MAPA DE PROGRESIÓN</span>
          <h1>Niveles</h1>
          <p>Descubre dónde estás ahora, qué rango viene después y cuánto XP necesitas para avanzar.</p>
          <div className={styles.currentLine}>
            <span>Rango actual</span>
            <strong>{currentTier?.name || "Bronce"}</strong>
            <i>·</i>
            <span>Nivel {progress.level}</span>
          </div>
        </div>
        <button className={styles.refresh} type="button" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} />
          {busy ? "Actualizando…" : "Actualizar"}
        </button>

        <div className={styles.progressPanel}>
          <div className={styles.progressStats}>
            <div>
              <span>XP TOTAL</span>
              <strong>{fmt(progress.total_xp)} XP</strong>
            </div>
            <div>
              <span>{progress.next_level ? "SIGUIENTE NIVEL" : "NIVEL MÁXIMO"}</span>
              <strong>{progress.next_level ? `Nivel ${progress.next_level}` : "Nivel 20 · Leyenda"}</strong>
            </div>
          </div>
          <div className={styles.track}>
            <i style={{ width: `${progressPercent}%` }} />
          </div>
          <div className={styles.progressFoot}>
            {progress.next_level ? (
              <>
                <b>{fmt(progress.level_xp)} / {fmt(progress.level_span)} XP</b>
                <span>{fmt(progress.remaining_xp)} XP para alcanzar el Nivel {progress.next_level}</span>
              </>
            ) : (
              <>
                <b>{fmt(progress.total_xp)} XP acumulados</b>
                <span>Has alcanzado el nivel máximo actual. Tu XP total puede seguir creciendo.</span>
              </>
            )}
          </div>
        </div>
      </header>

      <div className={styles.overview}>
        <article>
          <Star />
          <span>Nivel actual</span>
          <strong>{progress.level}</strong>
        </article>
        <article>
          <Trophy />
          <span>Rango</span>
          <strong>{currentTier?.name || "Bronce"}</strong>
        </article>
        <article>
          <Sparkles />
          <span>Meta Leyenda</span>
          <strong>{fmt(XP_TO_LEVEL_20)} XP</strong>
        </article>
      </div>

      <div className={styles.sectionHeading}>
        <span>CAMINO HASTA LEYENDA</span>
        <h2>Rangos y niveles</h2>
        <p>Los rangos completados quedan marcados, el actual se ilumina y los futuros permanecen bloqueados.</p>
      </div>

      <div className={styles.tierGrid}>
        {xpTierRanges().map((tier) => {
          const Icon = TIER_ICONS[tier.key];
          const completed = progress.level > tier.maxLevel;
          const current = progress.level >= tier.minLevel && progress.level <= tier.maxLevel;
          const locked = progress.level < tier.minLevel;
          const tierEnd = tier.endXp ?? XP_TO_LEVEL_20;
          const tierSpan = Math.max(1, tierEnd - tier.startXp);
          const tierProgress = completed
            ? 100
            : current
              ? Math.min(100, Math.max(0, ((progress.total_xp - tier.startXp) / tierSpan) * 100))
              : 0;

          return (
            <article
              key={tier.key}
              className={[
                styles.tierCard,
                styles[`tone_${tier.key}`],
                completed ? styles.completed : "",
                current ? styles.current : "",
                locked ? styles.locked : "",
              ].filter(Boolean).join(" ")}
            >
              <div className={styles.tierTop}>
                <div className={styles.tierBadge}>
                  <Icon />
                  <span>{tier.minLevel === tier.maxLevel ? tier.minLevel : `${tier.minLevel}-${tier.maxLevel}`}</span>
                </div>
                <div className={styles.tierIdentity}>
                  <small>{current ? "TU RANGO ACTUAL" : completed ? "RANGO COMPLETADO" : "RANGO BLOQUEADO"}</small>
                  <h3>{tier.name}</h3>
                  <p>Niveles {tier.minLevel}{tier.minLevel !== tier.maxLevel ? `–${tier.maxLevel}` : ""}</p>
                </div>
                <div className={styles.stateIcon}>
                  {completed ? <CheckCircle2 /> : current ? <Sparkles /> : <LockKeyhole />}
                </div>
              </div>

              <div className={styles.tierXp}>
                <div>
                  <span>XP acumulado del tramo</span>
                  <strong>
                    {tier.endXp
                      ? `${fmt(tier.startXp)} – ${fmt(tier.endXp)} XP`
                      : `Desde ${fmt(tier.startXp)} XP`}
                  </strong>
                </div>
                <div className={styles.miniTrack}><i style={{ width: `${tierProgress}%` }} /></div>
                <small>{completed ? "100 % completado" : current ? `${Math.round(tierProgress)} % del rango` : "Completa los rangos anteriores para desbloquearlo"}</small>
              </div>

              <div className={styles.levelSteps}>
                {Array.from({ length: tier.maxLevel - tier.minLevel + 1 }, (_, index) => tier.minLevel + index).map((level) => {
                  const done = progress.level > level;
                  const active = progress.level === level;
                  return (
                    <span key={level} className={done ? styles.levelDone : active ? styles.levelActive : ""}>
                      {done ? <CheckCircle2 size={13} /> : active ? <Star size={13} /> : <LockKeyhole size={12} />}
                      <span>
                        <b>Nivel {level}</b>
                        <small>{level < XP_MAX_LEVEL ? `${fmt(XP_LEVEL_STEPS[level - 1] ?? 0)} XP → Nivel ${level + 1}` : "Nivel máximo"}</small>
                      </span>
                    </span>
                  );
                })}
              </div>

              <div className={styles.rewardSlot}>
                <LockKeyhole size={16} />
                <div>
                  <b>Recompensas del rango</b>
                  <span>Beneficios por definir · Próximamente</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <article className={styles.legendGoal}>
        <div><Sparkles /><span>OBJETIVO FINAL</span></div>
        <h2>Nivel {XP_MAX_LEVEL} · Leyenda</h2>
        <p>Se necesitan <strong>{fmt(XP_TO_LEVEL_20)} XP acumulados</strong> para alcanzar el nivel máximo actual.</p>
        <small>Una vez alcanzado, puedes seguir acumulando XP total sin avanzar automáticamente a un Nivel 21.</small>
      </article>

      {error ? <div className={styles.softError}>{error}</div> : null}
    </section>
  );
}
