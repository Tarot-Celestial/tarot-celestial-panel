"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, ChevronRight, Clock3, Flame, Gift, RefreshCw, Users, X } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { REFERRALS_CHANGED, referralRewardDescription, referralRewardItems, type ReferralReward, type ReferralSummary, type ReferralSnapshot } from "@/lib/client-referrals";
import { usePortalMotion } from "./CelestialPortal";
import styles from "./ClientReferralRewards.module.css";

export { REFERRALS_CHANGED } from "@/lib/client-referrals";
type Auth = { userId: string; token: string };
type Intent = { operationId: string; reward: ReferralReward };
type Snapshot = { owner: string; data: ReferralSnapshot };
const intentKey = (userId: string) => `tc-referral-claim-v1:${userId}`;
const includesDiamanteRoulette = (reward: ReferralReward) => referralRewardItems(reward).some(item => item.reward_type === "roulette" && item.roulette_level === 5);

function persistIntent(userId: string, value: Intent | null) {
  try {
    if (value) sessionStorage.setItem(intentKey(userId), JSON.stringify(value));
    else sessionStorage.removeItem(intentKey(userId));
  } catch { /* The in-memory intent remains stable if storage is unavailable. */ }
}

function readIntent(userId: string): Intent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(intentKey(userId)) || "null");
    return value && typeof value.operationId === "string" && /^[0-9a-f-]{36}$/i.test(value.operationId)
      && value.reward && typeof value.reward.id === "string" && Number.isInteger(value.reward.version)
      && Number.isInteger(value.reward.referrals_required) && value.reward.referrals_required > 0 ? value : null;
  } catch { return null; }
}

function FireArt({ active }: { active: boolean }) {
  const id = useId().replace(/:/g, "");
  return <svg viewBox="0 0 80 100" fill="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id={id} x1="40" y1="4" x2="40" y2="94" gradientUnits="userSpaceOnUse"><stop stopColor="#fff1bd"/><stop offset=".42" stopColor="#ffbc67"/><stop offset="1" stopColor="#f2694f"/></linearGradient></defs>
    <path d="M42 4c5 24-12 28-9 44 7-3 13-13 14-22 20 16 29 33 22 50-5 14-16 20-29 20C18 96 6 81 9 64c2-12 9-22 18-30-1 11 1 18 5 20C18 28 37 20 42 4Z" fill={active ? `url(#${id})` : "#71657d"} />
    <path d="M43 54c1 11-8 16-7 24 4-2 7-5 8-9 10 12 4 23-6 23-16 0-18-15-9-24-1 9 2 11 4 11-3-10 4-16 10-25Z" fill={active ? "#fff5cf" : "#a59aaa"}/>
  </svg>;
}

/** A read-only view shared by the client dashboard and the selected CRM record. */
export function ReferralProgress({ summary, rewards, claimMode = "consume", compact = false }: {
  summary: ReferralSummary; rewards: ReferralReward[]; claimMode?: "consume" | "milestones"; compact?: boolean;
}) {
  const { running } = usePortalMotion();
  const eligible = claimMode === "milestones" ? summary.total : summary.available;
  const configured = rewards.filter(reward => reward.enabled).sort((a, b) => a.referrals_required - b.referrals_required);
  const milestones = [...new Set(configured.map(reward => reward.referrals_required))];
  const maximum = milestones.at(-1) || 1;
  const progress = Math.max(0, Math.min(100, eligible / maximum * 100));
  const next = milestones.find(value => value > eligible);
  const level = eligible === 0 ? "rest" : progress < 34 ? "spark" : progress < 75 ? "glow" : "fire";
  return <div className={styles.progressPanel} data-compact={compact} data-heat={level} data-running={running}>
    <div className={styles.countLine}><span><strong>{eligible}</strong> {claimMode === "milestones" ? "referidos confirmados" : "referidos disponibles"}</span><span className={styles.countIcon}><Users size={20} aria-hidden="true"/></span></div>
    <div className={styles.ladder}>
      <div className={styles.meterColumn}>
        <div className={styles.meter} role="progressbar" aria-label="Progreso de referidos para premios" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={Math.min(eligible, maximum)} aria-valuetext={configured.length ? `${eligible} referidos disponibles. ${next ? `Próximo escalón: ${next}.` : "Has alcanzado todos los escalones disponibles."}` : `${eligible} referidos disponibles. Aún no hay premios configurados.`}>
          <div className={styles.meterFill} style={{ height: `${progress}%` }} />
          <span className={styles.flame} style={{ bottom: `${Math.max(3, Math.min(85, progress))}%` }}><FireArt active={eligible > 0}/></span>
        </div>
        <span className={styles.baseLabel}>TU FUEGO</span>
      </div>
      <div className={styles.milestones}>
        {milestones.length ? [...milestones].reverse().map(value => {
          const unlocked = eligible >= value;
          const options = configured.filter(reward => reward.referrals_required === value);
          return <div key={value} className={styles.milestone} data-unlocked={unlocked}>
            <span className={styles.milestoneIcon}>{unlocked ? <Check size={14} aria-hidden="true"/> : <Gift size={14} aria-hidden="true"/>}</span>
            <div><strong>X{value} <small>{unlocked ? "Alcanzado" : `${value - eligible} para llegar`}</small></strong><span>{options.length === 1 ? options[0].title : `${options.length} premios para elegir`}</span></div>
          </div>;
        }) : <div className={styles.waiting}><Gift size={25} aria-hidden="true"/><strong>El próximo premio empieza contigo</strong><p>Tu central está preparando los premios. Aquí verás cada escalón cuando esté disponible.</p></div>}
      </div>
    </div>
    <p className={styles.progressHint}>{configured.length && next ? `Te ${next - eligible === 1 ? "falta 1 referido" : `faltan ${next - eligible} referidos`} para X${next}.` : configured.length ? "Elige el premio que quieres disfrutar." : "Cada referido confirmado hará crecer tu fuego."}</p>
  </div>;
}

function notifyRewardsChanged() {
  window.dispatchEvent(new Event(REFERRALS_CHANGED));
  try {
    const channel = new BroadcastChannel(REFERRALS_CHANGED);
    channel.postMessage({ changed: true }); channel.close();
  } catch { /* Focus and the periodic refresh also reconcile other tabs. */ }
}

export default function ClientReferralRewards({ compact = false }: { compact?: boolean }) {
  const [auth, setAuth] = useState<Auth | null>(null);
  const authRef = useRef<Auth | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<ReferralReward | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<Intent | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const titleId = useId();

  useEffect(() => {
    mounted.current = true;
    const sb = supabaseClienteBrowser();
    let observedAuth = false;
    const accept = (session: { user: { id: string }; access_token: string } | null) => {
      if (!mounted.current) return;
      const next = session ? { userId: session.user.id, token: session.access_token } : null;
      if (authRef.current?.userId !== next?.userId) {
        request.current?.abort(); setSnapshot(null); setError(""); setNotice("");
        pending.current = next ? readIntent(next.userId) : null;
        setReview(pending.current?.reward || null); setUncertain(Boolean(pending.current));
        busyRef.current = false; setBusy(false);
      }
      authRef.current = next;
      setAuth(previous => previous?.userId === next?.userId && previous?.token === next?.token ? previous : next);
      if (!next) setLoading(false);
    };
    const { data } = sb.auth.onAuthStateChange((_event, session) => { observedAuth = true; accept(session); });
    void sb.auth.getSession().then(({ data }) => { if (!observedAuth) accept(data.session); }).catch(() => { if (!observedAuth) accept(null); });
    return () => { mounted.current = false; request.current?.abort(); data.subscription.unsubscribe(); };
  }, []);

  const load = useCallback(async () => {
    if (!auth) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try {
      const response = await fetch("/api/cliente/referidos", { headers: { Authorization: `Bearer ${auth.token}` }, cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudieron consultar tus referidos.");
      if (!mounted.current || controller.signal.aborted || authRef.current?.userId !== auth.userId) return;
      setSnapshot({ owner: auth.userId, data: result }); setError("");
    } catch (cause) {
      if (!mounted.current || request.current !== controller || authRef.current?.userId !== auth.userId || controller.signal.aborted && !timedOut) return;
      setError(timedOut ? "La consulta está tardando. Pulsa Actualizar para volver a intentarlo." : cause instanceof Error ? cause.message : "No se pudieron consultar tus referidos.");
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && request.current === controller) setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void load();
    const refresh = () => { if (!document.hidden && !busyRef.current) void load(); };
    const timer = window.setInterval(refresh, 30000);
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel(REFERRALS_CHANGED); channel.addEventListener("message", refresh); } catch { /* Optional cross-tab refresh. */ }
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    window.addEventListener(REFERRALS_CHANGED, refresh); document.addEventListener("visibilitychange", refresh);
    return () => {
      request.current?.abort(); window.clearInterval(timer); channel?.close();
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      window.removeEventListener(REFERRALS_CHANGED, refresh); document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const state = snapshot && auth && snapshot.owner === auth.userId ? snapshot.data : null;
  const openReview = (reward: ReferralReward) => {
    if (busyRef.current) return;
    setNotice("");
    if (pending.current && pending.current.reward.id !== reward.id) {
      setReview(pending.current.reward); setUncertain(true);
      setError("Primero comprueba la reclamación anterior para saber si se completó."); return;
    }
    setReview(reward); setUncertain(Boolean(pending.current));
  };

  const claim = async () => {
    const currentAuth = authRef.current;
    if (!currentAuth || !review || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    const intent = pending.current || { operationId: crypto.randomUUID(), reward: review };
    pending.current = intent; persistIntent(currentAuth.userId, intent);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/cliente/referidos", {
        method: "POST", headers: { Authorization: `Bearer ${currentAuth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", reward_id: intent.reward.id, expected_version: intent.reward.version, operation_id: intent.operationId }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!mounted.current || authRef.current?.userId !== currentAuth.userId) return;
      if (!response.ok || !result.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          pending.current = null; persistIntent(currentAuth.userId, null); setReview(null); setUncertain(false);
          await load();
        } else setUncertain(true);
        throw new Error(result.error || "No se pudo confirmar la reclamación. Vuelve a comprobarla.");
      }
      pending.current = null; persistIntent(currentAuth.userId, null); setReview(null); setUncertain(false);
      const receipt = result.receipt;
      const deliveredTitle = typeof receipt?.title === "string" && receipt.title ? receipt.title : intent.reward.title;
      const deliveredDescription = typeof receipt?.reward_description === "string" && receipt.reward_description ? receipt.reward_description
        : Array.isArray(receipt?.reward_items) && receipt.reward_items.length ? referralRewardDescription({ ...intent.reward, reward_items: receipt.reward_items }) : referralRewardDescription(intent.reward);
      setNotice(`Premio reclamado: ${deliveredTitle}. ${deliveredDescription}.`);
      notifyRewardsChanged(); await load();
    } catch (cause) {
      if (!mounted.current || authRef.current?.userId !== currentAuth.userId) return;
      if (pending.current) setUncertain(true);
      setError(controller.signal.aborted ? "La respuesta está tardando. Comprueba esta misma reclamación antes de elegir otro premio." : cause instanceof Error ? cause.message : "No se pudo comprobar la reclamación. Vuelve a intentarlo.");
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && authRef.current?.userId === currentAuth.userId) { busyRef.current = false; setBusy(false); }
    }
  };

  const rewards = state?.rewards.filter(reward => reward.enabled).sort((a, b) => a.referrals_required - b.referrals_required) || [];
  return <section className={styles.panel} data-compact={compact} aria-labelledby={titleId}>
    <div className={styles.header}><span className={styles.headerIcon}><Flame size={23} aria-hidden="true"/></span><div><p className={styles.eyebrow}>JUNTOS, MÁS LEJOS</p><h2 id={titleId}>{compact ? "Enciende tus premios" : "Mis referidos"}</h2></div><button className={styles.iconButton} type="button" onClick={() => void load()} disabled={loading || busy || !auth} aria-label="Actualizar referidos"><RefreshCw size={16} aria-hidden="true"/></button></div>
    {notice ? <div className={styles.success} role="status"><CheckCircle2 size={19} aria-hidden="true"/><span>{notice}</span></div> : null}
    {error ? <div className={styles.error} role="alert"><p>{error}</p>{!review ? <button type="button" className={styles.textButton} onClick={() => void load()} disabled={loading || busy}>Reintentar</button> : null}</div> : null}
    {pending.current && !review && auth ? <div className={styles.pendingClaim} role="status"><p>Hay una reclamación pendiente de comprobar.</p><button type="button" className={styles.secondaryButton} onClick={() => { setReview(pending.current?.reward || null); setUncertain(true); }}>Comprobar mi premio</button></div> : null}
    {!auth && !loading ? <p className={styles.empty}>Inicia sesión para ver tu progreso. <Link href="/cliente/login?next=referidos">Entrar a mi panel</Link></p> : !state ? <div className={styles.loading} role="status"><Flame size={28} aria-hidden="true"/><span>{loading ? "Consultando tus referidos…" : "Tu progreso aparecerá cuando se complete la consulta."}</span></div> : <>
      <ReferralProgress summary={state.summary} rewards={rewards} compact={compact}/>
      <p className={styles.explainer}>Un referido se activa cuando tu central lo vincula a tu ficha y sus compras confirmadas suman <strong>más de 10 €</strong>.</p>
      {compact ? <><Link href="/cliente/referidos" className={styles.primaryLink}>Ver mis premios <ArrowRight size={17} aria-hidden="true"/></Link><div className={styles.miniSummary}><span>{state.summary.pending} pendientes</span><span>{state.summary.claimed} usados</span></div></> : <>
        <div className={styles.summary} aria-label="Resumen de referidos"><div><span>Total</span><strong>{state.summary.total}</strong></div><div><span>Disponibles</span><strong>{state.summary.available}</strong></div><div><span>Pendientes</span><strong>{state.summary.pending}</strong></div><div><span>Reclamados</span><strong>{state.summary.claimed}</strong></div></div>
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>TU PRÓXIMA RECOMPENSA</span><h3>Elige cómo celebrarlo</h3></div><Gift size={25} aria-hidden="true"/></div>
        <p className={styles.explainer}>Al reclamar, recibirás todas las recompensas del premio y se usarán una sola vez los referidos indicados. Para conseguir otro, necesitarás nuevos referidos disponibles.</p>
        {rewards.length ? <div className={styles.rewardGrid}>{rewards.map(reward => <article key={reward.id} className={styles.rewardCard} data-ready={reward.claimable}>
          <div className={styles.rewardTop}><span className={styles.multiplier}>X{reward.referrals_required}</span><span className={styles.rewardState}>{reward.claimable ? "Disponible" : "Por desbloquear"}</span></div>
          <h4>{reward.title}</h4><p className={styles.rewardDescription}>{referralRewardDescription(reward)}</p>
          {includesDiamanteRoulette(reward) ? <p className={styles.lockReason}>Los giros Diamante se guardan en tu cuenta y requieren ese rango para usarlos.</p> : null}
          <span className={styles.cost}>{reward.referrals_required} {reward.referrals_required === 1 ? "referido disponible" : "referidos disponibles"}</span>
          <button type="button" className={styles.primaryButton} onClick={() => openReview(reward)} disabled={!reward.claimable || busy || Boolean(error) || loading}>Reclamar premio <ChevronRight size={16} aria-hidden="true"/></button>
          {!reward.claimable ? <small className={styles.lockReason}>{reward.unavailable_reason || `Necesitas ${Math.max(0, reward.referrals_required - state.summary.available)} referidos disponibles más.`}</small> : null}
        </article>)}</div> : <p className={styles.empty}>Todavía no hay premios publicados. Tus referidos permanecerán en tu ficha.</p>}
        <div className={styles.historyColumns}>
          <section className={styles.history}><h3><Users size={19} aria-hidden="true"/> Tus referidos</h3>{state.referrals.length ? <ul>{state.referrals.map(referral => <li key={referral.id}><div><strong>{referral.name || "Cliente referido"}</strong><small>{referral.reward_title || (referral.status === "pending" ? "Pendiente de superar 10 € en compras" : "Vinculado a tu ficha")}</small></div><span className={styles.statusBadge} data-status={referral.status}>{referral.status === "claimed" ? <CheckCircle2 size={13} aria-hidden="true"/> : <Clock3 size={13} aria-hidden="true"/>}{referral.status === "claimed" ? "Reclamado" : referral.status === "available" ? "Disponible" : "Pendiente"}</span></li>)}</ul> : <p className={styles.empty}>Tu primer referido empieza aquí. Pide a tu central que lo vincule a tu ficha.</p>}</section>
          <section className={styles.history}><h3><Gift size={19} aria-hidden="true"/> Premios reclamados</h3>{state.claims.length ? <ul>{state.claims.map(receipt => <li key={receipt.id}><div><strong>{receipt.reward_title}</strong><small>{receipt.reward_description}</small><time dateTime={receipt.created_at}>{new Date(receipt.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</time></div><span className={styles.statusBadge} data-status="claimed"><CheckCircle2 size={13} aria-hidden="true"/> Reclamado</span></li>)}</ul> : <p className={styles.empty}>Aquí guardarás cada premio que reclames.</p>}</section>
        </div>
      </>}
    </>}
    {review ? <ClaimReview reward={review} busy={busy} uncertain={uncertain} error={error} onConfirm={() => void claim()} onClose={() => { if (!busyRef.current) setReview(null); }}/> : null}
  </section>;
}

function ClaimReview({ reward, busy, uncertain, error, onConfirm, onClose }: { reward: ReferralReward; busy: boolean; uncertain: boolean; error: string; onConfirm: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} onClose={onClose}>
    <button type="button" className={styles.closeButton} onClick={onClose} disabled={busy} aria-label="Cerrar revisión"><X size={20} aria-hidden="true"/></button>
    <span className={styles.dialogArt}><Gift size={32} aria-hidden="true"/></span><p className={styles.eyebrow}>{uncertain ? "COMPROBAR RECLAMACIÓN" : "TU PREMIO ESTÁ CERCA"}</p>
    <h2 id={title}>{reward.title}</h2><p>{referralRewardDescription(reward)}</p>
    {includesDiamanteRoulette(reward) ? <p className={styles.explainer}>Los giros Diamante se guardarán en tu cuenta. Necesitas rango Diamante para utilizarlos.</p> : null}
    <div className={styles.claimCost}><span>Referidos que se usarán</span><strong>{reward.referrals_required}</strong></div>
    <p className={styles.explainer}>{uncertain ? "Comprobaremos la misma solicitud para evitar concederte el premio dos veces." : "Estos referidos quedarán marcados como Reclamados una sola vez. Todas las recompensas se añadirán juntas a tu cuenta al confirmar."}</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.dialogActions}><button className={styles.secondaryButton} type="button" onClick={onClose} disabled={busy}>Volver</button><button className={styles.primaryButton} type="button" onClick={onConfirm} disabled={busy}>{busy ? "Comprobando…" : uncertain ? "Comprobar reclamación" : "Confirmar premio"}</button></div>
  </dialog>;
}
