"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import { announceLeoCelestial } from "@/lib/leo-celestial-events";
import { DIAMOND_DAILY_INSTRUCTIONS, DIAMOND_MANUAL_INSTRUCTIONS, type DiamondBenefit } from "@/lib/diamond-roulette";
import { CLIENT_PURCHASE_CALL_OPTIONS } from "@/lib/client-purchase-maintenance";
import styles from "./DiamondRewardBenefits.module.css";

const sb = supabaseClienteBrowser();

export function DiamondPrizeContact({ reference }: { reference: string }) {
  return <div className={styles.contact}>
    <p>{DIAMOND_MANUAL_INSTRUCTIONS}</p>
    <p>Referencia del premio: <strong>{reference}</strong></p>
    <div className={styles.links}>{CLIENT_PURCHASE_CALL_OPTIONS.map(option => <a key={option.country} href={option.href}>Llamar · {option.country}: {option.number}</a>)}</div>
  </div>;
}

export default function DiamondRewardBenefits() {
  const [state, setState] = useState<{ cliente_id: string; benefits: DiamondBenefit[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const claiming = useRef(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      if (!token) return;
      const response = await fetch("/api/cliente/ruleta/diamond-rewards", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "No se han podido cargar tus premios Diamante.");
      if (mounted.current) { setState(json); setError(""); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "No se han podido cargar tus premios Diamante.");
    } finally { if (mounted.current) setLoaded(true); }
  }, []);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);
  useRouletteSignal(sb, state?.cliente_id, load);
  useEffect(() => {
    window.addEventListener("tc-client-balances-changed", load);
    return () => window.removeEventListener("tc-client-balances-changed", load);
  }, [load]);

  useEffect(() => {
    const due = state?.benefits.find(benefit => benefit.can_claim);
    if (!due || !state) return;
    const key = `diamond-daily:${state.cliente_id}:${due.id}:${due.business_day}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "shown"); } catch { /* No persistent browser storage is required to claim. */ }
    announceLeoCelestial({ id: key, reaction: "gift", title: "¡Tienes minutos Diamante por reclamar!", message: `Tu premio ${due.reward_name} tiene ${due.daily_minutes} minutos disponibles hoy. Pulsa Reclamar en tus premios Diamante.`, href: "/cliente/dashboard#premios-diamante", actionLabel: "Reclamar mis minutos", duration: 12000 });
  }, [state]);

  async function claim(benefit: DiamondBenefit) {
    if (claiming.current) return;
    claiming.current = true;
    setBusy(benefit.id); setError(""); setMessage("");
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Tu sesión ha caducado.");
      const response = await fetch("/api/cliente/ruleta/diamond-rewards", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entitlement_id: benefit.id }), signal: AbortSignal.timeout(15000),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo confirmar el premio. Puedes reintentar con seguridad.");
      if (!mounted.current) return;
      setMessage(json.duplicate ? `Ya habías recibido los ${json.minutes} minutos de hoy. No se han duplicado.` : `¡Ya tienes tus ${json.minutes} minutos de hoy en el saldo FREE!`);
      window.dispatchEvent(new Event("tc-client-balances-changed"));
      await load();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "No se pudo confirmar el premio. Puedes reintentar con seguridad."); }
    finally { claiming.current = false; if (mounted.current) setBusy(""); }
  }

  if (!loaded || (!state?.benefits.length && !error)) return null;
  return <section id="premios-diamante" className={styles.panel} data-leo-anchor="diamond-daily-prize" aria-labelledby="diamond-prizes-title">
    <h2 id="diamond-prizes-title">Tus premios Diamante</h2>
    {error && <div role="alert"><p>{error}</p><button onClick={() => void load()}>Volver a cargar</button></div>}
    {message && <p role="status">{message}</p>}
    <div className={styles.grid}>{state?.benefits.map(benefit => <article className={styles.card} key={benefit.id}>
      <h3>{benefit.reward_name}</h3>
      {benefit.delivery_kind === "manual" ? <>
        <p>{benefit.status === "completed" ? "Premio gestionado por Tarot Celestial." : "Premio ganado · Pendiente de gestión"}</p>
        {benefit.status !== "completed" && <DiamondPrizeContact reference={benefit.spin_id}/>}
      </> : <>
        <p>{DIAMOND_DAILY_INSTRUCTIONS}</p>
        <p><strong>{benefit.claims_used} de {benefit.total_claims} días reclamados</strong></p>
        {benefit.expires_at && <p>Disponible hasta el {new Date(benefit.expires_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} (hora de España).</p>}
        <button disabled={!!busy || !benefit.can_claim} onClick={() => void claim(benefit)}>
          {busy === benefit.id ? "Acreditando…" : benefit.status === "expired" ? "Plazo terminado" : benefit.status === "completed" ? "Premio completado" : benefit.claimed_today ? "Minutos de hoy recibidos" : benefit.can_claim ? `Reclamar ${benefit.daily_minutes} minutos de hoy` : "Todavía no disponible"}
        </button>
        {benefit.claimed_today && benefit.status === "active" && benefit.next_claim_at && benefit.expires_at && new Date(benefit.next_claim_at) < new Date(benefit.expires_at) && <p>Vuelve mañana para reclamar tus próximos minutos.</p>}
      </>}
    </article>)}</div>
  </section>;
}
