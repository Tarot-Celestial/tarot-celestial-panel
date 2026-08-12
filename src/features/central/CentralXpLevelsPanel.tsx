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
import { buildConfiguredLevels } from "@/lib/xp-levels";
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

function rewardText(rewardType: string | null, rewardAmount: number | null, rewardLabel: string | null) {
  if (rewardLabel) return rewardLabel;
  if (rewardType === "coins" && rewardAmount != null) return `${fmt(rewardAmount)} Coins`;
  if (rewardType === "bonus" && rewardAmount != null) return `${fmt(rewardAmount)} € de bono`;
  if (rewardType && rewardAmount != null) return `${fmt(rewardAmount)} · ${rewardType}`;
  return "Beneficios por definir · Próximamente";
}

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
  const configuredLevels = buildConfiguredLevels(data.level_config);
  const visibleTiers = [...data.tier_config]
    .filter((tier) => tier.active && configuredLevels.some((level) => level.tier_key === tier.key))
    .sort((a, b) => a.display_order - b.display_order);
  const currentTier = progress.tier;
  const progressPercent = progress.next_level
    ? Math.min(100, Math.max(0, (progress.level_xp / Math.max(1, progress.level_span)) * 100))
    : 100;
  const totalGoal = progress.total_required_for_max ?? configuredLevels[configuredLevels.length - 1]?.cumulative_xp ?? 0;

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div className={`${styles.heroBadge} ${styles[`tone_${currentTier?.key || "bronze"}`] || ""}`}>
          <Shield />
          <strong>{progress.level}</strong>
        </div>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>MAPA DE PROGRESIÓN</span>
          <h1>Niveles</h1>
          <p>Tu progreso utiliza en tiempo real la configuración definida por Administración.</p>
          <div className={styles.currentLine}>
            <span>Rango actual</span>
            <strong>{currentTier?.name || "Sin categoría"}</strong>
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
              <strong>{progress.next_level ? `Nivel ${progress.next_level}` : `Nivel ${progress.level}`}</strong>
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
                <span>Has alcanzado el nivel máximo configurado. Tu XP total puede seguir creciendo.</span>
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
          <strong>{currentTier?.name || "—"}</strong>
        </article>
        <article>
          <Sparkles />
          <span>Meta máxima actual</span>
          <strong>{fmt(totalGoal)} XP</strong>
        </article>
      </div>

      <div className={styles.sectionHeading}>
        <span>CONFIGURACIÓN DE ADMINISTRACIÓN</span>
        <h2>Rangos y niveles</h2>
        <p>Los requisitos, categorías y recompensas mostrados aquí proceden del Sistema de XP Admin.</p>
      </div>

      <div className={styles.tierGrid}>
        {visibleTiers.map((tier) => {
          const Icon = TIER_ICONS[tier.key as keyof typeof TIER_ICONS] ?? Shield;
          const tierLevels = configuredLevels.filter((level) => level.tier_key === tier.key);
          if (!tierLevels.length) return null;
          const first = tierLevels[0];
          const last = tierLevels[tierLevels.length - 1];
          const startXp = first.cumulative_xp;
          const endXp = last.next_active_level ? last.cumulative_xp + Math.max(0, Number(last.xp_to_next) || 0) : totalGoal;
          const tierSpan = Math.max(1, endXp - startXp);
          const completed = progress.total_xp >= endXp && Boolean(last.next_active_level);
          const current = currentTier?.key === tier.key;
          const locked = !completed && !current && progress.total_xp < startXp;
          const tierProgress = completed
            ? 100
            : current
              ? Math.min(100, Math.max(0, ((progress.total_xp - startXp) / tierSpan) * 100))
              : 0;

          return (
            <article
              key={tier.key}
              className={[
                styles.tierCard,
                styles[`tone_${tier.key}`] || "",
                completed ? styles.completed : "",
                current ? styles.current : "",
                locked ? styles.locked : "",
              ].filter(Boolean).join(" ")}
            >
              <div className={styles.tierTop}>
                <div className={styles.tierBadge}>
                  <Icon />
                  <span>{tierLevels.length === 1 ? first.level : `${first.level}-${last.level}`}</span>
                </div>
                <div className={styles.tierIdentity}>
                  <small>{current ? "TU RANGO ACTUAL" : completed ? "RANGO COMPLETADO" : "RANGO BLOQUEADO"}</small>
                  <h3>{tier.name}</h3>
                  <p>Niveles {tierLevels.map((level) => level.level).join(" · ")}</p>
                </div>
                <div className={styles.stateIcon}>
                  {completed ? <CheckCircle2 /> : current ? <Sparkles /> : <LockKeyhole />}
                </div>
              </div>

              <div className={styles.tierXp}>
                <div>
                  <span>XP acumulado del tramo</span>
                  <strong>{last.next_active_level ? `${fmt(startXp)} – ${fmt(endXp)} XP` : `Desde ${fmt(startXp)} XP`}</strong>
                </div>
                <div className={styles.miniTrack}><i style={{ width: `${tierProgress}%` }} /></div>
                <small>{completed ? "100 % completado" : current ? `${Math.round(tierProgress)} % del rango` : "Completa los rangos anteriores para desbloquearlo"}</small>
              </div>

              <div className={styles.levelSteps}>
                {tierLevels.map((level) => {
                  const done = progress.level > level.level;
                  const active = progress.level === level.level;
                  return (
                    <span key={level.level} className={done ? styles.levelDone : active ? styles.levelActive : ""}>
                      {done ? <CheckCircle2 size={13} /> : active ? <Star size={13} /> : <LockKeyhole size={12} />}
                      <span>
                        <b>Nivel {level.level}</b>
                        <small>{level.next_active_level ? `${fmt(level.xp_to_next || 0)} XP → Nivel ${level.next_active_level}` : "Nivel máximo"}</small>
                        {level.reward_type || level.reward_label ? <em>{rewardText(level.reward_type, level.reward_amount, level.reward_label)}</em> : null}
                      </span>
                    </span>
                  );
                })}
              </div>

              <div className={styles.rewardSlot}>
                <LockKeyhole size={16} />
                <div>
                  <b>Recompensa especial de categoría</b>
                  <span>{rewardText(tier.reward_type, tier.reward_amount, tier.reward_label)}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <article className={styles.legendGoal}>
        <div><Sparkles /><span>OBJETIVO FINAL CONFIGURADO</span></div>
        <h2>Nivel máximo · {configuredLevels[configuredLevels.length - 1]?.level || 20}</h2>
        <p>Actualmente se necesitan <strong>{fmt(totalGoal)} XP acumulados</strong> para alcanzar el último nivel activo.</p>
        <small>El XP histórico no cambia cuando Administración modifica los requisitos.</small>
      </article>

      {!data.level_config_persisted ? (
        <div className={styles.softError}>La configuración persistente de niveles todavía no está instalada. Ejecuta el SQL de esta actualización.</div>
      ) : null}
      {error ? <div className={styles.softError}>{error}</div> : null}
    </section>
  );
}
