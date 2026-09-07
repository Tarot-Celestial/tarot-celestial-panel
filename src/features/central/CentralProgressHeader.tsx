"use client";

import { useEffect, useState } from "react";
import { Flame, Pencil, RefreshCw, ShieldCheck, Sparkles, Star } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import CentralThemeCustomizer from "./CentralThemeCustomizer";
import CentralProfileEditor, { type CentralPublicProfile } from "./CentralProfileEditor";
import { centralThemeStyle } from "@/lib/central-profile-theme";
import styles from "./CentralProgressHeader.module.css";

export type CentralOperatorProgress = {
  totalXp: number;
  activeStreakDays: number;
  loyaltyIndex: number | null;
  loyaltyClientCount: number;
};

export type CentralOperatorProfile = {
  name: string;
  role: string;
  level: string;
  photoUrl?: string | null;
  team?: string;
};

type CentralProgressHeaderProps = {
  progress: CentralOperatorProgress;
  profile: CentralOperatorProfile;
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

const sb = supabaseBrowser();

export default function CentralProgressHeader({
  progress,
  profile,
  onSync,
  syncStatus = "syncing",
  lastSyncedAt,
}: CentralProgressHeaderProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [publicProfile, setPublicProfile] = useState<CentralPublicProfile>({
    name: profile.name,
    presentation: "",
    photoUrl: profile.photoUrl || null,
    rating: 0,
    reviewCount: 0,
    team: profile.team || "",
    themeVariant: "balanced",
    schedule: [],
    reviews: [],
  });

  useEffect(() => {
    let active = true;
    async function loadPublicProfile() {
      const token = (await sb.auth.getSession()).data.session?.access_token || "";
      if (!token) return;
      const response = await fetch("/api/central/public-profile", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (active && result.ok && result.profile) setPublicProfile(result.profile);
    }
    void loadPublicProfile();
    const channel = sb.channel("central-public-profile-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "central_review_stats" }, () => void loadPublicProfile())
      .on("postgres_changes", { event: "*", schema: "public", table: "central_public_profiles" }, () => void loadPublicProfile())
      .subscribe();
    return () => { active = false; void sb.removeChannel(channel); };
  }, []);

  const shownName = publicProfile.name || profile.name;
  const shownPhoto = publicProfile.photoUrl || profile.photoUrl;

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

        <article className={styles.metric} title={progress.loyaltyClientCount ? `Promedio real de ${progress.loyaltyClientCount} clientas asignadas` : "La cartera actual todavía no tiene clientas asignadas"}>
          <div className={styles.metricIcon} aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className={styles.metricLabel}>ÍNDICE DE FIDELIZACIÓN</div>
            <div className={styles.metricValue}>{progress.loyaltyIndex == null ? "Sin datos" : `${progress.loyaltyIndex} %`}</div>
          </div>
        </article>
      </div>

      <div className={styles.profileArea}>
        <div className={styles.syncControls}>
          <div className={`${styles.syncState} ${styles[`sync_${syncStatus}`]}`} title={lastSyncedAt ? `Última actualización: ${new Date(lastSyncedAt).toLocaleTimeString("es-ES")}` : "Sincronizando datos"}>
            <span aria-hidden="true" />
            <small>{syncStatus === "error" ? "Error de sincronización" : syncStatus === "syncing" ? "Sincronizando…" : "Sincronizado"}</small>
          </div>
          <button className={`${styles.syncButton} ${syncStatus === "syncing" ? styles.syncingButton : ""}`} type="button" onClick={onSync} aria-label="Sincronizar datos" title="Sincronizar datos">
            <RefreshCw size={19} />
          </button>
        </div>
        <button type="button" className={styles.profileCard} style={centralThemeStyle(publicProfile.team || profile.team, publicProfile.themeVariant)} onClick={() => setEditorOpen(true)} aria-label="Abrir y editar mi perfil público">
          <div className={styles.avatar}>
            {shownPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownPhoto} alt={`Foto de ${shownName}`} />
            ) : (
              <span>{getInitials(shownName)}</span>
            )}
          </div>

          <div className={styles.profileText}>
            <div className={styles.profileName}>{shownName}</div>
            <div className={styles.profileRole}>{profile.role}</div>
            <div className={styles.profileLevel}>Nivel {profile.level}</div>
            <div className={styles.profileRating}>
              <span>{[1, 2, 3, 4, 5].map((value) => <Star key={value} size={10} fill={value <= Math.round(publicProfile.rating) ? "currentColor" : "none"} />)}</span>
              <small>{publicProfile.reviewCount ? publicProfile.rating.toFixed(1) : "Sin reseñas"}</small>
            </div>
          </div>
          <Pencil className={styles.editProfileIcon} size={14} aria-hidden="true" />
        </button>
        <CentralThemeCustomizer />
      </div>
      <CentralProfileEditor open={editorOpen} profile={publicProfile} onClose={() => setEditorOpen(false)} onSaved={setPublicProfile} />
    </section>
  );
}
