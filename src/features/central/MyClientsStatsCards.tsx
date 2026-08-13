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
  loading?: boolean;
  onLevel: () => void;
  onActive: () => void;
  onFollowUp: () => void;
  onCoins: () => void;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-ES").format(Math.max(0, value));
}

export default function MyClientsStatsCards({ data, loading, onLevel, onActive, onFollowUp, onCoins }: MyClientsStatsCardsProps) {
  const levelProgress = Math.min(
    100,
    Math.max(0, (data.currentLevelXp / Math.max(1, data.nextLevelXp)) * 100)
  );

  return (
    <section className={styles.grid} aria-label="Resumen de Mis clientas">
      <button type="button" className={`${styles.card} ${styles.levelCard}`} onClick={onLevel}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>NIVEL ACTUAL</div>
            <div className={styles.value}>{loading ? "…" : `Nivel ${formatNumber(data.currentLevel)}`}</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <Shield size={28} strokeWidth={1.9} />
          </div>
        </div>

        <div className={styles.progressMeta}>
          <span>{loading ? "Cargando progreso…" : `${formatNumber(data.currentLevelXp)} / ${formatNumber(data.nextLevelXp)} XP`}</span>
          <span>{loading ? "" : `${Math.round(levelProgress)}%`}</span>
        </div>
        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${levelProgress}%` }} />
        </div>
      </button>

      <button type="button" className={`${styles.card} ${styles.activeCard}`} onClick={onActive}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>CLIENTES ACTIVOS</div>
            <div className={styles.value}>{loading ? "…" : formatNumber(data.activeClients)}</div>
            <div className={styles.supporting}>Cartera activa asignada</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <UserRoundCheck size={28} strokeWidth={1.9} />
          </div>
        </div>
        <div className={styles.decorativeRing} aria-hidden="true">
          <span />
        </div>
      </button>

      <button type="button" className={`${styles.card} ${styles.followUpCard}`} onClick={onFollowUp}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>CLIENTES SIN SEGUIMIENTO</div>
            <div className={styles.value}>{loading ? "…" : formatNumber(data.clientsWithoutFollowUp)}</div>
            <div className={styles.supporting}>Requieren tu atención</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <UserRoundX size={28} strokeWidth={1.9} />
          </div>
        </div>
        <div className={styles.alertLine} aria-hidden="true">
          <span />
        </div>
      </button>

      <button type="button" className={`${styles.card} ${styles.coinsCard}`} onClick={onCoins}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>COINS DISPONIBLES</div>
            <div className={styles.value}>{loading ? "…" : `${formatNumber(data.availableCoins)} Coins`}</div>
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
      </button>
    </section>
  );
}
