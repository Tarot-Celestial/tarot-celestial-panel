"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, ChevronRight, Clock3, Coins, Gift, Home, LogOut, Medal, Sparkles, UserCircle2, WandSparkles, MoonStar, Tags, Star } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { ReactNode, useCallback, useEffect, useState } from "react";
import styles from "./ClientePremium.module.css";

const sb = supabaseClienteBrowser();

type SummaryItem = {
  label: string;
  value: string;
  meta?: string;
  href?: string;
  tone?: "rank" | "points" | "minutes" | "alerts" | "oracle" | "default";
};

type Props = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  summaryItems?: SummaryItem[];
  children: ReactNode;
};

type HologramIconProps = {
  children: ReactNode;
  tone?: SummaryItem["tone"] | "gold" | "cyan" | "rose";
  compact?: boolean;
};

function HologramIcon({ children, tone = "gold", compact = false }: HologramIconProps) {
  return (
    <span className={`${styles.particleIcon} ${compact ? styles.particleIconCompact : ""}`} data-tone={tone} aria-hidden="true">
      <span className={styles.particleIconCore}>{children}</span>
    </span>
  );
}

function SummaryIcon({ label, tone }: { label: string; tone: NonNullable<SummaryItem["tone"]> }) {
  const normalized = label.toLowerCase();
  if (normalized.includes("rango")) return <HologramIcon tone="rank"><Medal size={25} /></HologramIcon>;
  if (normalized.includes("coins") || normalized.includes("puntos")) return <HologramIcon tone="points"><Coins size={26} /></HologramIcon>;
  if (normalized.includes("minutos")) return <HologramIcon tone="minutes"><Clock3 size={25} /></HologramIcon>;
  if (normalized.includes("notificaciones")) return <HologramIcon tone="alerts"><BellRing size={25} /></HologramIcon>;
  if (normalized.includes("tiradas")) return <HologramIcon tone="gold"><WandSparkles size={25} /></HologramIcon>;
  return <HologramIcon tone={tone}><Sparkles size={25} /></HologramIcon>;
}

export default function ClienteLayout({ title, subtitle, eyebrow = "Tarot Celestial", summaryItems = [], children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [promoActive, setPromoActive] = useState(false);

  const refreshPromoState = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/cliente/promotions/active", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return;
    const payload = await response.json().catch(() => null);
    if (payload?.ok) setPromoActive(Boolean(payload.promotion));
  }, []);

  const refreshNotificationCount = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/cliente/notificaciones?limit=1", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return;
    const payload = await response.json().catch(() => null);
    if (payload?.ok) setUnreadNotifications(Math.max(0, Number(payload.unread_count || 0)));
  }, []);

  useEffect(() => {
    void refreshPromoState();
    const channel = sb.channel("tc-client-promo-nav")
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_client_promotions" }, () => { void refreshPromoState(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_client_promotion_packages" }, () => { void refreshPromoState(); })
      .subscribe();
    const focus = () => void refreshPromoState();
    const timer = window.setInterval(() => { void refreshPromoState(); }, 30000);
    window.addEventListener("focus", focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      void sb.removeChannel(channel);
    };
  }, [refreshPromoState]);

  useEffect(() => {
    void refreshNotificationCount();
    const refresh = () => void refreshNotificationCount();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("tc-client-notifications-change", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("tc-client-notifications-change", refresh);
    };
  }, [refreshNotificationCount]);

  useEffect(() => {
    let timer: any = null;
    let cancelled = false;

    async function ping(access = false) {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      await fetch("/api/cliente/activity/ping", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access }),
      }).catch(() => null);
    }

    const accessKey = `tc_cliente_access_logged_${new Date().toISOString().slice(0, 10)}`;
    const shouldCountAccess = typeof window !== "undefined" && !window.sessionStorage.getItem(accessKey);
    if (shouldCountAccess) {
      window.sessionStorage.setItem(accessKey, "1");
    }

    ping(shouldCountAccess);
    timer = window.setInterval(() => ping(false), 60000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [pathname]);

  async function logout() {
    await sb.auth.signOut();
    router.replace("/cliente/login");
  }

  return (
    <div className={`tc-wrap ${styles.premiumShell}`} data-home={pathname === "/cliente/dashboard" ? "true" : "false"}>
      <div className={styles.spaceField} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className={styles.celestialBackdrop} aria-hidden="true">
        <span className={styles.celestialAmbientGlow} />
        <span className={styles.celestialOrbitOuter} />
        <span className={styles.celestialOrbitInner} />
        <div className={styles.celestialLogoGhost}>
          <Image
            src="/tarot-celestial-logo-4k.webp"
            alt=""
            fill
            sizes="(max-width: 800px) 92vw, (max-width: 1500px) 72vw, 1180px"
            aria-hidden="true"
          />
        </div>
        <div className={styles.celestialLogoMain}>
          <Image
            src="/tarot-celestial-logo-4k.webp"
            alt=""
            fill
            sizes="(max-width: 800px) 86vw, (max-width: 1500px) 64vw, 1040px"
            aria-hidden="true"
          />
        </div>
        <span className={styles.celestialLightSweep} />
      </div>

      <div className="tc-container tc-client-shell">
        <section className="tc-client-hero">
          <div className="tc-hero-top">
            <div style={{ display: "grid", gap: 14 }}>
              <div className="tc-brand-badge">
                <div className="tc-brand-logo">
                  <Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={58} height={58} priority style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="tc-brand-overline">{eyebrow}</div>
                  <div className="tc-brand-title">{title}</div>
                  {subtitle ? <div className="tc-brand-copy">{subtitle}</div> : null}
                </div>
              </div>

              <div className="tc-chip" style={{ width: "fit-content", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={14} /> Tu espacio privado para consultar Coins, minutos, compras y ventajas
              </div>
            </div>

            <div className="tc-nav">
              <Link className={`tc-nav-link ${pathname === "/cliente/dashboard" ? "tc-nav-link-active" : ""}`} href="/cliente/dashboard">
                <HologramIcon compact><Home size={15} /></HologramIcon> Inicio
              </Link>
              <Link className={`tc-nav-link ${promoActive ? "tc-nav-oracle-new" : ""} ${pathname === "/cliente/precios-ofertas" ? "tc-nav-link-active" : ""}`} href="/cliente/precios-ofertas">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><HologramIcon compact><Tags size={15} /></HologramIcon> Precios y ofertas {promoActive ? <span className="tc-nav-new-badge">🔥 HOY</span> : null}</span>
              </Link>
              <Link className={`tc-nav-link tc-nav-oracle-new ${pathname === "/cliente/oraculo" ? "tc-nav-link-active" : ""}`} href="/cliente/oraculo">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <HologramIcon compact tone="gold"><WandSparkles size={15} /></HologramIcon> Oráculo <span className="tc-nav-new-badge">NUEVO</span>
                </span>
              </Link>
              <Link className={`tc-nav-link tc-nav-oracle-new ${pathname === "/cliente/ruleta" ? "tc-nav-link-active" : ""}`} href="/cliente/ruleta">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <HologramIcon compact tone="oracle"><Sparkles size={15} /></HologramIcon> Ruleta <span className="tc-nav-new-badge">NUEVO</span>
                </span>
              </Link>
              <Link className={`tc-nav-link tc-nav-oracle-new ${pathname === "/cliente/sorteo" ? "tc-nav-link-active" : ""}`} href="/cliente/sorteo">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <HologramIcon compact tone="gold"><Gift size={15} /></HologramIcon> Sorteo <span className="tc-nav-new-badge">NUEVO</span>
                </span>
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/tarotistas" ? "tc-nav-link-active" : ""}`} href="/cliente/tarotistas">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <HologramIcon compact tone="cyan"><MoonStar size={15} /></HologramIcon> Tarotistas
                </span>
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/resenas" ? "tc-nav-link-active" : ""}`} href="/cliente/resenas">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><HologramIcon compact><Star size={15} /></HologramIcon> Reseñas</span>
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/notificaciones" ? "tc-nav-link-active" : ""}`} href="/cliente/notificaciones">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <HologramIcon compact tone="rose"><BellRing size={15} /></HologramIcon> Notificaciones
                  {unreadNotifications > 0 ? (
                    <span className={styles.notificationBadge} aria-label={`${unreadNotifications} notificaciones sin leer`}>
                      {unreadNotifications > 99 ? "99+" : unreadNotifications}
                    </span>
                  ) : null}
                </span>
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/perfil" ? "tc-nav-link-active" : ""}`} href="/cliente/perfil">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <HologramIcon compact tone="cyan"><UserCircle2 size={15} /></HologramIcon> Perfil
                </span>
              </Link>
              <button type="button" className="tc-nav-link" onClick={logout}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <HologramIcon compact tone="rose"><LogOut size={15} /></HologramIcon> Salir
                </span>
              </button>
            </div>
          </div>

          {summaryItems.length ? (
            <div className="tc-hero-summary">
              {summaryItems.map((item) => {
                const normalized = item.label.toLowerCase();
                const tone = item.tone || (normalized.includes("rango")
                  ? "rank"
                  : normalized.includes("puntos") || normalized.includes("coins")
                  ? "points"
                  : normalized.includes("minutos")
                  ? "minutes"
                  : normalized.includes("notificaciones")
                  ? "alerts"
                  : normalized.includes("tiradas")
                  ? "oracle"
                  : "default");
                const hasAlert = tone === "alerts" && Number(item.value || 0) > 0;
                const content = <div className={styles.summaryContent}>
                  <div className={styles.summaryCopy}>
                    <div className="tc-kpi-label">{item.label}</div>
                    <div className="tc-kpi-value">{item.value}</div>
                    {item.meta ? <div className="tc-kpi-meta">{item.meta}</div> : null}
                  </div>
                  <SummaryIcon label={item.label} tone={tone} />
                </div>;
                return item.href ? (
                  <Link key={item.label} href={item.href} className="tc-kpi tc-kpi-link" data-tone={tone} data-alert={hasAlert ? "true" : "false"}>{content}</Link>
                ) : (
                  <div key={item.label} className="tc-kpi" data-tone={tone} data-alert={hasAlert ? "true" : "false"}>{content}</div>
                );
              })}
            </div>
          ) : null}

          <div className="tc-row" style={{ marginTop: 16, color: "rgba(255,255,255,0.64)", fontSize: 13 }}>
            <span>Diseñado para que tengas todo claro, rápido y en un solo lugar.</span>
            <ChevronRight size={15} />
            <span>Panel privado</span>
            <ChevronRight size={15} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><BellRing size={14} /> acceso protegido</span>
          </div>
        </section>

        {children}
      </div>
    </div>
  );
}

