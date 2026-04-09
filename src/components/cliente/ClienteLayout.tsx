"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, ShieldCheck, UserCircle2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ReactNode } from "react";

const sb = supabaseBrowser();

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export default function ClienteLayout({ title, subtitle, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await sb.auth.signOut();
    router.replace("/cliente/login");
  }

  return (
    <div className="tc-wrap">
      <div className="tc-container" style={{ display: "grid", gap: 14 }}>
        <div className="tc-card" style={{ display: "grid", gap: 12 }}>
          <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div className="tc-row" style={{ gap: 8 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 14,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(181,156,255,0.16)",
                    border: "1px solid rgba(181,156,255,0.32)",
                  }}
                >
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <div className="tc-title" style={{ fontSize: 24 }}>Área de cliente</div>
                  <div className="tc-sub">Tarot Celestial · acceso seguro con teléfono</div>
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, marginTop: 8 }}>{title}</div>
              {subtitle ? <div className="tc-muted">{subtitle}</div> : null}
            </div>

            <div className="tc-row">
              <Link className={`tc-btn ${pathname === "/cliente/dashboard" ? "tc-btn-gold" : ""}`} href="/cliente/dashboard">
                Inicio
              </Link>
              <Link className={`tc-btn ${pathname === "/cliente/perfil" ? "tc-btn-gold" : ""}`} href="/cliente/perfil">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <UserCircle2 size={16} /> Perfil
                </span>
              </Link>
              <button className="tc-btn tc-btn-danger" onClick={logout}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <LogOut size={16} /> Salir
                </span>
              </button>
            </div>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
