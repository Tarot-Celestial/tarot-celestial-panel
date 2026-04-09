"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, UserCircle2 } from "lucide-react";
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
          <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="tc-row" style={{ gap: 12, alignItems: "center" }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 20,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(255,255,255,.04)",
                    border: "1px solid rgba(255,255,255,.08)",
                    overflow: "hidden",
                    padding: 8,
                  }}
                >
                  <Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={42} height={42} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
                <div>
                  <div className="tc-title" style={{ fontSize: 24 }}>Área de cliente</div>
                  <div className="tc-sub">Tarot Celestial · acceso seguro con teléfono</div>
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{title}</div>
              {subtitle ? <div className="tc-muted">{subtitle}</div> : null}
            </div>

            <div className="tc-row" style={{ flexWrap: "wrap" }}>
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
