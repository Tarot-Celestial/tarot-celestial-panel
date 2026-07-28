"use client";

import { Coins, Shield, UserRoundCheck, UserRoundX } from "lucide-react";
import styles from "./MyClientsStatsCards.module.css";

export type MyClientsStatsData = {
  currentLevel: number;
  currentLevelXp: number;
  nextLevelXp: number;
  activeClients: number;
  activeClientsThisWeek: number;
  clientsWithoutFollowUp: number;
  availableCoins: number;
};

type MyClientsStatsCardsProps = {
  data: MyClientsStatsData;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-ES").format(Math.max(0, value));
}

export default function MyClientsStatsCards({ data }: MyClientsStatsCardsProps) {
  const levelProgress = Math.min(
    100,
    Math.max(0, (data.currentLevelXp / Math.max(1, data.nextLevelXp)) * 100)
  );

  return (
    <section className={styles.grid} aria-label="Resumen de Mis clientas">
      <article className={`${styles.card} ${styles.levelCard}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>NIVEL ACTUAL</div>
            <div className={styles.value}>Nivel {formatNumber(data.currentLevel)}</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <Shield size={28} strokeWidth={1.9} />
          </div>
        </div>

        <div className={styles.progressMeta}>
          <span>{formatNumber(data.currentLevelXp)} / {formatNumber(data.nextLevelXp)} XP</span>
          <span>{Math.round(levelProgress)}%</span>
        </div>
        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${levelProgress}%` }} />
        </div>
      </article>

      <article className={`${styles.card} ${styles.activeCard}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>CLIENTES ACTIVOS</div>
            <div className={styles.value}>{formatNumber(data.activeClients)}</div>
            <div className={styles.supporting}>+{formatNumber(data.activeClientsThisWeek)} esta semana</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <UserRoundCheck size={28} strokeWidth={1.9} />
          </div>
        </div>
        <div className={styles.decorativeRing} aria-hidden="true">
          <span />
        </div>
      </article>

      <article className={`${styles.card} ${styles.followUpCard}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>CLIENTES SIN SEGUIMIENTO</div>
            <div className={styles.value}>{formatNumber(data.clientsWithoutFollowUp)}</div>
            <div className={styles.supporting}>Requieren tu atención</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <UserRoundX size={28} strokeWidth={1.9} />
          </div>
        </div>
        <div className={styles.alertLine} aria-hidden="true">
          <span />
        </div>
      </article>

      <article className={`${styles.card} ${styles.coinsCard}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>COINS DISPONIBLES</div>
            <div className={styles.value}>{formatNumber(data.availableCoins)} Coins</div>
            <div className={styles.supporting}>Disponibles para reclamar</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <Coins size={29} strokeWidth={1.9} />
          </div>
        </div>
        <div className={styles.coinStack} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </article>
    </section>
  );
}
