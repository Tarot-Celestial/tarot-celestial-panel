"use client";

export const dynamic = "force-dynamic";

import nextDynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ReservasGlobalWatcher from "@/components/reservas/ReservasGlobalWatcher";
import PaymentMotivationWatcher from "@/components/motivation/PaymentMotivationWatcher";
import BrainControlledActionsPanel from "@/features/brain/BrainControlledActionsPanel";
import { loadPanelIdentity, panelPathForRole, panelSessionRejected, redirectToLogin } from "@/lib/panel-access";
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
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessAttempt, setAccessAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setAccessError(null);

    void (async () => {
      try {
        const identity = await loadPanelIdentity(sb);
        if (!active) return;
        const role = String(identity.role || "").toLowerCase();

        if (role !== "admin") {
          window.location.replace(panelPathForRole(role));
          return;
        }

        setAuthorized(true);
      } catch (error) {
        if (!active) return;
        if (panelSessionRejected(error)) {
          redirectToLogin(error instanceof Error ? error.message : "session");
          return;
        }
        setAccessError(error instanceof Error ? error.message : "No se pudo verificar el acceso. Vuelve a intentarlo.");
      }
    })();

    return () => { active = false; };
  }, [accessAttempt]);

  if (!authorized) return (
    <div style={{ padding: 40, minHeight: "100vh", display: "grid", placeItems: "center", color: "rgba(255,255,255,.92)", background: "#08060d" }}>
      {accessError ? <div role="alert" style={{ maxWidth: 520, textAlign: "center" }}>
        <p>{accessError}</p>
        <button type="button" onClick={() => setAccessAttempt(attempt => attempt + 1)} style={{ marginTop: 16, padding: "12px 20px", borderRadius: 12, background: "#e5c276", color: "#23172f" }}>Reintentar acceso</button>
      </div> : "Verificando acceso de administración…"}
    </div>
  );

  return (
    <>
      <AppHeader />
      <ReservasGlobalWatcher
        enabled={authorized}
        onGoToReserva={() => router.push("/admin?tab=reservas")}
      />
      <PaymentMotivationWatcher mode="admin" />
      {authorized ? (
        <>
          <CelestialBrain />
          <BrainControlledActionsPanel />
        </>
      ) : (
        <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", color: "rgba(255,255,255,.6)", background: "#08060d" }}>
          Verificando acceso de administración…
        </div>
      )}
    </>
  );
}
