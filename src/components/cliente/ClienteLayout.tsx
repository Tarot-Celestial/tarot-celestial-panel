"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, ChevronRight, Gift, Home, LogOut, Sparkles, UserCircle2, WandSparkles, MoonStar, Tags, Star } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { ReactNode, useEffect } from "react";
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

export default function ClienteLayout({ title, subtitle, eyebrow = "Tarot Celestial", summaryItems = [], children }: Props) {
  const pathname = usePathname();
  const router = useRouter();

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
    <div className={`tc-wrap ${styles.premiumShell}`}>
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
                <Home size={16} /> Inicio
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/precios-ofertas" ? "tc-nav-link-active" : ""}`} href="/cliente/precios-ofertas">
                <Tags size={16} /> Precios y ofertas
              </Link>
              <Link className={`tc-nav-link tc-nav-oracle-new ${pathname === "/cliente/oraculo" ? "tc-nav-link-active" : ""}`} href="/cliente/oraculo">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <WandSparkles size={16} /> Oráculo <span className="tc-nav-new-badge">NUEVO</span>
                </span>
              </Link>
              <Link className={`tc-nav-link tc-nav-oracle-new ${pathname === "/cliente/sorteo" ? "tc-nav-link-active" : ""}`} href="/cliente/sorteo">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <Gift size={16} /> Sorteo <span className="tc-nav-new-badge">NUEVO</span>
                </span>
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/tarotistas" ? "tc-nav-link-active" : ""}`} href="/cliente/tarotistas">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <MoonStar size={16} /> Tarotistas
                </span>
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/resenas" ? "tc-nav-link-active" : ""}`} href="/cliente/resenas">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Star size={16} /> Reseñas</span>
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/perfil" ? "tc-nav-link-active" : ""}`} href="/cliente/perfil">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <UserCircle2 size={16} /> Perfil
                </span>
              </Link>
              <button className="tc-nav-link" onClick={logout}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <LogOut size={16} /> Salir
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
                const content = <>
                  <div className="tc-kpi-label">{item.label}</div>
                  <div className="tc-kpi-value">{item.value}</div>
                  {item.meta ? <div className="tc-kpi-meta">{item.meta}</div> : null}
                </>;
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
