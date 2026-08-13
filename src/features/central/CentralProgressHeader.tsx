"use client";

import { Flame, RefreshCw, Settings, ShieldCheck, Sparkles } from "lucide-react";
import styles from "./CentralProgressHeader.module.css";

export type CentralOperatorProgress = {
  totalXp: number;
  activeStreakDays: number;
  loyaltyIndex: number;
};

export type CentralOperatorProfile = {
  name: string;
  role: string;
  level: string;
  photoUrl?: string | null;
};

type CentralProgressHeaderProps = {
  progress: CentralOperatorProgress;
  profile: CentralOperatorProfile;
  onOpenSettings?: () => void;
  onSync?: () => void;
  syncStatus?: "syncing" | "synced" | "error";
  lastSyncedAt?: string | null;
};

function formatXp(value: number) {
  return new Intl.NumberFormat("es-ES").format(Math.max(0, value));
}

function getInitials(name: string) {
  const firstCharacter = name.trim().charAt(0);
  return firstCharacter ? firstCharacter.toUpperCase() : "T";
}

export default function CentralProgressHeader({
  progress,
  profile,
  onOpenSettings,
  onSync,
  syncStatus = "syncing",
  lastSyncedAt,
}: CentralProgressHeaderProps) {
  return (
    <section className={styles.header} aria-label="Resumen de progreso de la telefonista">
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden="true">
          <Sparkles size={21} />
        </div>
        <div>
          <div className={styles.brandTitle}>CENTRAL</div>
          <div className={styles.brandSubtitle}>Tu centro de mando</div>
        </div>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metric}>
          <div className={styles.metricIcon} aria-hidden="true">
            <Sparkles size={17} />
          </div>
          <div>
            <div className={styles.metricLabel}>XP TOTAL</div>
            <div className={styles.metricValue}>{formatXp(progress.totalXp)} XP</div>
          </div>
        </article>

        <article className={styles.metric}>
          <div className={styles.metricIcon} aria-hidden="true">
            <Flame size={18} />
          </div>
          <div>
            <div className={styles.metricLabel}>RACHA ACTIVA</div>
            <div className={styles.metricValue}>{progress.activeStreakDays} días</div>
          </div>
        </article>

        <article className={styles.metric}>
          <div className={styles.metricIcon} aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className={styles.metricLabel}>ÍNDICE DE FIDELIZACIÓN</div>
            <div className={styles.metricValue}>{progress.loyaltyIndex} %</div>
          </div>
        </article>
      </div>

      <div className={styles.profileArea}>
        <div className={`${styles.syncState} ${styles[`sync_${syncStatus}`]}`} title={lastSyncedAt ? `Última actualización: ${new Date(lastSyncedAt).toLocaleTimeString("es-ES")}` : "Sincronizando datos"}>
          <span aria-hidden="true" />
          <small>{syncStatus === "error" ? "Error de sincronización" : syncStatus === "syncing" ? "Sincronizando…" : "Sincronizado"}</small>
        </div>
        <button className={`${styles.settingsButton} ${syncStatus === "syncing" ? styles.syncingButton : ""}`} type="button" onClick={onSync} aria-label="Sincronizar datos" title="Sincronizar datos">
          <RefreshCw size={19} />
        </button>
        <article className={styles.profileCard}>
          <div className={styles.avatar}>
            {profile.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.photoUrl} alt={`Foto de ${profile.name}`} />
            ) : (
              <span>{getInitials(profile.name)}</span>
            )}
          </div>

          <div className={styles.profileText}>
            <div className={styles.profileName}>{profile.name}</div>
            <div className={styles.profileRole}>{profile.role}</div>
            <div className={styles.profileLevel}>Nivel {profile.level}</div>
          </div>
        </article>

        <button
          className={styles.settingsButton}
          type="button"
          onClick={onOpenSettings}
          aria-label="Abrir configuración de Central"
          title="Configuración"
        >
          <Settings size={20} />
        </button>
      </div>
    </section>
  );
}
