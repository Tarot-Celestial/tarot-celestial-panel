"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, Coins, Crown, Flame, Gift, Plus, RefreshCw, Save, Sparkles, Timer } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { REFERRALS_CHANGED, referralRewardDescription, type ReferralReward } from "@/lib/client-referrals";
import styles from "./ClientReferralRewardsAdminPanel.module.css";

type Draft = { title: string; referrals_required: string; reward_type: ReferralReward["reward_type"]; amount: string; roulette_level: string; rank_key: "oro" | "diamante"; rank_days: string; enabled: boolean };
const fresh = (): Draft => ({ title: "", referrals_required: "3", reward_type: "coins", amount: "", roulette_level: "1", rank_key: "oro", rank_days: "7", enabled: false });
const labels = { free_minutes: "Minutos FREE", normal_minutes: "Minutos normales", coins: "Coins", oracle: "Tiradas de Oráculo", roulette: "Giros de ruleta", rank: "Rango temporal" };
const icons = { free_minutes: Timer, normal_minutes: Timer, coins: Coins, oracle: Sparkles, roulette: Gift, rank: Crown };
const toDraft = (reward: ReferralReward): Draft => ({ title: reward.title, referrals_required: String(reward.referrals_required), reward_type: reward.reward_type, amount: String(reward.amount), roulette_level: String(reward.roulette_level || 1), rank_key: reward.rank_key === "diamante" ? "diamante" : "oro", rank_days: String(reward.rank_days || 7), enabled: reward.enabled });
const describe = referralRewardDescription;

async function headers() {
  const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function ClientReferralRewardsAdminPanel() {
  const [rewards, setRewards] = useState<ReferralReward[]>([]);
  const [selected, setSelected] = useState<ReferralReward | null>(null);
  const [draft, setDraft] = useState<Draft>(fresh);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const request = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const operation = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; setLoading(true);
    try {
      const response = await fetch("/api/admin/referral-rewards", { headers: await headers(), cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudieron cargar los premios.");
      if (!controller.signal.aborted && mounted.current) { setRewards(result.rewards || []); setError(""); }
      return result.rewards as ReferralReward[];
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los premios.");
      return null;
    } finally { if (mounted.current && request.current === controller) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function choose(reward: ReferralReward | null) {
    setSelected(reward); setDraft(reward ? toDraft(reward) : fresh()); setMessage(""); operation.current = null;
  }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(previous => ({ ...previous, [key]: value })); operation.current = null; setMessage("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (writing.current || loading || stale && !uncertain) return;
    writing.current = true; setBusy(true); setError(""); setMessage("");
    operation.current ||= crypto.randomUUID();
    let ambiguous = true;
    try {
      const isRank = draft.reward_type === "rank";
      const reward = { ...(selected ? { id: selected.id } : {}), title: draft.title.trim(), referrals_required: Number(draft.referrals_required), reward_type: draft.reward_type, amount: isRank ? 1 : Number(draft.amount), roulette_level: draft.reward_type === "roulette" ? Number(draft.roulette_level) : null, rank_key: isRank ? draft.rank_key : null, rank_days: isRank ? Number(draft.rank_days) : null, enabled: draft.enabled };
      const response = await fetch("/api/admin/referral-rewards", { method: "POST", headers: await headers(), body: JSON.stringify({ action: "save", operation_id: operation.current, reward, expected_version: selected?.version ?? null }) });
      const result = await response.json();
      ambiguous = response.status >= 500;
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo guardar el premio.");
      setUncertain(false);
      const current = await load();
      if (!mounted.current) return;
      const saved = result.reward || current?.find(item => item.id === (selected?.id || result.id));
      choose(saved || null);
      setMessage("Premio guardado. Los cambios ya están disponibles en el panel del cliente.");
      window.dispatchEvent(new Event(REFERRALS_CHANGED));
    } catch (cause) {
      if (mounted.current) { setUncertain(ambiguous); setError(ambiguous ? "No se ha confirmado el guardado. Usa «Reintentar guardado» con estos mismos datos para comprobarlo sin crear otro premio." : cause instanceof Error ? cause.message : "No se pudo guardar el premio."); }
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  }

  const Icon = icons[draft.reward_type];
  const amountMax = draft.reward_type === "coins" ? 1000000 : draft.reward_type === "free_minutes" || draft.reward_type === "normal_minutes" ? 10000 : 100;
  const stale = !!selected && !!rewards.find(item => item.id === selected.id && item.version !== selected.version);
  return <section className={styles.root}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>RANGOS DE CLIENTES · REFERIDOS</span><h1>Convierte cada recomendación en un premio.</h1><p>Elige cuántos referidos necesita el cliente y la recompensa que podrá reclamar.</p></div>
      <span className={styles.heroIcon} aria-hidden="true"><Flame size={45} /></span>
    </header>
    <div className={styles.toolbar}><p>Cada referido cuenta al superar 10 € en compras confirmadas. Al reclamar un premio se utilizan los referidos que indica.</p><button className={styles.secondary} type="button" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" />{loading ? "Actualizando…" : "Actualizar"}</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status"><Check size={17} aria-hidden="true" />{message}</p>}
    <div className={styles.workspace}>
      <section className={styles.card} aria-labelledby="referral-reward-list-title">
        <div className={styles.heading}><div><span className={styles.eyebrow}>TU ESCALERA DE PREMIOS</span><h2 id="referral-reward-list-title">Premios configurados</h2></div><button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={() => choose(null)}><Plus size={16} aria-hidden="true" />Nuevo</button></div>
        <div className={styles.rewardList}>
          {loading && !rewards.length ? <p className={styles.empty}>Consultando premios…</p> : !rewards.length ? <div className={styles.empty}><Gift size={35} aria-hidden="true" /><h3>Tu primer premio empieza aquí</h3><p>Configura una recompensa y actívala cuando esté lista.</p></div> : [...rewards].sort((a, b) => a.referrals_required - b.referrals_required).map(reward => <button type="button" className={styles.rewardRow} key={reward.id} aria-pressed={selected?.id === reward.id} disabled={busy || uncertain} onClick={() => choose(reward)}><span className={styles.threshold}>X{reward.referrals_required}</span><span className={styles.rewardCopy}><strong>{reward.title}</strong><span>{describe(reward)}</span><small data-enabled={reward.enabled}>{reward.enabled ? "Activo" : "Desactivado"}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}
        </div>
      </section>
      <section className={styles.card} aria-labelledby="referral-reward-editor-title">
        <div className={styles.heading}><div><span className={styles.eyebrow}>{selected ? "EDITAR PREMIO" : "CREAR PREMIO"}</span><h2 id="referral-reward-editor-title">{selected?.title || "Una nueva recompensa"}</h2></div><Gift size={24} aria-hidden="true" /></div>
        {stale && <div className={styles.error} role="alert">Este premio cambió en otra sesión. Selecciónalo de nuevo en la lista para cargar la versión actual.</div>}
        <form onSubmit={save} className={styles.form}>
          <fieldset disabled={busy || loading || stale || uncertain}>
            <label>Nombre del premio<input value={draft.title} onChange={event => change("title", event.target.value)} maxLength={100} required placeholder="Ej. Un momento para ti" /></label>
            <div className={styles.formGrid}><label>Referidos necesarios<input type="number" min="1" max="1000" step="1" required value={draft.referrals_required} onChange={event => change("referrals_required", event.target.value)} /></label><label>Tipo de premio<select value={draft.reward_type} onChange={event => change("reward_type", event.target.value as Draft["reward_type"])}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
            {draft.reward_type === "rank" ? <div className={styles.formGrid}><label>Rango<select value={draft.rank_key} onChange={event => change("rank_key", event.target.value as Draft["rank_key"])}><option value="oro">Oro</option><option value="diamante">Diamante</option></select></label><label>Duración en días<input type="number" required min="1" max="365" step="1" value={draft.rank_days} onChange={event => change("rank_days", event.target.value)} /></label></div> : <div className={styles.formGrid}><label>Cantidad de {labels[draft.reward_type].toLowerCase()}<input type="number" min="1" max={amountMax} step="1" value={draft.amount} onChange={event => change("amount", event.target.value)} required placeholder={`De 1 a ${amountMax.toLocaleString("es-ES")}`} /></label>{draft.reward_type === "roulette" && <label>Tipo de ruleta<select value={draft.roulette_level} onChange={event => change("roulette_level", event.target.value)}><option value="1">Nivel 1</option><option value="2">Nivel 2</option><option value="3">Nivel 3</option><option value="4">Especial · Nivel 4</option><option value="5">Diamante · Nivel 5</option></select></label>}</div>}
            <label className={styles.toggle}><input type="checkbox" checked={draft.enabled} onChange={event => change("enabled", event.target.checked)} /><span><strong>Premio activo</strong><small>El cliente podrá verlo y reclamarlo cuando cumpla los requisitos.</small></span></label>
          </fieldset>
          <div className={styles.preview}><span className={styles.previewIcon}><Icon size={27} aria-hidden="true" /></span><div><small>VISTA PREVIA · X{draft.referrals_required || "—"}</small><strong>{draft.title.trim() || "Nombre de tu premio"}</strong><span>{draft.reward_type === "rank" ? `${draft.rank_key === "diamante" ? "Diamante" : "Oro"} durante ${draft.rank_days || "—"} días` : `${draft.amount || "—"} ${labels[draft.reward_type]}${draft.reward_type === "roulette" ? ` · Nivel ${draft.roulette_level}` : ""}`}</span></div></div>
          <button type="submit" className={styles.primary} disabled={busy || loading || stale && !uncertain}><Save size={17} aria-hidden="true" />{busy ? "Guardando…" : uncertain ? "Reintentar guardado" : "Guardar premio"}</button>
        </form>
      </section>
    </div>
  </section>;
}
