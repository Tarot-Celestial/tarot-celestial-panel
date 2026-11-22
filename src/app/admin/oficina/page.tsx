"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import OfficeWorkspace from "@/features/office/OfficeWorkspace";
import type { OfficeSnapshot } from "@/features/office/model";
import { OfficeRequestError, officeRequest } from "@/features/office/office-client";
import { loadPanelIdentity, panelPathForRole, panelSessionRejected, redirectToLogin } from "@/lib/panel-access";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "@/features/office/OfficeWorkspace.module.css";

export const dynamic = "force-dynamic";

export default function OfficePage() {
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null);
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const lastRequest = useRef(0);
  const principal = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const epoch = generation.current;
    const request = ++lastRequest.current;
    const result = await officeRequest<OfficeSnapshot>("/api/admin/oficina");
    if (epoch === generation.current && request === lastRequest.current) {
      setSnapshot(result);
      setProblem("");
    }
  }, []);

  useEffect(() => {
    const client = supabaseBrowser();
    const epoch = ++generation.current;
    function reset() {
      ++generation.current;
      setSnapshot(null);
      setProblem("");
      setAttempt(value => value + 1);
    }
    function deny() {
      ++generation.current;
      setSnapshot(null);
      setProblem("Tu sesión ya no tiene acceso a la Oficina.");
    }
    window.addEventListener("tc-office-access-changed", deny);
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        deny();
        redirectToLogin("oficina");
      } else if (session && principal.current && principal.current !== session.user.id) {
        principal.current = session.user.id;
        reset();
      }
    });
    void (async () => {
      try {
        const identity = await loadPanelIdentity(client);
        if (generation.current !== epoch) return;
        if (identity.can_admin !== true) {
          window.location.replace(panelPathForRole(identity.role));
          return;
        }
        principal.current = (identity.user as { id?: string } | undefined)?.id || null;
        await reload();
      } catch (error) {
        if (generation.current !== epoch) return;
        if (panelSessionRejected(error) || (error instanceof OfficeRequestError && error.status === 401)) {
          redirectToLogin("oficina");
          return;
        }
        setProblem(error instanceof Error ? error.message : "No se pudo abrir la Oficina.");
      }
    })();
    return () => {
      ++generation.current;
      subscription.unsubscribe();
      window.removeEventListener("tc-office-access-changed", deny);
    };
  }, [attempt, reload]);

  if (!snapshot) return <main className={styles.gate}>
    <div><h1>Oficina Celestial</h1><p role={problem ? "alert" : "status"}>{problem || "Comprobando acceso…"}</p>
      {problem && <button type="button" onClick={() => { setProblem(""); setAttempt(value => value + 1); }}>Reintentar acceso</button>}
    </div>
  </main>;
  return <div className={styles.page}><AppHeader /><OfficeWorkspace key={snapshot.actorId} data={snapshot} reload={reload}/></div>;
}
