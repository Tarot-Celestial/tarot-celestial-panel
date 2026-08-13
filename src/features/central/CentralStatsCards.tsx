"use client";

import {
  Bell,
  ChevronRight,
  CircleDollarSign,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import styles from "./CentralStatsCards.module.css";

export type CentralLevel = string;

export type CentralStatsData = {
  totalXp: number;
  xpToday: number;
  xpDateLabel?: string;
  currentLevel: CentralLevel;
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
    maximumFractionDigits: 0,
  }).format(Math.max(0, value));
}


function moneyChartPoints(values: number[]) {
  const clean = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!clean.length) return "0,21 130,21";
  if (clean.length === 1) return "0,21 130,21";
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min;
  return clean.map((value, index) => {
    const x = (index / (clean.length - 1)) * 130;
    const y = range === 0 ? 21 : 36 - ((value - min) / range) * 31;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function MiniChart({ points }: { points: string }) {
  return (
    <svg className={styles.miniChart} viewBox="0 0 130 42" role="img" aria-label="Evolución decorativa">
      <path className={styles.chartArea} d={`M${points} L130 42 L0 42 Z`} />
      <polyline className={styles.chartLine} points={points} />
    </svg>
  );
}

function CardButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button className={styles.cardButton} type="button" onClick={onClick}>
      <span>{label}</span>
      <ChevronRight size={15} aria-hidden="true" />
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
  const levelProgress = Math.min(
    100,
    Math.max(0, (data.currentLevelXp / Math.max(1, data.nextLevelXp)) * 100)
  );
  const levelClass = styles[`level${data.currentLevel}`] || styles.levelOro;
  const earnedMoneyPoints = moneyChartPoints(data.earnedMoneyEvolution || []);
  const xpPoints = moneyChartPoints(data.xpEvolution || []);

  return (
    <section className={styles.grid} aria-label="Estadísticas de Central">
      <article className={`${styles.card} ${styles.xpCard}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>XP TOTAL</div>
            <div className={styles.value}>{formatNumber(data.totalXp)} XP</div>
            <div className={styles.positive}>+{formatNumber(data.xpToday)} XP {data.xpDateLabel || "hoy"}</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <Sparkles size={27} />
          </div>
        </div>
        <div className={styles.visualArea} aria-hidden="true">
          <MiniChart points={xpPoints} />
        </div>
        <CardButton label="VER PROGRESO" onClick={onViewProgress} />
      </article>

      <article className={`${styles.card} ${styles.levelCard} ${levelClass}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>NIVEL ACTUAL</div>
            <div className={styles.levelValue}>{data.currentLevel.toUpperCase()}</div>
          </div>
          <div className={`${styles.iconBox} ${styles.levelBadge}`} aria-hidden="true">
            <Shield size={29} />
          </div>
        </div>
        <div className={styles.progressMeta}>
          <span>{formatNumber(data.currentLevelXp)} / {formatNumber(data.nextLevelXp)} XP</span>
          <span>para Nivel {data.nextLevelName}</span>
        </div>
        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${levelProgress}%` }} />
        </div>
        <CardButton label="VER NIVELES" onClick={onViewLevels} />
      </article>

      <article className={`${styles.card} ${styles.clientsCard}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>CLIENTES ACTIVAS</div>
            <div className={styles.value}>{formatNumber(data.activeClients)}</div>
            <div className={styles.positive}>+{formatNumber(data.activeClientsThisWeek)} esta semana</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <Users size={27} />
          </div>
        </div>
        <div className={styles.ringVisual} aria-hidden="true">
          <span className={styles.ringCore}>{Math.min(99, data.activeClients)}%</span>
        </div>
        <CardButton label="VER MIS CLIENTES" onClick={onViewClients} />
      </article>

      <article className={`${styles.card} ${styles.notificationsCard}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>NOTIFICACIONES</div>
            <div className={styles.value}>{formatNumber(data.notificationTotal)}</div>
            <div className={styles.muted}>pendientes</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <Bell size={27} />
          </div>
        </div>
        <div className={styles.notificationList}>
          <div><span className={styles.urgentDot} />Urgentes <strong>{data.urgentNotifications}</strong></div>
          <div><span className={styles.followDot} />Seguimientos <strong>{data.followUpNotifications}</strong></div>
          <div><span className={styles.infoDot} />Información <strong>{data.informationNotifications}</strong></div>
        </div>
        <CardButton label="VER TODAS" onClick={onViewNotifications} />
      </article>

      <article className={`${styles.card} ${styles.moneyCard}`}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.eyebrow}>DINERO GANADO</div>
            <div className={styles.value}>{formatMoney(data.earnedMoney)}</div>
            <div className={styles.positive}>+{formatMoney(data.earnedMoneyThisWeek)} esta semana</div>
          </div>
          <div className={styles.iconBox} aria-hidden="true">
            <CircleDollarSign size={28} />
          </div>
        </div>
        <div className={styles.visualArea} aria-hidden="true">
          <MiniChart points={earnedMoneyPoints} />
        </div>
        <CardButton label="VER DETALLE" onClick={onViewEarnings} />
      </article>
    </section>
  );
}
