"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CheckCircle2, Clock3, Flame, Plus, RefreshCw, Search, UserRoundPlus, Users, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { REFERRALS_CHANGED, type ReferralState } from "@/lib/client-referrals";
import { ReferralProgress } from "@/components/cliente/ClientReferralRewards";
import styles from "./ClientReferralsPanel.module.css";

type Candidate = { id: string; nombre?: string | null; apellido?: string | null; telefono?: string | null; email?: string | null };
const fullName = (client: Candidate) => [client.nombre, client.apellido].filter(Boolean).join(" ") || "Cliente sin nombre";
const dateLabel = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—";
async function authHeaders() {
  const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function useCRMReferrals(clientId: string) {
  const [snapshot, setSnapshot] = useState<{ clientId: string; value: ReferralState } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    if (!clientId) { setSnapshot(null); setLoading(false); setError(""); return; }
    const current = new AbortController(); controller.current = current; setLoading(true);
    try {
      const response = await fetch(`/api/crm/referrals?cliente_id=${encodeURIComponent(clientId)}`, { headers: await authHeaders(), cache: "no-store", signal: current.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudieron consultar los referidos.");
      if (!current.signal.aborted && mounted.current) { setSnapshot({ clientId, value: result }); setError(""); }
    } catch (cause) {
      if (!current.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : "No se pudieron consultar los referidos.");
    } finally { if (mounted.current && controller.current === current) setLoading(false); }
  }, [clientId]);
  useEffect(() => {
    setError(""); void refresh();
    const update = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(update, 20000);
    window.addEventListener("focus", update); window.addEventListener(REFERRALS_CHANGED, update);
    return () => { window.clearInterval(timer); controller.current?.abort(); window.removeEventListener("focus", update); window.removeEventListener(REFERRALS_CHANGED, update); };
  }, [refresh]);
  return { data: snapshot?.clientId === clientId ? snapshot.value : null, loading, error, refresh };
}
type ReferralController = ReturnType<typeof useCRMReferrals>;

export function CRMReferralProgress({ clientName, state }: { clientName: string; state: ReferralController }) {
  return <aside className={styles.progressCard} aria-label={`Premios por referidos de ${clientName}`}>
    <div className={styles.heading}><div><span className={styles.eyebrow}>SUS RECOMENDACIONES SUMAN</span><h2><Flame size={20} aria-hidden="true" />Premios por referidos</h2></div></div>
    <p className={styles.clientName}>{clientName}</p>
    {state.error ? <div className={styles.error} role="alert">{state.error}<button type="button" className={styles.secondary} onClick={() => void state.refresh()} disabled={state.loading}>Volver a consultar</button></div> : state.data ? <><ReferralProgress summary={state.data.summary} rewards={state.data.rewards} claimMode={state.data.claim_mode} compact /><p className={styles.hint}>El cliente reclama desde «Mi camino → Mis referidos». Cada premio utiliza los referidos que indica.</p></> : <p className={styles.hint} role="status">Consultando su progreso…</p>}
  </aside>;
}

export default function ClientReferralsPanel({ clientId, clientName, state }: { clientId: string; clientName: string; state: ReferralController }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const writing = useRef(false);
  const mounted = useRef(true);
  const operation = useRef<string | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!open || query.trim().length < 2) { setCandidates([]); setSearchError(""); setSearching(false); return () => controller.abort(); }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/crm/referrals?q=${encodeURIComponent(query.trim())}`, { headers: await authHeaders(), cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo buscar al cliente.");
        if (!controller.signal.aborted) { setCandidates((result.clients || []).filter((client: Candidate) => client.id !== clientId)); setSearchError(""); }
      } catch (cause) { if (!controller.signal.aborted) setSearchError(cause instanceof Error ? cause.message : "No se pudo buscar al cliente."); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, clientId]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!selected || writing.current) return;
    writing.current = true; setBusy(true); setError(""); setMessage("");
    operation.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/crm/referrals", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "add", cliente_id: clientId, referred_cliente_id: selected.id, operation_id: operation.current }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo añadir el referido.");
      await state.refresh();
      if (!mounted.current) return;
      setMessage(`Vínculo guardado: ${fullName(selected)} es referido de ${clientName}.`);
      setSelected(null); setQuery(""); setOpen(false); operation.current = null;
      window.dispatchEvent(new Event(REFERRALS_CHANGED));
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "No se ha confirmado el vínculo. Actualiza para comprobar su estado."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className={styles.root} aria-labelledby={`client-referrals-${clientId}`}>
    <div className={styles.heading}><div><h2 id={`client-referrals-${clientId}`}><Users size={18} aria-hidden="true" />Referidos <span className={styles.count}>{state.data?.summary.total ?? "—"}</span></h2><p>Cuenta cuando supera 10 € en compras confirmadas, aunque sean varias compras.</p></div><div className={styles.actions}><button type="button" className={styles.iconButton} aria-label="Actualizar referidos" disabled={state.loading || busy} onClick={() => void state.refresh()}><RefreshCw size={16} aria-hidden="true" /></button><button type="button" className={styles.secondary} aria-expanded={open} disabled={busy} onClick={() => { setOpen(value => !value); setError(""); }}><Plus size={16} aria-hidden="true" />Añadir referido</button></div></div>
    {open && <form className={styles.addForm} onSubmit={add}>
      <div className={styles.formHeading}><strong>¿A quién recomendó {clientName}?</strong><button className={styles.iconButton} type="button" aria-label="Cerrar búsqueda de referidos" disabled={busy} onClick={() => setOpen(false)}><X size={16} aria-hidden="true" /></button></div>
      <label className={styles.searchLabel}><Search size={17} aria-hidden="true" /><span className={styles.srOnly}>Buscar cliente por nombre, teléfono o correo</span><input disabled={busy} value={query} autoComplete="off" placeholder="Buscar nombre, teléfono o correo…" onChange={event => { setQuery(event.target.value); setSelected(null); operation.current = null; }} /></label>
      <div className={styles.candidates} aria-live="polite">
        {searchError ? <p className={styles.error}>{searchError}</p> : searching ? <p className={styles.hint}>Buscando clientes…</p> : query.trim().length >= 2 && !candidates.length ? <p className={styles.hint}>No se encontraron clientes. Crea primero su ficha en el CRM.</p> : candidates.map(candidate => <button type="button" className={styles.candidate} key={candidate.id} aria-pressed={selected?.id === candidate.id} disabled={busy} onClick={() => { setSelected(candidate); operation.current = null; }}><UserRoundPlus size={18} aria-hidden="true" /><span><strong>{fullName(candidate)}</strong><small>{candidate.telefono || candidate.email || "Sin datos de contacto"}</small></span>{selected?.id === candidate.id && <CheckCircle2 size={18} aria-hidden="true" />}</button>)}
      </div>
      {selected && <div className={styles.confirmation}><span><b>{fullName(selected)}</b> quedará vinculado a <b>{clientName}</b>. El sistema comprobará sus compras.</span><button className={styles.primary} type="submit" disabled={busy}>{busy ? "Guardando…" : "Vincular referido"}</button></div>}
    </form>}
    {(error || state.error) && <p className={styles.error} role="alert">{error || state.error}</p>}
    {message && <p className={styles.success} role="status"><Check size={16} aria-hidden="true" />{message}</p>}
    {!state.data && state.loading ? <p className={styles.hint} role="status">Consultando referidos…</p> : state.data && !state.data.referrals.length ? <p className={styles.empty}>Todavía no hay referidos vinculados a esta ficha.</p> : <div className={styles.referralList}>{state.data?.referrals.map(referral => <article className={styles.referral} key={referral.id}><span className={styles.person}>{referral.name.slice(0, 1).toLocaleUpperCase("es-ES") || "C"}</span><div className={styles.referralCopy}><strong>{referral.name}</strong><small>{dateLabel(referral.created_at)}{referral.status === "claimed" && referral.reward_title ? ` · ${referral.reward_title}` : ""}</small>{referral.status === "pending" && <small>Pendiente de superar 10 € en compras</small>}</div><span className={styles.status} data-status={referral.status}>{referral.status === "claimed" ? <><CheckCircle2 size={13} aria-hidden="true" />Reclamado</> : referral.status === "available" ? <><Check size={13} aria-hidden="true" />Disponible</> : <><Clock3 size={13} aria-hidden="true" />Pendiente</>}</span></article>)}</div>}
  </section>;
}
