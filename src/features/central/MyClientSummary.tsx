"use client";

import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Coins,
  FileText,
  Heart,
  MessageCircle,
  MoreHorizontal,
  PhoneCall,
  Plus,
  ShoppingBag,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import { getClientLifecycleStatus } from "./clientLifecycle";
import styles from "./MyClientSummary.module.css";

type NoteRow = {
  id: string;
  texto?: string | null;
  author_name?: string | null;
  is_pinned?: boolean | null;
  created_at?: string | null;
};

type InteractionRow = {
  id: string;
  estado?: string | null;
  notas_central?: string | null;
  origen?: string | null;
  created_at?: string | null;
  cerrado_at?: string | null;
};

type CallRow = {
  id: string;
  fecha_hora?: string | null;
  fecha?: string | null;
  resumen_codigo?: string | null;
  telefonista_nombre?: string | null;
  tarotista_nombre?: string | null;
};

type PaymentRow = {
  id: string;
  importe?: number | string | null;
  moneda?: string | null;
  metodo?: string | null;
  created_at?: string | null;
};

type SummaryData = {
  captured_at?: string | null;
  captured_by?: { id?: string | null; display_name?: string | null } | null;
  fidelity_index?: number | null;
  favorite_tarotists?: Array<{ name: string; count: number }>;
  notes?: NoteRow[];
  interactions?: InteractionRow[];
  calls?: CallRow[];
  payments?: PaymentRow[];
  totals?: {
    purchases?: number;
    spent?: number;
    calls?: number;
    consultations?: number;
    followUps?: number;
    messages?: number;
    minutes?: number | null;
  };
};

type Props = {
  lastPurchaseAt?: string | null;
  summary: SummaryData;
};

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "Sin datos";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin datos";
  return new Intl.DateTimeFormat("es-ES", withTime
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function relativeDate(value?: string | null) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return "Hoy";
  if (days === 1) return "Hace 1 día";
  if (days < 30) return `Hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12);
  return `Hace ${years} ${years === 1 ? "año" : "años"}`;
}

function money(value?: number, currency = "EUR") {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(Number(value || 0));
}

export default function MyClientSummary({ lastPurchaseAt, summary }: Props) {
  const lifecycle = getClientLifecycleStatus(lastPurchaseAt);
  const notes = summary.notes || [];
  const interactions = summary.interactions || [];
  const calls = summary.calls || [];
  const payments = summary.payments || [];
  const favorites = summary.favorite_tarotists || [];
  const totals = summary.totals || {};

  const activity = [
    ...payments.slice(0, 4).map((item) => ({ id: `payment-${item.id}`, type: "Compra", text: `Compra registrada${item.importe != null ? ` · ${money(Number(item.importe), String(item.moneda || "EUR").toUpperCase())}` : ""}`, at: item.created_at, icon: ShoppingBag })),
    ...notes.slice(0, 4).map((item) => ({ id: `note-${item.id}`, type: "Nota", text: item.texto || "Nota añadida", at: item.created_at, icon: FileText })),
    ...calls.slice(0, 4).map((item) => ({ id: `call-${item.id}`, type: "Llamada", text: item.resumen_codigo || "Llamada registrada", at: item.fecha_hora || item.fecha, icon: PhoneCall })),
    ...interactions.slice(0, 4).map((item) => ({ id: `interaction-${item.id}`, type: "Consulta", text: item.notas_central || item.origen || "Interacción registrada", at: item.created_at, icon: MessageCircle })),
  ].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime()).slice(0, 7);

  return (
    <div className={styles.summaryRoot}>
      <div className={styles.mainColumn}>
        <section className={styles.topGrid}>
          <article className={styles.metricCard}>
            <div className={styles.metricIcon}><CalendarDays size={20} /></div>
            <span>FECHA DE CAPTACIÓN</span>
            <strong>{formatDate(summary.captured_at)}</strong>
            <small>{relativeDate(summary.captured_at)}</small>
          </article>
          <article className={styles.metricCard}>
            <div className={styles.metricIcon}><UserRound size={20} /></div>
            <span>CAPTADA POR</span>
            <strong>{summary.captured_by?.display_name || "Celestial"}</strong>
            <small>Cartera general</small>
          </article>
          <article className={`${styles.metricCard} ${styles[lifecycle.tone]}`}>
            <div className={styles.metricIcon}><Heart size={20} /></div>
            <span>ESTADO ACTUAL</span>
            <strong>{lifecycle.label}</strong>
            <small>{lifecycle.detail}</small>
          </article>
          <article className={styles.fidelityCard}>
            <div className={styles.fidelityRing}>
              <span>{summary.fidelity_index == null ? "—" : `${Math.round(summary.fidelity_index)}%`}</span>
            </div>
            <div>
              <span>ÍNDICE DE FIDELIZACIÓN</span>
              <strong>{summary.fidelity_index == null ? "Pendiente" : "Calculado"}</strong>
              <small>Se conectará cuando exista una fórmula real.</small>
            </div>
          </article>
        </section>

        <section className={styles.twoColumnGrid}>
          <article className={styles.panelCard}>
            <div className={styles.sectionHeader}>
              <div><Star size={19} /><h3>Tarotistas favoritas</h3></div>
              <button type="button" disabled><Plus size={16} /> Añadir favorita</button>
            </div>
            {favorites.length ? (
              <div className={styles.favoriteList}>
                {favorites.map((favorite) => (
                  <div key={favorite.name} className={styles.favoriteRow}>
                    <span className={styles.smallAvatar}>{favorite.name.charAt(0).toUpperCase()}</span>
                    <strong>{favorite.name}</strong>
                    <small>{favorite.count} {favorite.count === 1 ? "consulta" : "consultas"}</small>
                  </div>
                ))}
              </div>
            ) : <div className={styles.emptyState}>Todavía no hay favoritas registradas.</div>}
          </article>

          <article className={styles.panelCard}>
            <div className={styles.sectionHeader}><div><FileText size={19} /><h3>Notas</h3></div></div>
            {notes.length ? (
              <div className={styles.noteList}>
                {notes.slice(0, 3).map((note) => (
                  <div key={note.id} className={styles.noteRow}>
                    <div><strong>{note.is_pinned ? "Nota anclada" : note.author_name || "Nota CRM"}</strong><small>{formatDate(note.created_at, true)}</small></div>
                    <p>{note.texto || "Sin contenido"}</p>
                  </div>
                ))}
              </div>
            ) : <div className={styles.emptyState}>No hay notas registradas para esta clienta.</div>}
          </article>
        </section>

        <section className={styles.panelCard}>
          <div className={styles.sectionHeader}><div><Sparkles size={19} /><h3>Resumen de actividad</h3></div></div>
          <div className={styles.activityCounters}>
            <div><CheckCircle2 size={20} /><span>Seguimientos</span><strong>{totals.followUps || 0}</strong></div>
            <div><PhoneCall size={20} /><span>Llamadas</span><strong>{totals.calls || 0}</strong></div>
            <div><MessageCircle size={20} /><span>Mensajes</span><strong>{totals.messages || 0}</strong><small>Próximamente</small></div>
            <div><BellRing size={20} /><span>Consultas</span><strong>{totals.consultations || 0}</strong></div>
            <div><ShoppingBag size={20} /><span>Compras</span><strong>{totals.purchases || 0}</strong></div>
          </div>
        </section>

        <section className={styles.panelCard}>
          <div className={styles.sectionHeader}>
            <div><CheckCircle2 size={19} /><h3>Seguimientos</h3></div>
            <button type="button" disabled><Plus size={16} /> Nuevo seguimiento</button>
          </div>
          <div className={styles.emptyState}>Aún no existe una fuente específica de seguimientos. El bloque queda preparado para conectarla sin duplicar el CRM.</div>
        </section>

        <section className={styles.panelCard}>
          <div className={styles.historyTabs}>
            <button type="button" className={styles.historyActive}>Llamadas <span>{calls.length}</span></button>
            <button type="button">Mensajes <span>0</span></button>
            <button type="button">Consultas <span>{interactions.length}</span></button>
            <button type="button">Compras <span>{payments.length}</span></button>
          </div>
          {calls.length ? (
            <div className={styles.historyList}>
              {calls.slice(0, 5).map((call) => (
                <div key={call.id}><PhoneCall size={17} /><div><strong>{call.resumen_codigo || "Llamada registrada"}</strong><small>{formatDate(call.fecha_hora || call.fecha, true)}</small></div><MoreHorizontal size={18} /></div>
              ))}
            </div>
          ) : <div className={styles.emptyState}>No hay llamadas registradas.</div>}
        </section>
      </div>

      <aside className={styles.sideColumn}>
        <article className={styles.sideCard}>
          <div className={styles.sideIcon}><ShoppingBag size={21} /></div>
          <span>TOTAL COMPRADO</span>
          <strong>{totals.minutes == null ? "Minutos no disponibles" : `${totals.minutes} min`}</strong>
          <small>{totals.purchases || 0} {(totals.purchases || 0) === 1 ? "compra" : "compras"}</small>
        </article>
        <article className={styles.sideCard}>
          <div className={styles.sideIcon}><Coins size={21} /></div>
          <span>GASTO TOTAL</span>
          <strong>{money(totals.spent || 0)}</strong>
          <small>Relación desde {formatDate(summary.captured_at)}</small>
        </article>
        <article className={styles.timelineCard}>
          <div className={styles.sectionHeader}><div><Clock3 size={19} /><h3>Actividad reciente</h3></div></div>
          {activity.length ? activity.map((event) => {
            const Icon = event.icon;
            return <div key={event.id} className={styles.timelineRow}><span><Icon size={15} /></span><div><strong>{event.type}</strong><p>{event.text}</p><small>{formatDate(event.at, true)}</small></div></div>;
          }) : <div className={styles.emptyState}>No hay actividad disponible.</div>}
        </article>
        <article className={styles.panelCard}>
          <div className={styles.sectionHeader}><div><Heart size={19} /><h3>Preferencias</h3></div></div>
          <div className={styles.emptyState}>No hay preferencias registradas todavía.</div>
        </article>
      </aside>
    </div>
  );
}
