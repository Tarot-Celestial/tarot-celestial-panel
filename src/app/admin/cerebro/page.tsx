"use client";

export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ReservasGlobalWatcher from "@/components/reservas/ReservasGlobalWatcher";
import PaymentMotivationWatcher from "@/components/motivation/PaymentMotivationWatcher";
import { loadPanelIdentity, panelPathForRole, redirectToLogin } from "@/lib/panel-access";
import { supabaseBrowser } from "@/lib/supabase-browser";

const CelestialBrain = nextDynamic(() => import("@/features/brain/CelestialBrain"), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", color: "#e9ca7d", background: "#08060d" }}>
      Preparando el mapa auditado…
    </div>
  ),
});

const sb = supabaseBrowser();

export default function CelestialBrainPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const cachedRole = sessionStorage.getItem("tc_admin_role");
        const cachedAt = Number(sessionStorage.getItem("tc_admin_role_ts") || "0");

        if (cachedRole === "admin" && Date.now() - cachedAt < 300000) {
          if (active) setAuthorized(true);
          return;
        }

        const identity = await loadPanelIdentity(sb);
        if (!active) return;
        const role = String(identity.role || "").toLowerCase();
        sessionStorage.setItem("tc_admin_role", role);
        sessionStorage.setItem("tc_admin_role_ts", String(Date.now()));

        if (role !== "admin") {
          window.location.replace(panelPathForRole(role));
          return;
        }

        setAuthorized(true);
      } catch (error) {
        if (active) redirectToLogin(error instanceof Error ? error.message : "session");
      }
    })();

    return () => { active = false; };
  }, []);

  return (
    <>
      <AppHeader />
      <ReservasGlobalWatcher
        enabled={authorized}
        onGoToReserva={() => router.push("/admin?tab=reservas")}
      />
      <PaymentMotivationWatcher mode="admin" />
      {authorized ? (
        <CelestialBrain />
      ) : (
        <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", color: "rgba(255,255,255,.6)", background: "#08060d" }}>
          Verificando acceso de administración…
        </div>
      )}
    </>
  );
}
