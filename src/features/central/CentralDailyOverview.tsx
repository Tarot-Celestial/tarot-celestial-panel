"use client";

import {
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Info,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import styles from "./CentralDailyOverview.module.css";

export type DailyAction = {
  id: string;
  label: string;
  rewardXp: number;
  completed?: boolean;
};

export type DailySummaryData = {
  title?: string;
  subtitle?: string;
  actions: DailyAction[];
  completed: number;
  target: number;
  dailyXp?: number;
};

export type MissionItem = {
  id: string;
  name: string;
  description: string;
  progress: number;
  target: number;
  rewardXp: number;
  completed?: boolean;
};

export type RecentNotificationType =
  | "urgent"
  | "opportunity"
  | "achievement"
  | "information"
  | "sale";

export type RecentNotification = {
  id: string;
  type: RecentNotificationType;
  title: string;
  description: string;
  createdAtLabel: string;
  observation?: string;
  actionLabel?: string;
};

export type CentralDailyOverviewData = {
  dailySummary: DailySummaryData;
  missions: MissionItem[];
  notifications: RecentNotification[];
};

type Props = {
  data: CentralDailyOverviewData;
  onViewAllMissions?: () => void;
  onViewAllNotifications?: () => void;
};

function percent(value: number, target: number) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

function formatXp(value: number) {
  return new Intl.NumberFormat("es-ES").format(value);
}

function NotificationIcon({ type }: { type: RecentNotificationType }) {
  if (type === "urgent") return <CircleAlert size={18} />;
  if (type === "opportunity") return <Target size={18} />;
  if (type === "achievement") return <Trophy size={18} />;
  if (type === "sale") return <CircleDollarSign size={18} />;
  return <Info size={18} />;
}

export default function CentralDailyOverview({
  data,
  onViewAllMissions,
  onViewAllNotifications,
}: Props) {
  const summaryProgress = percent(data.dailySummary.completed, data.dailySummary.target);

  return (
    <section className={styles.layout} aria-label="Actividad diaria de Central">
      <article className={`${styles.panel} ${styles.summaryPanel}`}>
        <header className={styles.panelHeader}>
          <div>
            <span className={styles.kicker}>PROGRESO DIARIO</span>
            <h2>{data.dailySummary.title || "Tu resumen de hoy"}</h2>
            <p>
              {data.dailySummary.subtitle ||
                "Sigue así, cada acción te acerca más a tus metas y recompensas."}
            </p>
          </div>
          <div className={`${styles.headerIcon} ${styles.summaryIcon}`} aria-hidden="true">
            <Sparkles size={23} />
          </div>
        </header>

        <div className={styles.dailyActions}>
          {data.dailySummary.actions.map((action) => (
            <div className={styles.dailyAction} key={action.id}>
              <span className={`${styles.actionState} ${action.completed ? styles.done : ""}`}>
                {action.completed ? <Check size={14} /> : <ChevronRight size={14} />}
              </span>
              <span className={styles.actionLabel}>{action.label}</span>
              <strong>+{formatXp(action.rewardXp)} XP</strong>
            </div>
          ))}
        </div>

        <div className={styles.summaryFooter}>
          <div className={styles.progressHeading}>
            <span>Progreso de hoy</span>
            <strong>
              {data.dailySummary.completed} / {data.dailySummary.target} completado
            </strong>
          </div>
          <div className={styles.progressTrack} aria-label={`${summaryProgress}% completado`}>
            <span style={{ width: `${summaryProgress}%` }} />
          </div>
          {typeof data.dailySummary.dailyXp === "number" && (
            <div className={styles.xpEarned}>+{formatXp(data.dailySummary.dailyXp)} XP obtenidos hoy</div>
          )}
        </div>
      </article>

      <article className={`${styles.panel} ${styles.missionsPanel}`}>
        <header className={styles.panelHeader}>
          <div>
            <span className={styles.kicker}>DESAFÍOS</span>
            <h2>Misiones activas</h2>
            <p>Completa misiones y gana XP y recompensas.</p>
          </div>
          <div className={`${styles.headerIcon} ${styles.missionIcon}`} aria-hidden="true">
            <Target size={23} />
          </div>
        </header>

        <div className={styles.missionList}>
          {data.missions.map((mission) => {
            const missionPercent = percent(mission.progress, mission.target);
            const complete = mission.completed || mission.progress >= mission.target;

            return (
              <div className={`${styles.mission} ${complete ? styles.missionComplete : ""}`} key={mission.id}>
                <div className={styles.missionTop}>
                  <div>
                    <h3>{mission.name}</h3>
                    <p>{mission.description}</p>
                  </div>
                  <span className={styles.missionReward}>+{formatXp(mission.rewardXp)} XP</span>
                </div>
                <div className={styles.missionProgressMeta}>
                  <span>{complete ? "Completada" : "En progreso"}</span>
                  <strong>{mission.progress} / {mission.target}</strong>
                </div>
                <div className={styles.missionTrack} aria-label={`${missionPercent}% completado`}>
                  <span style={{ width: `${missionPercent}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <button className={styles.panelButton} type="button" onClick={onViewAllMissions}>
          VER TODAS LAS MISIONES
          <ChevronRight size={15} />
        </button>
      </article>

      <article className={`${styles.panel} ${styles.notificationsPanel}`}>
        <header className={styles.notificationHeader}>
          <div>
            <span className={styles.kicker}>ACTIVIDAD</span>
            <h2>Notificaciones recientes</h2>
          </div>
          <button type="button" onClick={onViewAllNotifications}>Ver todas</button>
        </header>

        <div className={styles.notificationList}>
          {data.notifications.map((notification) => (
            <div
              className={`${styles.notification} ${styles[`notification_${notification.type}`]}`}
              key={notification.id}
            >
              <span className={styles.notificationIcon} aria-hidden="true">
                <NotificationIcon type={notification.type} />
              </span>
              <div className={styles.notificationBody}>
                <div className={styles.notificationTitleRow}>
                  <h3>{notification.title}</h3>
                  <time>{notification.createdAtLabel}</time>
                </div>
                <p>{notification.description}</p>
                {notification.observation && (
                  <div className={styles.observation}>{notification.observation}</div>
                )}
                {notification.actionLabel && (
                  <span className={styles.notificationAction}>{notification.actionLabel}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.notificationFooter}>
          <Bell size={14} />
          <span>Las alertas críticas destacarán aquí automáticamente.</span>
        </div>
      </article>
    </section>
  );
}
