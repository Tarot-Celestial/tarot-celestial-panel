"use client";

import { ArrowRight, Bell, Coins, Shield, Users, Zap } from "lucide-react";
import styles from "./CentralStatsCards.module.css";

export type CentralLevel = string;

export type CentralStatsData = {
  availableXp: number | null;
  xpToday: number;
  xpDateLabel?: string;
  currentLevel: CentralLevel;
  tierKey?: string;
  tierName?: string;
  levelNumber?: number;
  maxLevel?: boolean;
  clientsLoaded?: boolean;
  earningsLoaded?: boolean;
  currentLevelXp: number;
  nextLevelXp: number;
  nextLevelName: string;
  xpEvolution?: number[];
  activeClients: number;
  activeClientsThisWeek: number;
  notificationTotal: number;
  urgentNotifications: number;
  followUpNotifications: number;
  informationNotifications: number;
  earnedMoney: number;
  earnedMoneyThisWeek: number;
  earnedMoneyEvolution?: number[];
  earningsPeriodLabel?: string;
};

type CentralStatsCardsProps = {
  data: CentralStatsData;
  onViewProgress?: () => void;
  onViewLevels?: () => void;
  onViewClients?: () => void;
  onViewNotifications?: () => void;
  onViewEarnings?: () => void;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-ES").format(Math.max(0, value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.max(0, value));
}

function CardButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button className={styles.cardButton} type="button" onClick={onClick}>
      <span>{label}</span>
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
}

export default function CentralStatsCards({
  data,
  onViewProgress,
  onViewLevels,
  onViewClients,
  onViewNotifications,
  onViewEarnings,
}: CentralStatsCardsProps) {
  const levelProgress = data.maxLevel ? 100 : Math.min(
    100,
    Math.max(0, (data.currentLevelXp / Math.max(1, data.nextLevelXp)) * 100)
  );
  const levelProgressLabel = data.maxLevel
    ? "Nivel máximo alcanzado"
    : `${formatNumber(data.currentLevelXp)} / ${formatNumber(data.nextLevelXp)} XP para Nivel ${data.nextLevelName}`;

  return (
    <section className={styles.grid} aria-label="Estadísticas de Central">
      <article className={`${styles.card} ${styles.xpCard}`} aria-busy={data.availableXp == null}>
        <div className={styles.cardTop}>
          <span className={styles.iconBox} aria-hidden="true"><Zap size={24} strokeWidth={1.7} /></span>
          <h2 className={styles.eyebrow}>XP disponible</h2>
        </div>
        <div className={styles.value}>{data.availableXp == null ? "—" : formatNumber(data.availableXp)} <span className={styles.unit}>XP</span></div>
        <div className={styles.detail}>{data.availableXp == null ? "Cargando tu progreso…" : `+${formatNumber(data.xpToday)} XP ${data.xpDateLabel || "hoy"}`}</div>
        <CardButton label="Ver progreso" onClick={onViewProgress} />
      </article>

      <article className={`${styles.card} ${styles.levelCard}`}>
        <div className={styles.cardTop}>
          <span className={styles.iconBox} aria-hidden="true"><Shield size={24} strokeWidth={1.7} /></span>
          <h2 className={styles.eyebrow}>Nivel actual</h2>
        </div>
        <div className={styles.levelValue}>{data.tierName || data.currentLevel}</div>
        <div className={styles.detail}>{data.levelNumber != null ? `Nivel ${data.levelNumber}` : data.currentLevel}</div>
        <div className={styles.progressTrack} role="progressbar" aria-label="Progreso de nivel" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(levelProgress)} aria-valuetext={levelProgressLabel} title={levelProgressLabel}>
          <span style={{ width: `${levelProgress}%` }} />
        </div>
        <CardButton label="Ver niveles" onClick={onViewLevels} />
      </article>

      <article className={`${styles.card} ${styles.clientsCard}`} aria-busy={data.clientsLoaded === false}>
        <div className={styles.cardTop}>
          <span className={styles.iconBox} aria-hidden="true"><Users size={24} strokeWidth={1.7} /></span>
          <h2 className={styles.eyebrow}>Clientas activas</h2>
        </div>
        <div className={styles.value}>{data.clientsLoaded === false ? "—" : formatNumber(data.activeClients)}</div>
        <div className={styles.detail}>{data.clientsLoaded === false ? "Cargando cartera…" : `+${formatNumber(data.activeClientsThisWeek)} esta semana`}</div>
        <CardButton label="Ver mis clientas" onClick={onViewClients} />
      </article>

      <article className={`${styles.card} ${styles.notificationsCard}`}>
        <div className={styles.cardTop}>
          <span className={styles.iconBox} aria-hidden="true"><Bell size={24} strokeWidth={1.7} /></span>
          <h2 className={styles.eyebrow}>Notificaciones</h2>
        </div>
        <div className={styles.value}>{formatNumber(data.notificationTotal)}</div>
        <div className={styles.detail}>pendientes</div>
        <span className={styles.screenReaderOnly}>{formatNumber(data.urgentNotifications)} urgentes, {formatNumber(data.followUpNotifications)} seguimientos y {formatNumber(data.informationNotifications)} de información.</span>
        <CardButton label="Ver todas" onClick={onViewNotifications} />
      </article>

      <article className={`${styles.card} ${styles.moneyCard}`} aria-busy={data.earningsLoaded === false}>
        <div className={styles.cardTop}>
          <span className={styles.iconBox} aria-hidden="true"><Coins size={24} strokeWidth={1.7} /></span>
          <h2 className={styles.eyebrow}>Dinero ganado</h2>
        </div>
        <div className={`${styles.value} ${styles.moneyValue}`}>{data.earningsLoaded === false ? "—" : formatMoney(data.earnedMoney)}</div>
        <div className={styles.period}>{data.earningsPeriodLabel || "Factura del mes"}</div>
        <div className={styles.detail}>{data.earningsLoaded === false ? "Cargando ingresos…" : `+${formatMoney(data.earnedMoneyThisWeek)} esta semana`}</div>
        <CardButton label="Ver detalle" onClick={onViewEarnings} />
      </article>
    </section>
  );
}
