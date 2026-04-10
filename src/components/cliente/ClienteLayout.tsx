"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, ChevronRight, LogOut, Sparkles, UserCircle2, WandSparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ReactNode, useEffect } from "react";

const sb = supabaseBrowser();

type SummaryItem = {
  label: string;
  value: string;
  meta?: string;
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
    <div className="tc-wrap">
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
                <Sparkles size={14} /> Tu espacio privado para consultar puntos, minutos, compras y ventajas
              </div>
            </div>

            <div className="tc-nav">
              <Link className={`tc-nav-link ${pathname === "/cliente/dashboard" ? "tc-nav-link-active" : ""}`} href="/cliente/dashboard">
                Inicio
              </Link>
              <Link className={`tc-nav-link ${pathname === "/cliente/oraculo" ? "tc-nav-link-active" : ""}`} href="/cliente/oraculo">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <WandSparkles size={16} /> Oráculo
                </span>
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
              {summaryItems.map((item) => (
                <div key={item.label} className="tc-kpi">
                  <div className="tc-kpi-label">{item.label}</div>
                  <div className="tc-kpi-value">{item.value}</div>
                  {item.meta ? <div className="tc-kpi-meta">{item.meta}</div> : null}
                </div>
              ))}
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
