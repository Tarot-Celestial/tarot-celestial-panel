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
  X,
  Coins,
  Gift,
  Target,
} from "lucide-react";
import { useState } from "react";
import { buildConfiguredLevels, type XpConfiguredLevel } from "@/lib/xp-levels";
import { useCentralXpData } from "./useCentralXpData";
import styles from "./CentralXpLevelsPanel.module.css";
import CentralXpRewardCelebration from "./CentralXpRewardCelebration";

const fmt = (value: number) => new Intl.NumberFormat("es-ES").format(Number(value) || 0);

const TIER_ICONS = {
  bronze: Shield,
  silver: Medal,
  gold: Trophy,
  elite: Gem,
  master: Crown,
  legend: Sparkles,
} as const;

function rewardValue(rewardType: string | null, rewardAmount: number | null) {
  if (rewardType === "coins" && rewardAmount != null) return `${fmt(rewardAmount)} Coins`;
  if (rewardType === "bonus" && rewardAmount != null) return `${fmt(rewardAmount)} € de bono`;
  if (rewardType && rewardAmount != null) return `${fmt(rewardAmount)} · ${rewardType}`;
  return null;
}

function rewardSummary(rewardType: string | null, rewardAmount: number | null, rewardLabel: string | null) {
  return rewardValue(rewardType, rewardAmount) || rewardLabel || "Beneficios por definir";
}

type Props = ReturnType<typeof useCentralXpData>;

export default function CentralXpLevelsPanel({ data, error, busy, load, acknowledgeReward, claimLevelReward }: Props) {
  const [selectedLevel, setSelectedLevel] = useState<XpConfiguredLevel | null>(null);
  const [claimingLevel, setClaimingLevel] = useState<number | null>(null);
  const [claimMessage, setClaimMessage] = useState("");

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
  const claimForLevel = (level: number) => data.reward_claims.find((claim) => claim.reward_kind === "level" && (claim.level === level + 1 || claim.reward_key === `level:${level + 1}`));
  const claimLevel = async (level: number) => {
    if (claimingLevel != null) return;
    setClaimingLevel(level);
    setClaimMessage("");
    try {
      const operationId = crypto.randomUUID();
      await claimLevelReward(level, operationId);
      setClaimMessage("Recompensa entregada en tu cartera de Coins.");
    } catch (claimError) {
      setClaimMessage(claimError instanceof Error ? claimError.message : "No se pudo reclamar la recompensa");
    } finally {
      setClaimingLevel(null);
    }
  };

  return (
    <section className={styles.page}>
      <CentralXpRewardCelebration data={data} onContinue={acknowledgeReward} />
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
                  const claim = claimForLevel(level.level);
                  return (
                    <button
                      type="button"
                      key={level.level}
                      className={`${styles.levelStep} ${done ? styles.levelDone : active ? styles.levelActive : styles.levelLocked}`}
                      onClick={() => setSelectedLevel(level)}
                      aria-label={`Consultar Nivel ${level.level}`}
                    >
                      {done ? <CheckCircle2 size={13} /> : active ? <Star size={13} /> : <LockKeyhole size={12} />}
                      <span>
                        <b>Nivel {level.level}</b>
                        <small>{level.next_active_level ? `${fmt(level.xp_to_next || 0)} XP → Nivel ${level.next_active_level}` : "Nivel máximo"}</small>
                        <em>{rewardSummary(level.reward_type, level.reward_amount, level.reward_label)}</em>
                        <em>{data.missions?.level_links?.filter(link=>link.level===level.level).length||0} misiones</em>
                        {done && level.reward_type === "coins" && Number(level.reward_amount) > 0 ? <em className={claim ? styles.rewardClaimed : styles.rewardPending}>{claim ? "Recompensa entregada" : "Pendiente de reclamar"}</em> : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className={styles.rewardSlot}>
                <LockKeyhole size={16} />
                <div>
                  <b>Recompensa especial de categoría</b>
                  <span>{rewardSummary(tier.reward_type, tier.reward_amount, tier.reward_label)}</span>
                  {rewardValue(tier.reward_type, tier.reward_amount) && tier.reward_label ? <small>{tier.reward_label}</small> : null}
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

      {selectedLevel ? (() => {
        const tier = data.tier_config.find((item) => item.key === selectedLevel.tier_key);
        const reached = progress.total_xp >= selectedLevel.cumulative_xp;
        const reward = rewardValue(selectedLevel.reward_type, selectedLevel.reward_amount);
        const existingClaim = claimForLevel(selectedLevel.level);
        return (
          <div className={styles.levelDetailBackdrop} role="dialog" aria-modal="true" aria-label={`Detalle Nivel ${selectedLevel.level}`} onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedLevel(null);
          }}>
            <article className={`${styles.levelDetail} ${styles[`tone_${selectedLevel.tier_key}`] || ""}`}>
              <button type="button" className={styles.closeDetail} onClick={() => setSelectedLevel(null)} aria-label="Cerrar"><X size={18} /></button>
              <div className={styles.detailBadge}><Star /><strong>{selectedLevel.level}</strong></div>
              <span className={styles.detailEyebrow}>NIVEL {selectedLevel.level}</span>
              <h2>{tier?.name || selectedLevel.tier_key}</h2>
              <div className={reached ? styles.detailReached : styles.detailLocked}>
                {reached ? <CheckCircle2 size={16} /> : <LockKeyhole size={16} />}
                <span>{reached ? "Nivel alcanzado" : "Todavía no has alcanzado este nivel"}</span>
              </div>
              <div className={styles.detailStats}>
                <div><span>REQUISITO</span><strong>{fmt(selectedLevel.cumulative_xp)} XP acumulados</strong></div>
                <div><span>{selectedLevel.next_active_level ? `PARA ALCANZAR NIVEL ${selectedLevel.next_active_level}` : "NIVEL MÁXIMO"}</span><strong>{selectedLevel.next_active_level ? `${fmt(selectedLevel.xp_to_next || 0)} XP adicionales` : "Progresión completada"}</strong></div>
              </div>
              <div className={styles.detailReward}>
                {selectedLevel.reward_type === "coins" ? <Coins /> : <Gift />}
                <div>
                  <span>RECOMPENSA DEL NIVEL</span>
                  <strong>{reward || (selectedLevel.reward_label ? "Recompensa configurada" : "Beneficios por definir")}</strong>
                  {selectedLevel.reward_label ? <p>“{selectedLevel.reward_label}”</p> : null}
                </div>
              </div>
              <div className={styles.detailMissions}><span>MISIONES DESBLOQUEADAS</span>{(data.missions?.level_links||[]).filter(link=>link.level===selectedLevel.level).map(link=>data.missions.catalog.find(m=>m.id===link.mission_id)).filter(Boolean).map((mission:any)=><div key={mission.id}><Target size={15}/><p><strong>{mission.name}</strong><small>{mission.description} · +{mission.xp_reward} XP</small></p></div>)}{!(data.missions?.level_links||[]).some(link=>link.level===selectedLevel.level)?<small>Este nivel no tiene misiones configuradas.</small>:null}</div>
              {reached && selectedLevel.reward_type === "coins" && Number(selectedLevel.reward_amount) > 0 ? (
                existingClaim ? <div className={styles.claimedState}><CheckCircle2 size={16}/> Recompensa ya entregada</div> : <button className={styles.claimButton} type="button" disabled={claimingLevel != null} onClick={() => void claimLevel(selectedLevel.level)}>{claimingLevel === selectedLevel.level ? "ENTREGANDO…" : "RECLAMAR RECOMPENSA"}</button>
              ) : null}
              {claimMessage ? <div className={styles.claimMessage}>{claimMessage}</div> : null}
            </article>
          </div>
        );
      })() : null}

      {!data.level_config_persisted ? (
        <div className={styles.softError}>La configuración persistente de niveles todavía no está instalada. Ejecuta el SQL de esta actualización.</div>
      ) : null}
      {error ? <div className={styles.softError}>{error}</div> : null}
    </section>
  );
}
