"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Coins, Crown, ExternalLink, Flame, Gift, History, Plus, RefreshCw, Save, Sparkles, Timer, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { MAX_REFERRAL_REWARD_ITEMS, REFERRALS_CHANGED, referralRewardDescription, referralRewardItems, type ReferralAdminClaim, type ReferralReward, type ReferralRewardItem } from "@/lib/client-referrals";
import styles from "./ClientReferralRewardsAdminPanel.module.css";

type DraftItem = { key: string; reward_type: ReferralRewardItem["reward_type"]; amount: string; roulette_level: string; rank_key: "oro" | "diamante"; rank_days: string };
type Draft = { title: string; referrals_required: string; reward_items: DraftItem[]; enabled: boolean };
const freshItem = (reward_type: DraftItem["reward_type"] = "coins", roulette_level = "1"): DraftItem => ({ key: crypto.randomUUID(), reward_type, amount: "", roulette_level, rank_key: "oro", rank_days: "7" });
const fresh = (): Draft => ({ title: "", referrals_required: "3", reward_items: [freshItem()], enabled: false });
const labels = { free_minutes: "Minutos FREE", normal_minutes: "Minutos normales", coins: "Coins", oracle: "Tiradas de Oráculo", roulette: "Giros de ruleta", rank: "Rango temporal" };
const icons = { free_minutes: Timer, normal_minutes: Timer, coins: Coins, oracle: Sparkles, roulette: Gift, rank: Crown };
const toDraft = (reward: ReferralReward): Draft => ({
  title: reward.title, referrals_required: String(reward.referrals_required), enabled: reward.enabled,
  reward_items: referralRewardItems(reward).map(item => ({ key: crypto.randomUUID(), reward_type: item.reward_type, amount: String(item.amount), roulette_level: String(item.roulette_level || 1), rank_key: item.rank_key === "diamante" ? "diamante" : "oro", rank_days: String(item.rank_days || 7) })),
});
const toItem = (item: DraftItem): ReferralRewardItem => ({ reward_type: item.reward_type, amount: item.reward_type === "rank" ? 1 : Number(item.amount), roulette_level: item.reward_type === "roulette" ? Number(item.roulette_level) : null, rank_key: item.reward_type === "rank" ? item.rank_key : null, rank_days: item.reward_type === "rank" ? Number(item.rank_days) : null });
const describeDraftItem = (item: DraftItem) => item.reward_type === "rank" ? `${item.rank_key === "diamante" ? "Diamante" : "Oro"} durante ${item.rank_days || "—"} días` : `${item.amount || "—"} ${labels[item.reward_type]}${item.reward_type === "roulette" ? ` · Nivel ${item.roulette_level}` : ""}`;

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
  const [historyRefresh, setHistoryRefresh] = useState(0);
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
  function changeItem(key: string, patch: Partial<Omit<DraftItem, "key">>) {
    setDraft(previous => ({ ...previous, reward_items: previous.reward_items.map(item => {
      if (item.key !== key) return item;
      const next = { ...item, ...patch };
      if (patch.reward_type === "roulette") {
        const levels = new Set(previous.reward_items.filter(other => other.key !== key && other.reward_type === "roulette").map(other => other.roulette_level));
        if (levels.has(next.roulette_level)) next.roulette_level = ["1", "2", "3", "4", "5"].find(level => !levels.has(level)) || "1";
      }
      return next;
    }) }));
    operation.current = null; setMessage("");
  }
  function addItem() {
    const type = (Object.keys(labels) as DraftItem["reward_type"][]).find(value => value !== "roulette" && !draft.reward_items.some(item => item.reward_type === value));
    const level = ["1", "2", "3", "4", "5"].find(value => !draft.reward_items.some(item => item.reward_type === "roulette" && item.roulette_level === value));
    if (draft.reward_items.length >= MAX_REFERRAL_REWARD_ITEMS || !type && !level) return;
    change("reward_items", [...draft.reward_items, freshItem(type || "roulette", level)]);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (writing.current || loading || stale && !uncertain) return;
    writing.current = true; setBusy(true); setError(""); setMessage("");
    operation.current ||= crypto.randomUUID();
    let ambiguous = true;
    try {
      const reward = { ...(selected ? { id: selected.id } : {}), title: draft.title.trim(), referrals_required: Number(draft.referrals_required), reward_items: draft.reward_items.map(toItem), enabled: draft.enabled };
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

  const Icon = draft.reward_items.length === 1 ? icons[draft.reward_items[0].reward_type] : Gift;
  const stale = !!selected && !!rewards.find(item => item.id === selected.id && item.version !== selected.version);
  return <section className={styles.root}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>RANGOS DE CLIENTES · REFERIDOS</span><h1>Convierte cada recomendación en un premio.</h1><p>Elige cuántos referidos necesita el cliente y las recompensas que recibirá en un solo canje.</p></div>
      <span className={styles.heroIcon} aria-hidden="true"><Flame size={45} /></span>
    </header>
    <div className={styles.toolbar}><p>Cada referido cuenta al superar 10 € en compras confirmadas. Al reclamar un premio se utilizan una sola vez los referidos que indica, aunque incluya varias recompensas.</p><button className={styles.secondary} type="button" disabled={loading || busy} onClick={() => { void load(); setHistoryRefresh(value => value + 1); }}><RefreshCw size={16} aria-hidden="true" />{loading ? "Actualizando…" : "Actualizar"}</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status"><Check size={17} aria-hidden="true" />{message}</p>}
    <div className={styles.workspace}>
      <section className={styles.card} aria-labelledby="referral-reward-list-title">
        <div className={styles.heading}><div><span className={styles.eyebrow}>TU ESCALERA DE PREMIOS</span><h2 id="referral-reward-list-title">Premios configurados</h2></div><button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={() => choose(null)}><Plus size={16} aria-hidden="true" />Nuevo</button></div>
        <div className={styles.rewardList}>
          {loading && !rewards.length ? <p className={styles.empty}>Consultando premios…</p> : !rewards.length ? <div className={styles.empty}><Gift size={35} aria-hidden="true" /><h3>Tu primer premio empieza aquí</h3><p>Configura una recompensa y actívala cuando esté lista.</p></div> : [...rewards].sort((a, b) => a.referrals_required - b.referrals_required).map(reward => <button type="button" className={styles.rewardRow} key={reward.id} aria-pressed={selected?.id === reward.id} disabled={busy || uncertain} onClick={() => choose(reward)}><span className={styles.threshold}>X{reward.referrals_required}</span><span className={styles.rewardCopy}><strong>{reward.title}</strong><span>{referralRewardDescription(reward)}</span><small data-enabled={reward.enabled}>{reward.enabled ? "Activo" : "Desactivado"}</small></span><ChevronRight size={18} aria-hidden="true" /></button>)}
        </div>
      </section>
      <section className={styles.card} aria-labelledby="referral-reward-editor-title">
        <div className={styles.heading}><div><span className={styles.eyebrow}>{selected ? "EDITAR PREMIO" : "CREAR PREMIO"}</span><h2 id="referral-reward-editor-title">{selected?.title || "Una nueva recompensa"}</h2></div><Gift size={24} aria-hidden="true" /></div>
        {stale && <div className={styles.error} role="alert">Este premio cambió en otra sesión. Selecciónalo de nuevo en la lista para cargar la versión actual.</div>}
        <form onSubmit={save} className={styles.form} aria-label="Editar premio de referidos">
          <fieldset disabled={busy || loading || stale || uncertain}>
            <label>Nombre del premio<input value={draft.title} onChange={event => change("title", event.target.value)} maxLength={100} required placeholder="Ej. Un momento para ti" /></label>
            <label>Referidos necesarios<input type="number" min="1" max="1000" step="1" required value={draft.referrals_required} onChange={event => change("referrals_required", event.target.value)} /></label>
            <div className={styles.components} role="group" aria-label="Recompensas incluidas en el premio">
              {draft.reward_items.map((item, index) => {
                const ItemIcon = icons[item.reward_type];
                const amountMax = item.reward_type === "coins" ? 1000000 : item.reward_type === "free_minutes" || item.reward_type === "normal_minutes" ? 10000 : 100;
                const otherItems = draft.reward_items.filter(other => other.key !== item.key);
                return <div className={styles.component} key={item.key}>
                  <div className={styles.componentHeading}><span><ItemIcon size={16} aria-hidden="true" />Recompensa {index + 1}</span><button type="button" className={styles.removeItem} aria-label={`Eliminar recompensa ${index + 1}`} disabled={draft.reward_items.length === 1} onClick={() => change("reward_items", draft.reward_items.filter(other => other.key !== item.key))}><Trash2 size={16} aria-hidden="true" /></button></div>
                  <label>Tipo de recompensa<select aria-label={`Tipo de recompensa ${index + 1}`} value={item.reward_type} onChange={event => changeItem(item.key, { reward_type: event.target.value as DraftItem["reward_type"] })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value} disabled={value === "roulette" ? otherItems.filter(other => other.reward_type === "roulette").length === 5 : otherItems.some(other => other.reward_type === value)}>{label}</option>)}</select></label>
                  {item.reward_type === "rank" ? <div className={styles.formGrid}><label>Rango<select aria-label={`Rango de recompensa ${index + 1}`} value={item.rank_key} onChange={event => changeItem(item.key, { rank_key: event.target.value as DraftItem["rank_key"] })}><option value="oro">Oro</option><option value="diamante">Diamante</option></select></label><label>Duración en días<input type="number" aria-label={`Duración de recompensa ${index + 1}`} required min="1" max="365" step="1" value={item.rank_days} onChange={event => changeItem(item.key, { rank_days: event.target.value })} /></label></div> : <div className={styles.formGrid}><label>Cantidad de {labels[item.reward_type].toLowerCase()}<input type="number" aria-label={`Cantidad de recompensa ${index + 1}`} min="1" max={amountMax} step="1" value={item.amount} onChange={event => changeItem(item.key, { amount: event.target.value })} required placeholder={`De 1 a ${amountMax.toLocaleString("es-ES")}`} /></label>{item.reward_type === "roulette" && <label>Tipo de ruleta<select aria-label={`Ruleta de recompensa ${index + 1}`} value={item.roulette_level} onChange={event => changeItem(item.key, { roulette_level: event.target.value })}>{["1", "2", "3", "4", "5"].map(level => <option key={level} value={level} disabled={otherItems.some(other => other.reward_type === "roulette" && other.roulette_level === level)}>{level === "4" ? "Especial · Nivel 4" : level === "5" ? "Diamante · Nivel 5" : `Nivel ${level}`}</option>)}</select></label>}</div>}
                </div>;
              })}
              <button type="button" className={styles.secondary} disabled={draft.reward_items.length >= MAX_REFERRAL_REWARD_ITEMS} onClick={addItem}><Plus size={16} aria-hidden="true" />Añadir recompensa</button>
              <p className={styles.formHint}>Todas estas recompensas se entregan juntas. El coste en referidos se aplica una sola vez.</p>
            </div>
            <label className={styles.toggle}><input type="checkbox" checked={draft.enabled} onChange={event => change("enabled", event.target.checked)} /><span><strong>Premio activo</strong><small>El cliente podrá verlo y reclamarlo cuando cumpla los requisitos.</small></span></label>
          </fieldset>
          <div className={styles.preview}><span className={styles.previewIcon}><Icon size={27} aria-hidden="true" /></span><div><small>VISTA PREVIA · X{draft.referrals_required || "—"}</small><strong>{draft.title.trim() || "Nombre de tu premio"}</strong><span>{draft.reward_items.map(describeDraftItem).join(" + ")}</span><span className={styles.previewCost}>{draft.referrals_required || "—"} {draft.referrals_required === "1" ? "referido" : "referidos"} · Un solo canje</span></div></div>
          <button type="submit" className={styles.primary} disabled={busy || loading || stale && !uncertain}><Save size={17} aria-hidden="true" />{busy ? "Guardando…" : uncertain ? "Reintentar guardado" : "Guardar premio"}</button>
        </form>
      </section>
    </div>
    <ReferralClaimsHistory rewards={rewards} refreshToken={historyRefresh} />
  </section>;
}

type HistoryFilters = { q: string; reward_id: string; from: string; to: string };
type HistorySnapshot = { key: string; claims: ReferralAdminClaim[]; total: number };
type HistoryAuth = { userId: string; token: string };
const emptyFilters = (): HistoryFilters => ({ q: "", reward_id: "", from: "", to: "" });
const HISTORY_PAGE_SIZE = 25;

function ReferralClaimsHistory({ rewards, refreshToken }: { rewards: ReferralReward[]; refreshToken: number }) {
  const [auth, setAuth] = useState<HistoryAuth | null>(null);
  const authRef = useRef<HistoryAuth | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(emptyFilters);
  const [applied, setApplied] = useState<HistoryFilters>(emptyFilters);
  const [offset, setOffset] = useState(0);
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterError, setFilterError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const request = useRef<AbortController | null>(null);
  const key = JSON.stringify([auth?.userId, applied.q, applied.reward_id, applied.from, applied.to, offset]);

  useEffect(() => {
    const sb = supabaseBrowser();
    let active = true, observedAuth = false;
    function accept(session: { user: { id: string }; access_token: string } | null) {
      if (!active) return;
      const next = session ? { userId: session.user.id, token: session.access_token } : null;
      if (authRef.current?.userId !== next?.userId) { request.current?.abort(); setSnapshot(null); }
      authRef.current = next;
      setAuth(previous => previous?.userId === next?.userId && previous?.token === next?.token ? previous : next);
      if (!next) { setLoading(false); setError("Tu sesión ha caducado. Vuelve a iniciar sesión para consultar el historial."); }
    }
    const { data } = sb.auth.onAuthStateChange((_event, session) => { observedAuth = true; accept(session); });
    void sb.auth.getSession().then(({ data }) => { if (!observedAuth) accept(data.session); }).catch(() => { if (!observedAuth) accept(null); });
    return () => { active = false; request.current?.abort(); data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!auth) return;
    const currentAuth = auth;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    let active = true, timedOut = false;
    setLoading(true); setError("");
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    async function load() {
      try {
        const params = new URLSearchParams({ ...applied, offset: String(offset), limit: String(HISTORY_PAGE_SIZE) });
        const response = await fetch(`/api/admin/referral-rewards/history?${params}`, { headers: { Authorization: `Bearer ${currentAuth.token}` }, cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!active || authRef.current?.userId !== currentAuth.userId || controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) setSnapshot(null);
        if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo cargar el historial de canjes.");
        if (active && !controller.signal.aborted) setSnapshot({ key, claims: result.claims || [], total: result.total || 0 });
      } catch (cause) {
        if (active && (!controller.signal.aborted || timedOut)) setError(timedOut ? "El historial está tardando. Pulsa Actualizar historial para intentarlo de nuevo." : cause instanceof Error ? cause.message : "No se pudo cargar el historial de canjes.");
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [auth, applied, offset, key, refresh, refreshToken]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (filters.from && filters.to && filters.from > filters.to) { setFilterError("La fecha inicial no puede ser posterior a la fecha final."); return; }
    setFilterError(""); setApplied({ ...filters, q: filters.q.trim() }); setOffset(0);
  }
  function changeFilter(field: keyof HistoryFilters, value: string) { setFilters(previous => ({ ...previous, [field]: value })); setFilterError(""); }
  function clearFilters() { setFilters(emptyFilters()); setApplied(emptyFilters()); setOffset(0); setFilterError(""); }
  const data = snapshot?.key === key ? snapshot : null;
  const total = data?.total || 0;

  return <section className={styles.card} aria-labelledby="referral-claims-history-title">
    <div className={styles.heading}><div><span className={styles.eyebrow}>CANJES COMPLETADOS</span><h2 id="referral-claims-history-title"><History size={21} aria-hidden="true" /> Historial de premios canjeados</h2></div><button type="button" className={styles.secondary} disabled={loading || !auth} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />Actualizar historial</button></div>
    <p className={styles.historyIntro}>Consulta lo que recibió cada cliente al canjear su premio, aunque después cambies su configuración.</p>
    <form className={styles.historyFilters} aria-label="Filtrar historial de canjes" onSubmit={applyFilters}>
      <label>Cliente o teléfono<input type="search" value={filters.q} maxLength={150} onChange={event => changeFilter("q", event.target.value)} placeholder="Buscar por nombre o número" /></label>
      <label>Premio<select value={filters.reward_id} onChange={event => changeFilter("reward_id", event.target.value)}><option value="">Todos los premios</option>{rewards.map(reward => <option key={reward.id} value={reward.id}>{reward.title}</option>)}</select></label>
      <label>Desde<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => changeFilter("from", event.target.value)} /></label>
      <label>Hasta<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => changeFilter("to", event.target.value)} /></label>
      <div className={styles.historyFilterActions}><button type="submit" className={styles.secondary} disabled={!auth}>Filtrar</button><button type="button" className={styles.clearFilters} onClick={clearFilters}>Limpiar filtros</button><span className={styles.historyTimezone}>Fechas en horario de España.</span></div>
    </form>
    {filterError ? <p className={styles.error} role="alert">{filterError}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {loading ? <p className={styles.historyLoading} role="status">Consultando canjes…</p> : null}
    {data?.claims.length ? <div className={styles.historyTableWrap} aria-busy={loading}>
      <table className={styles.historyTable}>
        <thead><tr><th scope="col">Fecha</th><th scope="col">Cliente</th><th scope="col">Premio y recompensas</th><th scope="col">Referidos usados</th><th scope="col">Estado</th></tr></thead>
        <tbody>{data.claims.map(receipt => <tr key={receipt.id}>
          <td><time dateTime={receipt.created_at}>{new Date(receipt.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time></td>
          <td><strong>{receipt.client_name || "Cliente"}</strong><span>{receipt.client_phone || "Sin teléfono"}</span><a className={styles.crmLink} href={`/admin?tab=crm&open_cliente_id=${encodeURIComponent(receipt.cliente_id)}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ficha de ${receipt.client_name || "cliente"} en otra pestaña`}>Abrir ficha<ExternalLink size={12} aria-hidden="true" /></a></td>
          <td><strong>{receipt.reward_title}</strong><span>{receipt.reward_description}</span><details className={styles.claimDetails}><summary>Ver recompensas entregadas</summary><ul>{receipt.reward_items.map((item, index) => <li key={`${item.reward_type}-${item.roulette_level ?? ""}-${index}`}>{referralRewardDescription(item)}</li>)}</ul></details></td>
          <td className={styles.referralCount}>{receipt.referrals_used}</td>
          <td><span className={styles.deliveredBadge}><CheckCircle2 size={14} aria-hidden="true" />Entregado</span></td>
        </tr>)}</tbody>
      </table>
    </div> : !loading && !error ? <p className={styles.empty}>{applied.q || applied.reward_id || applied.from || applied.to ? "No hay canjes que coincidan con estos filtros." : "Todavía no se han canjeado premios. Aquí aparecerá cada entrega completada."}</p> : null}
    {data && total > 0 ? <div className={styles.historyPagination}><span>{offset + 1}–{Math.min(offset + HISTORY_PAGE_SIZE, total)} de {total} canjes</span><div><button type="button" className={styles.secondary} disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - HISTORY_PAGE_SIZE))}><ChevronLeft size={15} aria-hidden="true" />Anterior</button><button type="button" className={styles.secondary} disabled={loading || offset + HISTORY_PAGE_SIZE >= total} onClick={() => setOffset(value => value + HISTORY_PAGE_SIZE)}>Siguiente<ChevronRight size={15} aria-hidden="true" /></button></div></div> : null}
  </section>;
}
