"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Bell, CalendarClock, CheckCircle2, Clock3, MessageCircle, MoreHorizontal,
  Phone, Plus, ShoppingBag, Sparkles, StickyNote, UserPlus, X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getClientLifecycleStatus } from "./clientLifecycle";
import styles from "./MyClientFollowUps.module.css";

type Summary = Record<string, any>;
type Props = { clientId: string; client: Record<string, any>; summary: Summary; lastPurchaseAt?: string | null; onRefresh: () => void };

type FollowUp = {
  id: string; worker_id?: string | null; contact_type?: string | null; reason?: string | null; description?: string | null;
  observations?: string | null; result?: string | null; status?: string | null; priority?: string | null;
  scheduled_at?: string | null; reminder_at?: string | null; completed_at?: string | null; created_at?: string | null;
  workers?: { display_name?: string | null } | null;
};

type TimelineItem = { id: string; at: string; type: string; title: string; description: string; owner?: string; status?: string; priority?: string };

const CONTACT_TYPES = ["Llamada", "WhatsApp", "Mensaje", "Consulta", "Seguimiento general", "Recordatorio", "Otro"];
const RESULTS = ["Contactada", "Sin respuesta", "Interesada", "Volver a llamar", "Seguimiento completado", "Pendiente", "No interesada", "Otro"];

async function accessToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || null;
}
const MADRID_TIME_ZONE = "Europe/Madrid";

function dateTime(value?: string | null) {
  if (!value) return "Fecha no disponible";
  const d = new Date(value); if (Number.isNaN(d.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", { timeZone: MADRID_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}
function dateOnly(value?: string | null) {
  if (!value) return "—"; const d = new Date(value); if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", { timeZone: MADRID_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}
function madridLocalToIso(value: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute] = match;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const offsetAt = (timestamp: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return represented - timestamp;
  };
  let timestamp = guess - offsetAt(guess);
  timestamp = guess - offsetAt(timestamp);
  return new Date(timestamp).toISOString();
}
function iconFor(type: string) {
  if (type === "capture") return <UserPlus size={18} />;
  if (type === "purchase") return <ShoppingBag size={18} />;
  if (type === "call") return <Phone size={18} />;
  if (type === "note") return <StickyNote size={18} />;
  if (type === "interaction") return <MessageCircle size={18} />;
  if (type === "followup-complete") return <CheckCircle2 size={18} />;
  if (type === "followup-overdue") return <AlertTriangle size={18} />;
  if (type === "free-consultation") return <Sparkles size={18} />;
  return <CalendarClock size={18} />;
}

export default function MyClientFollowUps({ clientId, client, summary, lastPurchaseAt, onRefresh }: Props) {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ contact_type: "Seguimiento general", reason: "", description: "", observations: "", result: "Pendiente", priority: "media", scheduled_at: "", reminder_at: "" });

  const load = useCallback(async () => {
    try {
      setError(""); const token = await accessToken(); if (!token) throw new Error("No se pudo validar la sesión.");
      const res = await fetch(`/api/central/my-clients/followups?client_id=${encodeURIComponent(clientId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const message = json?.code === "FORBIDDEN"
          ? "No tienes permiso para gestionar los seguimientos de esta clienta."
          : json?.error || "No se pudieron cargar los seguimientos.";
        throw new Error(message);
      }
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "No se pudieron cargar los seguimientos."); }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!modalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalOpen]);

  async function saveFollowUp() {
    setSaving(true); setError("");
    try {
      const token = await accessToken(); if (!token) throw new Error("No se pudo validar la sesión.");
      const res = await fetch("/api/central/my-clients/followups", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...form, client_id: clientId, status: "pendiente", scheduled_at: form.scheduled_at ? madridLocalToIso(form.scheduled_at) : null, reminder_at: form.reminder_at ? madridLocalToIso(form.reminder_at) : null }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo guardar el seguimiento.");
      setModalOpen(false); setForm({ contact_type: "Seguimiento general", reason: "", description: "", observations: "", result: "Pendiente", priority: "media", scheduled_at: "", reminder_at: "" });
      await load();
      window.dispatchEvent(new CustomEvent("tc-followup-changed", { detail: { clientId } }));
      onRefresh();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "No se pudo guardar el seguimiento."); }
    finally { setSaving(false); }
  }

  async function complete(id: string) {
    const token = await accessToken(); if (!token) return;
    const res = await fetch("/api/central/my-clients/followups", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, status: "completado", result: "Seguimiento completado" }) });
    if (res.ok) {
      await load();
      window.dispatchEvent(new CustomEvent("tc-followup-changed", { detail: { clientId } }));
      onRefresh();
    }
  }

  const timeline = useMemo<TimelineItem[]>(() => {
    const rows: TimelineItem[] = [];
    const capturedAt = summary.captured_at || client.created_at;
    rows.push({ id: `capture-${clientId}`, at: capturedAt || new Date(0).toISOString(), type: "capture", title: "Clienta captada", description: `${summary.captured_by?.display_name || "Celestial"} registró el primer contacto disponible de la clienta.`, owner: summary.captured_by?.display_name || "Celestial", status: capturedAt ? "Registrada" : "Sin fecha" });
    for (const f of items) {
      const completed = String(f.status).toLowerCase() === "completado";
      const dueAt = f.reminder_at || f.scheduled_at;
      const overdue = !completed && dueAt && new Date(dueAt).getTime() < Date.now();
      rows.push({
        id: `followup-${f.id}`,
        at: f.completed_at || f.scheduled_at || f.created_at || new Date(0).toISOString(),
        type: completed ? "followup-complete" : overdue ? "followup-overdue" : "followup",
        title: f.reason || "Seguimiento",
        description: [f.description, f.observations].filter(Boolean).join(" · ") || f.result || "Seguimiento registrado",
        owner: f.workers?.display_name || "Telefonista",
        status: completed ? "completado" : overdue ? "vencido" : f.status || "pendiente",
        priority: f.priority || undefined,
      });
    }
    const validPayments = [...(summary.payments || [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    validPayments.forEach((p: any, index: number) => rows.push({
      id: `payment-${p.id}`,
      at: p.created_at,
      type: "purchase",
      title: index === 0 ? "Primera compra" : "Recompra",
      description: `${Number(p.importe || 0).toLocaleString("es-ES", { style: "currency", currency: p.moneda || "EUR" })} · ${p.metodo || "Método no indicado"}`,
      status: p.estado || "completed",
    }));
    for (const c of summary.calls || []) rows.push({
      id: `call-${c.id}`,
      at: c.fecha_hora || c.fecha,
      type: c.usa_7_free ? "free-consultation" : "call",
      title: c.usa_7_free ? "Primera consulta free" : "Llamada registrada",
      description: c.resumen_codigo || c.tarotista_nombre || "Llamada registrada en CRM",
      owner: c.telefonista_nombre || undefined,
      status: "completada",
    });
    for (const i of summary.interactions || []) rows.push({ id: `interaction-${i.id}`, at: i.cerrado_at || i.created_at, type: "interaction", title: i.estado === "cerrada" ? "Consulta completada" : "Interacción registrada", description: i.notas_central || i.origen || "Interacción del CRM", status: i.estado || "registrada" });
    for (const n of (summary.notes || [])) rows.push({ id: `note-${n.id}`, at: n.created_at, type: "note", title: n.is_pinned ? "Nota importante" : "Nota registrada", description: n.texto || n.note_text || n.contenido || "Nota del CRM", owner: n.created_by_email || n.author_email || undefined, status: n.is_pinned ? "anclada" : "registrada" });
    return rows.filter((r) => r.at && new Date(r.at).getTime() > 0).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [client, clientId, items, summary]);

  const pending = items.filter((f) => String(f.status).toLowerCase() !== "completado");
  const next = pending.filter((f) => f.reminder_at || f.scheduled_at).sort((a, b) => new Date(a.reminder_at || a.scheduled_at || 0).getTime() - new Date(b.reminder_at || b.scheduled_at || 0).getTime())[0];
  const status = getClientLifecycleStatus(lastPurchaseAt);
  const completedCount = items.filter((f) => String(f.status).toLowerCase() === "completado").length;
  const notes = (summary.notes || []).filter((n: any) => n.is_pinned).slice(0, 3);
  const firstPurchase = [...(summary.payments || [])].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const clientDays = client.created_at ? Math.max(0, Math.floor((Date.now() - new Date(client.created_at).getTime()) / 86400000)) : 0;

  return (
    <section className={styles.layout}>
      <div className={styles.main}>
        <header className={styles.header}><div><span className={styles.eyebrow}>RELACIÓN CON LA CLIENTA</span><h2>Cronología de seguimiento</h2></div><button type="button" onClick={() => setModalOpen(true)}><Plus size={17} /> Nuevo seguimiento</button></header>
        {error && <div className={styles.error}>{error}</div>}
        {loading ? <div className={styles.empty}>Cargando cronología…</div> : timeline.length === 0 ? <div className={styles.empty}>Todavía no hay actividad registrada.</div> : (
          <div className={styles.timeline}>{timeline.map((event) => <article key={event.id} className={`${styles.event} ${styles[event.type] || ""}`}><time>{dateTime(event.at)}</time><span className={styles.icon}>{iconFor(event.type)}</span><div className={styles.eventCard}><div className={styles.eventTop}><strong>{event.title}</strong><span>{event.status}</span></div><p>{event.description}</p>{event.owner && <small>Responsable: {event.owner}</small>}{event.priority && <small>Prioridad: {event.priority}</small>}</div></article>)}</div>
        )}
      </div>

      <aside className={styles.sidebar}>
        <article><span>ESTADO ACTUAL</span><strong className={styles[status.tone]}>{status.label}</strong><small>{status.detail}</small></article>
        <article><span>ÍNDICE DE FIDELIZACIÓN</span><strong>{summary.fidelity?.score ?? 0}%</strong><small>{summary.fidelity?.description || "Sin actividad suficiente"}</small></article>
        <article><span>PRÓXIMO SEGUIMIENTO</span>{next ? <><strong>{dateTime(next.reminder_at || next.scheduled_at)}</strong><small>{next.reason}</small><button type="button" onClick={() => complete(next.id)}><CheckCircle2 size={15} /> Marcar completado</button></> : <><strong>Sin seguimiento programado</strong><button type="button" onClick={() => setModalOpen(true)}><Plus size={15} /> Crear seguimiento</button></>}</article>
        <article><span>RESUMEN RÁPIDO</span><dl><div><dt>Compras</dt><dd>{summary.totals?.purchases || 0}</dd></div><div><dt>Minutos</dt><dd>{summary.totals?.minutes ?? "—"}</dd></div><div><dt>Primera compra</dt><dd>{dateOnly(firstPurchase?.created_at)}</dd></div><div><dt>Última compra</dt><dd>{dateOnly(lastPurchaseAt)}</dd></div><div><dt>Días como clienta</dt><dd>{clientDays}</dd></div><div><dt>Completados</dt><dd>{completedCount}</dd></div><div><dt>Pendientes</dt><dd>{pending.length}</dd></div></dl></article>
        <article><span>NOTAS RÁPIDAS</span>{notes.length ? notes.map((n: any) => <p key={n.id}>{n.texto || n.note_text || n.contenido}</p>) : <small>Sin notas ancladas</small>}</article>
      </aside>

      {modalOpen && typeof document !== "undefined" ? createPortal(
        <div className={styles.backdrop} role="presentation"><div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="followup-title"><header><div><span>SEGUIMIENTO LEONARIS</span><h3 id="followup-title">Nuevo seguimiento</h3></div><button type="button" onClick={() => setModalOpen(false)} aria-label="Cerrar"><X size={20} /></button></header><div className={styles.formGrid}>
        <label>Tipo de contacto<select value={form.contact_type} onChange={(e) => setForm({ ...form, contact_type: e.target.value })}>{CONTACT_TYPES.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Prioridad<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
        <label className={styles.full}>Motivo<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ej. Preguntar cómo le está yendo" /></label>
        <label className={styles.full}>Descripción<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></label>
        <label className={styles.full}>Observaciones<textarea value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} rows={3} /></label>
        <label>Resultado<select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>{RESULTS.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Fecha programada<div className={styles.dateWrap}><input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></div></label>
        <label className={styles.full}>Recordatorio<div className={styles.dateWrap}><input type="datetime-local" value={form.reminder_at} onChange={(e) => setForm({ ...form, reminder_at: e.target.value })} /></div></label>
      </div><footer><button type="button" className={styles.cancel} onClick={() => setModalOpen(false)}>Cancelar</button><button type="button" className={styles.save} disabled={saving || !form.reason.trim()} onClick={saveFollowUp}>{saving ? "Guardando…" : "Guardar seguimiento"}</button></footer></div></div>,
        document.body
      ) : null}
    </section>
  );
}
