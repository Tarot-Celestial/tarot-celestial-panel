"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import TarotistaRanksLegacyPanel from "./TarotistaRanksLegacyPanel";
import TarotistaPercentageRanksDraft from "./TarotistaPercentageRanksDraft";
import styles from "./TarotistaRanksModePanel.module.css";

const sb = supabaseBrowser();
async function getToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}
/** Preserves the live editor. Opening the new draft is a read, not a migration. */
export default function TarotistaRanksAdminPanel() {
  const [draftView, setDraftView] = useState(false);
  const [rows, setRows] = useState<Array<{code: string; benefit_config?: any}>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function openDraft() {
    setBusy(true); setError("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Vuelve a iniciar sesión para abrir la propuesta.");
      const response = await fetch("/api/admin/tarotista-ranks", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok || !body.ok || !Array.isArray(body.ranks) || body.ranks.length !== 4) throw new Error(body.error || "No se ha podido leer la configuración vigente.");
      setRows(body.ranks); setDraftView(true);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo abrir la propuesta."); }
    finally { setBusy(false); }
  }
  return <>
    <div hidden={draftView}>
      <aside className={styles.banner}>
        <div><strong>Prepara los nuevos rangos por porcentajes</strong><p>Simula Cliente y Repite, revisa beneficios y consulta la vista previa. No cambia pagos ni rangos vigentes.</p></div>
        <button type="button" disabled={busy} onClick={() => void openDraft()}>{busy ? "Leyendo configuración…" : "Abrir propuesta y simulación"}</button>
      </aside>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <TarotistaRanksLegacyPanel />
    </div>
    {draftView && <TarotistaPercentageRanksDraft activeRows={rows} getToken={getToken} onBack={() => setDraftView(false)} />}
  </>;
}
