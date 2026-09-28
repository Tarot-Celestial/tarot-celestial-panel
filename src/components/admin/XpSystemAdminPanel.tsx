"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertTriangle,
  Award,
  Bolt,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Coins,
  Crown,
  Database,
  Gift,
  HeartHandshake,
  History,
  Link2,
  Medal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  WandSparkles,
  X,
  XCircle,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./XpSystemAdminPanel.module.css";
import AdminXpCoinConfig from "./AdminXpCoinConfig";
import AdminRewardStore from "./AdminRewardStore";
import { backgroundFetch } from "@/lib/background-fetch";

type IntegrationStatus = "connected" | "pending" | "error";
type TriggerType = "event" | "threshold" | "manual";
type Rule = {
  action_key: string;
  name: string;
  description: string;
  xp_reward: number;
  frequency: string;
  enabled: boolean;
  integration_status: IntegrationStatus;
  category?: string | null;
  source_key?: string | null;
  trigger_type?: TriggerType | null;
  condition_json?: { metric_key?: string; operator?: string; threshold?: number | string; period?: string } | null;
  max_awards?: number | null;
  automatic?: boolean | null;
  notes?: string | null;
  integration_error?: string | null;
  display_order?: number | null;
};

type Worker = {
  id: string;
  display_name: string;
  total_xp: number;
  xp_month: number;
  xp_today: number;
  level: number;
  level_xp: number;
  next_level_xp: number;
  clients_captured: number;
  repurchases: number;
  followups: number;
  consultations: number;
  positive_reviews: number;
  missions: number;
  coins: number | null;
  coins_spent: number | null;
  rewards_claimed: number | null;
  rewards_value: number | null;
};

type CategoryMeta = { key: string; label: string; icon: any };

const CATEGORIES: CategoryMeta[] = [
  { key: "capture", label: "Captación", icon: UserPlus },
  { key: "sales", label: "Ventas", icon: ShoppingBag },
  { key: "performance", label: "Rendimiento", icon: Activity },
  { key: "fidelity", label: "Fidelización", icon: HeartHandshake },
  { key: "operations", label: "Operativa", icon: Settings2 },
  { key: "rank", label: "Rango", icon: Crown },
  { key: "bonus", label: "Bonus", icon: Gift },
  { key: "custom", label: "Personalizada", icon: WandSparkles },
];

const SOURCES = [
  ["capture", "Captación / CRM"],
  ["payments", "Compras / Pagos"],
  ["performance", "Rendimiento"],
  ["calls", "Llamadas"],
  ["followups", "Seguimientos"],
  ["invoices", "Facturas"],
  ["levels", "Niveles / Rangos"],
  ["manual", "Administración manual"],
  ["custom", "Integración personalizada"],
];

const FREQUENCIES = [
  ["per_client", "Una vez por cliente"],
  ["daily", "Una vez al día"],
  ["shift", "Una vez por turno"],
  ["weekly", "Una vez por semana"],
  ["monthly", "Una vez por periodo mensual"],
  ["global_once", "Una sola vez global"],
  ["unlimited", "Sin límite"],
];

const METRICS = [
  ["minutes_total", "Minutos trabajados"],
  ["minutes_cliente", "Minutos Cliente"],
  ["minutes_repite", "Minutos Repite"],
  ["calls_total", "Llamadas válidas"],
  ["revenue_total", "Facturación generada"],
  ["payments_count", "Compras registradas"],
  ["clients_captured", "Clientes captados"],
  ["repurchases", "Recompras"],
  ["followups", "Seguimientos"],
  ["consultations", "Consultas"],
  ["positive_reviews", "Valoraciones positivas"],
  ["xp_period", "XP acumulado en el periodo"],
];

const PERIODS = [["daily", "Día"], ["weekly", "Semana"], ["monthly", "Mes"], ["lifetime", "Histórico"]];
const fmt = (n: any) => Number(n || 0).toLocaleString("es-ES");
const sb = supabaseBrowser();
const RULE_TEMPLATES: Array<{ label: string; icon: any; patch: Partial<Rule> }> = [
  { label: "Captar clienta", icon: UserPlus, patch: { action_key: "client_capture", name: "Captar una nueva clienta", category: "capture", source_key: "capture", trigger_type: "event", frequency: "per_client", integration_status: "connected", automatic: true, description: "Se concede cuando una nueva clienta queda captada de forma válida por la telefonista." } },
  { label: "Compra en turno", icon: ShoppingBag, patch: { action_key: "cualquier_cliente_que_realiza_compra_en_su_turno_de_conexion", name: "Compra en tu cargo", category: "sales", source_key: "payments", trigger_type: "event", frequency: "unlimited", integration_status: "connected", automatic: true, description: "Premia compras válidas registradas durante la actividad de la telefonista." } },
  { label: "2ª compra captada", icon: HeartHandshake, patch: { action_key: "segunda_compra_captada", name: "Segunda compra de una clienta captada", category: "fidelity", source_key: "payments", trigger_type: "event", frequency: "per_client", integration_status: "pending", automatic: true, description: "Se concede una sola vez cuando una clienta captada realiza su segunda compra válida." } },
  { label: "Objetivo minutos", icon: Activity, patch: { action_key: "objetivo_minutos_mensual", name: "Objetivo mensual de minutos", category: "performance", source_key: "performance", trigger_type: "threshold", frequency: "monthly", integration_status: "connected", automatic: true, description: "Premia alcanzar un mínimo de minutos válidos durante el mes.", condition_json: { metric_key: "minutes_total", operator: "gte", threshold: 500, period: "monthly" } } },
  { label: "Objetivo captación", icon: Target, patch: { action_key: "objetivo_captacion_mensual", name: "Objetivo mensual de captación", category: "capture", source_key: "capture", trigger_type: "threshold", frequency: "monthly", integration_status: "connected", automatic: true, description: "Premia alcanzar un número mínimo de clientas captadas durante el mes.", condition_json: { metric_key: "clients_captured", operator: "gte", threshold: 4, period: "monthly" } } },
  { label: "Objetivo facturación", icon: CircleDollarSign, patch: { action_key: "objetivo_facturacion_mensual", name: "Objetivo mensual de facturación", category: "sales", source_key: "performance", trigger_type: "threshold", frequency: "monthly", integration_status: "connected", automatic: true, description: "Premia alcanzar un objetivo real de facturación durante el periodo.", condition_json: { metric_key: "revenue_total", operator: "gte", threshold: 500, period: "monthly" } } },
];

function slugRuleKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const defaultRule = (): Rule => ({
  action_key: "",
  name: "",
  description: "",
  xp_reward: 0,
  frequency: "per_client",
  enabled: true,
  integration_status: "pending",
  category: "custom",
  source_key: "custom",
  trigger_type: "event",
  condition_json: { metric_key: "clients_captured", operator: "gte", threshold: 1, period: "monthly" },
  max_awards: null,
  automatic: true,
  notes: "",
  integration_error: "",
  display_order: 100,
});

function categoryMeta(rule: Rule) {
  return CATEGORIES.find((item) => item.key === String(rule.category || "custom")) || CATEGORIES[CATEGORIES.length - 1];
}

function optionLabel(options: string[][], value: string | null | undefined) {
  return options.find(([key]) => key === String(value || ""))?.[1] || String(value || "—");
}

function frequencyLabel(value: string) {
  return optionLabel(FREQUENCIES, value) || value;
}

function integrationLabel(status: IntegrationStatus) {
  if (status === "connected") return "Conectada";
  if (status === "error") return "Error de integración";
  return "Pendiente de integración";
}

function conditionLabel(rule: Rule) {
  if (rule.trigger_type === "manual") return "Concesión manual desde Administración";
  if (rule.trigger_type !== "threshold") return "Se activa cuando llega el evento real de la fuente configurada";
  const c = rule.condition_json || {};
  const metric = optionLabel(METRICS, String(c.metric_key || ""));
  const operator = ({ gte: "≥", gt: ">", eq: "=", lte: "≤", lt: "<" } as Record<string, string>)[String(c.operator || "gte")] || "≥";
  const period = optionLabel(PERIODS, String(c.period || "monthly"));
  return `${metric} ${operator} ${Number(c.threshold || 0).toLocaleString("es-ES")} · ${period}`;
}

export default function XpSystemAdminPanel() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [filterWorker, setFilterWorker] = useState("");
  const [filterAction, setFilterAction] = useState("");

  const authFetch = useCallback(async (url: string, init?: RequestInit, background = false) => {
    const { data: s } = await sb.auth.getSession();
    const requestInit = {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token || ""}`, ...(init?.headers || {}) },
      cache: "no-store" as const,
    };
    return background ? backgroundFetch(url, requestInit, { key: `${init?.method || "GET"}:/api/admin/xp-system` }) : fetch(url, requestInit);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    if (!silent) setError("");
    try {
      const r = await authFetch(`/api/admin/xp-system?t=${Date.now()}`, undefined, silent);
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo cargar");
      setData(j);
      setError("");
    } catch (e: any) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setBusy(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void load();
    const refreshVisible = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(refreshVisible, 300000);
    document.addEventListener("visibilitychange", refreshVisible);
    const channel = sb.channel("admin-xp-rules-control")
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_rules" }, refreshVisible)
      .on("postgres_changes", { event: "*", schema: "public", table: "worker_xp_events" }, refreshVisible)
      .subscribe();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      void sb.removeChannel(channel);
    };
  }, [load]);

  async function saveRule(rule: Rule) {
    setBusy(true); setError("");
    try {
      const r = await authFetch("/api/admin/xp-system", { method: "POST", body: JSON.stringify({ op: "save_rule", ...rule }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar la regla");
      setEditingRule(null);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function deleteRule(rule: Rule) {
    if (!window.confirm(`¿Eliminar «${rule.name}»? La acción dejará de conceder XP, pero todo el historial permanecerá intacto.`)) return;
    setBusy(true); setError("");
    try {
      const r = await authFetch("/api/admin/xp-system", { method: "POST", body: JSON.stringify({ op: "delete_rule", action_key: rule.action_key }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo eliminar la acción");
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function quickToggle(rule: Rule) {
    await saveRule({ ...rule, enabled: !rule.enabled });
  }

  async function saveSettings(patch: any) {
    setBusy(true); setError("");
    try {
      const current = data?.settings || {};
      const r = await authFetch("/api/admin/xp-system", { method: "POST", body: JSON.stringify({ op: "save_settings", professional_mode: patch.professional_mode ?? current.professional_mode ?? true, auto_evaluate: patch.auto_evaluate ?? current.auto_evaluate ?? true }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar la configuración");
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function evaluateNow() {
    setBusy(true); setError("");
    try {
      const r = await authFetch("/api/admin/xp-system", { method: "POST", body: JSON.stringify({ op: "evaluate_rules" }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudieron evaluar las reglas");
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function saveExchange(config: any) {
    setBusy(true);
    try {
      const r = await authFetch("/api/admin/xp-system", { method: "POST", body: JSON.stringify({ op: "save_exchange_config", ...config }) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function adjust(w: Worker) {
    const raw = prompt(`Ajustar XP de ${w.display_name}. Usa positivo o negativo:`);
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || !amount) return;
    const reason = prompt("Motivo obligatorio:")?.trim();
    if (!reason) return;
    const r = await authFetch("/api/admin/xp-system", { method: "POST", body: JSON.stringify({ op: "adjust_xp", worker_id: w.id, amount, reason }) });
    const j = await r.json();
    if (!r.ok || !j.ok) { setError(j.error || "Error"); return; }
    await load();
  }

  const events = useMemo(() => (data?.events || []).filter((e: any) => (!filterWorker || e.worker_id === filterWorker) && (!filterAction || e.action_key === filterAction)), [data, filterWorker, filterAction]);
  if (!data && !error) return <div className={styles.loading}>Cargando Sistema de XP…</div>;

  const settings = data?.settings || { professional_mode: true, auto_evaluate: true, installed: false };
  const rules: Rule[] = data?.rules || [];

  return <section className={styles.page}>
    <header className={styles.hero}>
      <div><span><Sparkles size={14} /> MOTOR DE PROGRESIÓN</span><h1>Sistema de XP profesional</h1><p>Reglas reales, automatización, trazabilidad y progreso del equipo desde una sola consola.</p></div>
      <button onClick={() => load()} disabled={busy}><RefreshCw size={16} /> Actualizar</button>
    </header>

    {error ? <div className={styles.error}>{error}</div> : null}

    <section className={styles.proMode}>
      <div className={styles.proIcon}><ShieldCheck /></div>
      <div className={styles.proCopy}><span>CONFIGURACIÓN PROFESIONAL</span><h2>Modo profesional {settings.professional_mode !== false ? "activo" : "desactivado"}</h2><p>Las reglas conectadas usan fuentes reales del sistema y las reglas por objetivo se evalúan sin duplicar recompensas.</p></div>
      <div className={styles.proControls}>
        <label><input type="checkbox" checked={settings.professional_mode !== false} disabled={!settings.installed || busy} onChange={(e) => void saveSettings({ professional_mode: e.target.checked })} /><span>Modo profesional</span></label>
        <label><input type="checkbox" checked={settings.auto_evaluate !== false} disabled={!settings.installed || busy} onChange={(e) => void saveSettings({ auto_evaluate: e.target.checked })} /><span>Evaluación automática</span></label>
        <button type="button" onClick={() => void evaluateNow()} disabled={busy || settings.professional_mode === false}><Bolt size={15} /> Sincronizar reglas ahora</button>
      </div>
      {!settings.installed ? <div className={styles.installWarning}><AlertTriangle size={15} /> Ejecuta <b>SQL_XP_PROFESIONAL.sql</b> para persistir toda la configuración profesional.</div> : null}
    </section>

    <div className={styles.metrics}>
      {[
        [Bolt, "XP este mes", fmt(data.summary.xp_month)],
        [Star, "XP hoy", fmt(data.summary.xp_today)],
        [Trophy, "Nivel medio", Number(data.summary.average_level || 0).toFixed(1)],
        [Award, "Líder del mes", data.summary.top_worker?.name || "Sin datos"],
        [ShieldCheck, "Acciones activas", fmt(data.summary.active_rules)],
        [Clock3, "Pendientes", fmt(data.summary.pending_rules)],
        [AlertTriangle, "Con error", fmt(data.summary.error_rules)],
      ].map(([I, label, value]: any) => <article key={label}><I size={18} /><small>{label}</small><strong>{value}</strong></article>)}
    </div>

    <div className={styles.sectionHead}>
      <div><span>CONFIGURACIÓN DE LÓGICA</span><h2>Acciones que dan experiencia</h2><p>Define la recompensa, la fuente real, la frecuencia y la condición que dispara cada acción.</p></div>
      <button onClick={() => setEditingRule(defaultRule())}><Plus size={16} /> Añadir acción XP</button>
    </div>

    <div className={styles.rules}>
      {rules.map((rule) => <RuleCard key={rule.action_key} rule={rule} edit={() => setEditingRule(rule)} remove={() => void deleteRule(rule)} toggle={() => void quickToggle(rule)} busy={busy} />)}
      {!rules.length ? <div className={styles.empty}>No hay reglas XP configuradas.</div> : null}
    </div>

    <AdminXpCoinConfig value={data.coin_exchange} busy={busy} save={saveExchange} />
    <details className={styles.rewardDetails}><summary>Tienda de recompensas</summary><AdminRewardStore /></details>

    <div className={styles.sectionHead}><div><span>EQUIPO REAL</span><h2>Progreso de telefonistas</h2><p>Niveles y XP calculados exclusivamente desde eventos aplicados.</p></div></div>
    <div className={styles.workers}>
      {(data.workers || []).map((w: Worker) => <article className={styles.worker} key={w.id}>
        <div className={styles.workerTop}><div className={styles.avatar}>{String(w.display_name || "?")[0]}</div><div><small>PERFIL DE PROGRESIÓN</small><h3>{w.display_name}</h3></div><span>NIVEL {w.level}</span></div>
        <div className={styles.xp}><strong>{fmt(w.level_xp)} / {fmt(w.next_level_xp)} XP</strong><div><i style={{ width: `${Math.min(100, w.next_level_xp ? 100 * w.level_xp / w.next_level_xp : 0)}%` }} /></div><small>Total {fmt(w.total_xp)} · Este mes +{fmt(w.xp_month)} · Hoy +{fmt(w.xp_today)}</small></div>
        <div className={styles.workerStats}><span>Clientas <b>{fmt(w.clients_captured)}</b></span><span>Recompras <b>{fmt(w.repurchases)}</b></span><span>Seguimientos <b>{fmt(w.followups)}</b></span><span>Consultas <b>{fmt(w.consultations)}</b></span><span>Coins <b>{w.coins ?? "—"}</b></span><span>Misiones <b>{fmt(w.missions)}</b></span></div>
        <button className={styles.adjust} onClick={() => void adjust(w)}>Ajustar XP con motivo</button>
      </article>)}
    </div>

    <div className={styles.history}>
      <div className={styles.sectionHead}><div><span>AUDITORÍA</span><h2><History size={19} /> Historial de experiencia</h2><p>Cada recompensa conserva su origen, referencia y momento de aplicación.</p></div><div className={styles.filters}><select value={filterWorker} onChange={(e) => setFilterWorker(e.target.value)}><option value="">Telefonistas</option>{(data.workers || []).map((w: Worker) => <option key={w.id} value={w.id}>{w.display_name}</option>)}</select><select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}><option value="">Acciones</option>{rules.map((r) => <option key={r.action_key} value={r.action_key}>{r.name}</option>)}</select></div></div>
      {events.length ? events.map((e: any) => {
        const w = (data.workers || []).find((x: Worker) => x.id === e.worker_id);
        const r = rules.find((x) => x.action_key === e.action_key);
        return <div className={styles.event} key={e.id}><div><strong>{w?.display_name || "Telefonista"}</strong><span>{r?.name || e.action_key}</span><small>{new Date(e.created_at).toLocaleString("es-ES")} · {e.reference_label || e.origin || "Sistema"}</small></div><b className={e.xp_amount >= 0 ? styles.plus : styles.minus}>{e.xp_amount >= 0 ? "+" : ""}{fmt(e.xp_amount)} XP</b></div>;
      }) : <div className={styles.empty}>Todavía no hay eventos XP registrados.</div>}
    </div>

    {editingRule ? <RuleEditorModal rule={editingRule} busy={busy} onClose={() => setEditingRule(null)} onSave={saveRule} /> : null}
  </section>;
}

function RuleCard({ rule, edit, remove, toggle, busy }: { key?: string; rule: Rule; edit: () => void; remove: () => void; toggle: () => void; busy: boolean }) {
  const meta = categoryMeta(rule);
  const Icon = meta.icon;
  const status = (rule.integration_status || "pending") as IntegrationStatus;
  return <article className={`${styles.rule} ${!rule.enabled ? styles.ruleDisabled : ""}`}>
    <div className={styles.ruleTop}>
      <div className={styles.ruleIcon}><Icon /></div>
      <div className={styles.ruleIdentity}><span>{meta.label}</span><strong>{rule.name}</strong><small>{rule.action_key}</small></div>
      <span className={`${styles.integration} ${styles[`integration_${status}`]}`}>
        {status === "connected" ? <CheckCircle2 /> : status === "error" ? <XCircle /> : <Clock3 />}{integrationLabel(status)}
      </span>
    </div>
    <p>{rule.description || "Sin descripción."}</p>
    <div className={styles.ruleFacts}>
      <div><Bolt /><span>Recompensa</span><b>+{fmt(rule.xp_reward)} XP</b></div>
      <div><Database /><span>Fuente</span><b>{optionLabel(SOURCES, rule.source_key)}</b></div>
      <div><Target /><span>Condición</span><b>{conditionLabel(rule)}</b></div>
      <div><Clock3 /><span>Frecuencia</span><b>{frequencyLabel(rule.frequency)}</b></div>
    </div>
    {status === "error" && rule.integration_error ? <div className={styles.ruleError}><AlertTriangle /> {rule.integration_error}</div> : null}
    <footer className={styles.ruleActions}><button type="button" className={rule.enabled ? styles.on : ""} onClick={toggle} disabled={busy}>{rule.enabled ? "Activa" : "Desactivada"}</button><button type="button" onClick={edit}><Pencil /> Editar</button><button type="button" className={styles.delete} onClick={remove}><Trash2 /> Eliminar</button></footer>
  </article>;
}

function RuleEditorModal({ rule, busy, onClose, onSave }: { rule: Rule; busy: boolean; onClose: () => void; onSave: (rule: Rule) => void }) {
  const [draft, setDraft] = useState<Rule>(() => ({ ...defaultRule(), ...rule, condition_json: { ...defaultRule().condition_json, ...(rule.condition_json || {}) } }));
  const isNew = !rule.action_key;
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", key); return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", key); }; }, [onClose]);
  const patch = (changes: Partial<Rule>) => setDraft((current) => ({ ...current, ...changes }));
  const patchCondition = (key: string, value: any) => setDraft((current) => ({ ...current, condition_json: { ...(current.condition_json || {}), [key]: value } }));
  if (!mounted) return null;

  const rawFrequency = String(draft.frequency || "");
  const frequencyKnown = FREQUENCIES.some(([key]) => key === rawFrequency);
  const content = <div className={styles.backdrop} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={styles.modal} role="dialog" aria-modal="true" aria-label={isNew ? "Nueva acción XP" : `Editar ${draft.name}`}>
      <header className={styles.modalHead}><div><span>EDITOR PROFESIONAL DE REGLAS</span><h2>{isNew ? "Nueva acción XP" : draft.name}</h2><p>Configura qué ocurre, de dónde sale el dato real y cuándo se concede la recompensa.</p></div><button type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>

      {isNew ? <section className={styles.templates}><div><span>PLANTILLAS RÁPIDAS</span><p>Empieza desde una lógica habitual y ajusta lo que necesites.</p></div><div>{RULE_TEMPLATES.map((template) => { const Icon = template.icon; return <button key={template.label} type="button" onClick={() => setDraft((current) => ({ ...current, ...template.patch, condition_json: { ...(current.condition_json || {}), ...(template.patch.condition_json || {}) } }))}><Icon />{template.label}</button>; })}</div></section> : null}

      <section className={styles.modalSection}><div className={styles.modalSectionTitle}><Sparkles /><div><span>IDENTIDAD</span><h3>Qué acción estamos premiando</h3></div></div><div className={styles.modalGrid}>
        <label>Nombre<input value={draft.name} onChange={(e) => { const name = e.target.value; setDraft((current) => ({ ...current, name, action_key: isNew && !current.action_key ? slugRuleKey(name) : current.action_key })); }} placeholder="Ej. Segunda compra de una clienta captada" /></label>
        <label>Clave interna<input value={draft.action_key} disabled={!isNew} onChange={(e) => patch({ action_key: e.target.value })} placeholder="segunda_compra_captada" /><small>{isNew ? "Se normaliza automáticamente al guardar." : "La clave se bloquea para proteger el histórico."}</small></label>
        <label>Categoría<select value={draft.category || "custom"} onChange={(e) => patch({ category: e.target.value })}>{CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label>Orden<input type="number" min={1} value={draft.display_order ?? 100} onChange={(e) => patch({ display_order: Number(e.target.value) })} /></label>
        <label className={styles.full}>Descripción<textarea value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Explica cuándo debe concederse este XP." /></label>
      </div></section>

      <section className={styles.modalSection}><div className={styles.modalSectionTitle}><Link2 /><div><span>CONEXIÓN REAL</span><h3>Fuente y automatización</h3></div></div><div className={styles.modalGrid}>
        <label>Fuente de datos<select value={draft.source_key || "custom"} onChange={(e) => patch({ source_key: e.target.value })}>{SOURCES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Tipo de disparador<select value={draft.trigger_type || "event"} onChange={(e) => patch({ trigger_type: e.target.value as TriggerType })}><option value="event">Evento real</option><option value="threshold">Objetivo / umbral</option><option value="manual">Manual</option></select></label>
        <label>Estado integración<select value={draft.integration_status || "pending"} onChange={(e) => patch({ integration_status: e.target.value as IntegrationStatus })}><option value="connected">Conectada</option><option value="pending">Pendiente</option><option value="error">Error</option></select></label>
        <label>Frecuencia<select value={rawFrequency} onChange={(e) => patch({ frequency: e.target.value })}>{!frequencyKnown && rawFrequency ? <option value={rawFrequency}>Legacy · {rawFrequency}</option> : null}{FREQUENCIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Límite de concesiones<input type="number" min={1} value={draft.max_awards ?? ""} onChange={(e) => patch({ max_awards: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Sin límite" /></label>
        <div className={styles.toggleStack}><label><input type="checkbox" checked={draft.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked })} /><span>Regla activa</span></label><label><input type="checkbox" checked={draft.automatic !== false} onChange={(e) => patch({ automatic: e.target.checked })} /><span>Concesión automática</span></label></div>
        {draft.integration_status === "error" ? <label className={styles.full}>Detalle del error<input value={draft.integration_error || ""} onChange={(e) => patch({ integration_error: e.target.value })} placeholder="Qué falta por conectar o qué está fallando" /></label> : null}
      </div></section>

      {draft.trigger_type === "threshold" ? <section className={styles.modalSection}><div className={styles.modalSectionTitle}><Target /><div><span>CONDICIÓN</span><h3>Objetivo medido con datos reales</h3></div></div><div className={styles.conditionGrid}>
        <label>Métrica<select value={String(draft.condition_json?.metric_key || "clients_captured")} onChange={(e) => patchCondition("metric_key", e.target.value)}>{METRICS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Operador<select value={String(draft.condition_json?.operator || "gte")} onChange={(e) => patchCondition("operator", e.target.value)}><option value="gte">≥ Al menos</option><option value="gt">&gt; Más de</option><option value="eq">= Exactamente</option><option value="lte">≤ Como máximo</option><option value="lt">&lt; Menos de</option></select></label>
        <label>Objetivo<input type="number" min={0} step="0.01" value={draft.condition_json?.threshold ?? 0} onChange={(e) => patchCondition("threshold", Number(e.target.value))} /></label>
        <label>Periodo<select value={String(draft.condition_json?.period || "monthly")} onChange={(e) => patchCondition("period", e.target.value)}>{PERIODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <div className={styles.conditionPreview}><Database /><span>Regla resultante</span><b>{conditionLabel(draft)}</b><small>El motor crea una referencia única por trabajador, regla y periodo para impedir duplicados.</small></div>
      </div></section> : null}

      <section className={styles.modalSection}><div className={styles.modalSectionTitle}><Bolt /><div><span>RECOMPENSA</span><h3>Experiencia concedida</h3></div></div><div className={styles.rewardGrid}><label>XP otorgado<input type="number" min={0} value={draft.xp_reward} onChange={(e) => patch({ xp_reward: Math.max(0, Number(e.target.value)) })} /></label><div><CircleDollarSign /><span>Histórico protegido</span><p>Cambiar el valor afecta solo a concesiones futuras. Los eventos XP anteriores conservan la cantidad que recibieron.</p></div></div></section>

      <section className={styles.modalSection}><div className={styles.modalSectionTitle}><Database /><div><span>OBSERVACIONES</span><h3>Notas internas</h3></div></div><label className={styles.notes}><textarea value={draft.notes || ""} onChange={(e) => patch({ notes: e.target.value })} placeholder="Documenta aquí decisiones, dependencias o detalles de la integración." /></label></section>

      <footer className={styles.modalFooter}><button type="button" className={styles.cancel} onClick={onClose}>Cancelar</button><button type="button" className={styles.save} disabled={busy || !draft.name.trim() || !draft.action_key.trim()} onClick={() => onSave(draft)}><Save /> {busy ? "Guardando…" : isNew ? "Crear acción" : "Guardar cambios"}</button></footer>
    </div>
  </div>;
  return createPortal(content, document.body);
}
