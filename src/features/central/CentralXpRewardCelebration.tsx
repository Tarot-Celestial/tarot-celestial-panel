"use client";

import { Coins, Gift, Sparkles, Star } from "lucide-react";
import type { CentralXpData } from "./useCentralXpData";
import styles from "./CentralXpRewardCelebration.module.css";

const fmt = (value: number) => new Intl.NumberFormat("es-ES").format(Number(value) || 0);

function rewardValue(claim: NonNullable<CentralXpData["pending_reward"]>) {
  if (claim.reward_type === "coins" && claim.reward_amount != null) return `+${fmt(claim.reward_amount)} Coins`;
  if (claim.reward_type === "bonus" && claim.reward_amount != null) return `${fmt(claim.reward_amount)} € de bono`;
  if (claim.reward_amount != null && claim.reward_type) return `${fmt(claim.reward_amount)} · ${claim.reward_type}`;
  return "Recompensa desbloqueada";
}

export default function CentralXpRewardCelebration({
  data,
  onContinue,
}: {
  data: CentralXpData;
  onContinue: (claimId: string) => Promise<void>;
}) {
  const claim = data.pending_reward;
  if (!claim) return null;

  const tier = data.tier_config.find((item) => item.key === claim.tier_key);
  const isLevel = claim.reward_kind === "level";

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Nivel superado">
      <div className={styles.particles} aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
      </div>
      <article className={styles.modal}>
        <div className={styles.glow} />
        <div className={styles.badge}>
          {isLevel ? <Star /> : <Gift />}
          <strong>{claim.level || data.progress.level}</strong>
        </div>
        <span className={styles.eyebrow}><Sparkles size={14} /> {isLevel ? "NIVEL SUPERADO" : "CATEGORÍA DESBLOQUEADA"} <Sparkles size={14} /></span>
        <h2>¡Felicidades {data.worker.name}!</h2>
        <p className={styles.reached}>{isLevel ? "Has alcanzado" : "Has desbloqueado"}</p>
        <h3>{isLevel ? `NIVEL ${claim.level}` : (tier?.name || claim.tier_key || "Nuevo rango")}</h3>
        {isLevel && tier ? <span className={styles.tier}>{tier.name}</span> : null}

        <div className={styles.reward}>
          <Coins />
          <div>
            <small>HAS CONSEGUIDO</small>
            <strong>{rewardValue(claim)}</strong>
          </div>
        </div>

        {claim.reward_label ? <blockquote>“{claim.reward_label}”</blockquote> : null}

        <button type="button" onClick={() => void onContinue(claim.id)}>CONTINUAR</button>
      </article>
    </div>
  );
}
