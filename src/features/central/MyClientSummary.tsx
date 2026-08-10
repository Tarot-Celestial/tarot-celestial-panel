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
  X,
  ShoppingBag,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { getClientLifecycleStatus } from "./clientLifecycle";
import styles from "./MyClientSummary.module.css";

type NoteRow = {
  id: string;
  texto?: string | null;
  author_name?: string | null;
  author_email?: string | null;
  is_pinned?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  type?: string | null;
  tipo?: string | null;
  origin?: string | null;
  origen?: string | null;
  is_automatic?: boolean | null;
  automatic?: boolean | null;
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
  fidelity?: {
    score: number;
    level: string;
    label: string;
    description: string;
    stars: number;
  } | null;
  favorite_tarotists?: Array<{ id: string; tarotist_id: string; name: string; created_at?: string | null }>;
  available_tarotists?: Array<{ id: string; name: string }>;
  notes?: NoteRow[];
  interactions?: InteractionRow[];
  calls?: CallRow[];
  payments?: PaymentRow[];
  current_balance?: {
    free?: number;
    normal?: number;
    total?: number;
  };
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
  clientId: string;
  lastPurchaseAt?: string | null;
  summary: SummaryData;
  onRefresh: () => Promise<void> | void;
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

async function accessToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || null;
}

export default function MyClientSummary({ clientId, lastPurchaseAt, summary, onRefresh }: Props) {
  const lifecycle = getClientLifecycleStatus(lastPurchaseAt);
  const notes = summary.notes || [];
  const interactions = summary.interactions || [];
  const calls = summary.calls || [];
  const payments = summary.payments || [];
  const favorites = summary.favorite_tarotists || [];
  const availableTarotists = summary.available_tarotists || [];
  const totals = summary.totals || {};
  const currentBalance = summary.current_balance || {};
  const currentFree = Math.max(0, Number(currentBalance.free || 0));
  const currentNormal = Math.max(0, Number(currentBalance.normal || 0));
  const currentTotal = Math.max(0, Number(currentBalance.total ?? (currentFree + currentNormal)));
  const latestPayment = payments[0] || null;
  const fidelity = summary.fidelity || null;
  const fidelityScore = Math.max(0, Math.min(100, Math.round(fidelity?.score ?? summary.fidelity_index ?? 0)));
  const [favoritePickerOpen, setFavoritePickerOpen] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [showAllNotes, setShowAllNotes] = useState(false);
  const favoriteIds = useMemo(() => new Set(favorites.map((item) => String(item.tarotist_id))), [favorites]);

  async function changeFavorite(tarotistId: string, method: "POST" | "DELETE") {
    setFavoriteBusy(tarotistId);
    setFavoriteError("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("No se pudo validar la sesión.");
      const response = await fetch("/api/central/my-clients/favorites", {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, tarotist_id: tarotistId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error === "ALREADY_FAVORITE" ? "Esta tarotista ya está añadida." : payload?.error || "No se pudo actualizar la favorita.");
      }
      await onRefresh();
      if (method === "POST") setFavoritePickerOpen(false);
    } catch (error: any) {
      setFavoriteError(error?.message || "No se pudo actualizar la favorita.");
    } finally {
      setFavoriteBusy("");
    }
  }

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
          <article className={`${styles.fidelityCard} ${styles[`fidelity_${fidelity?.level || "very_low"}`] || ""}`}>
            <div className={styles.fidelityRing} style={{ "--fidelity-progress": `${fidelityScore}%` } as CSSProperties}>
              <span>{fidelityScore}%</span>
            </div>
            <div>
              <span>ÍNDICE DE FIDELIZACIÓN</span>
              <strong>{fidelity?.label || "Muy baja"}</strong>
              <small>{fidelity?.description || "Cliente crítica"}</small>
              <div className={styles.fidelityStars} aria-label={`${fidelity?.stars || 0} de 5 estrellas`}>
                {Array.from({ length: 5 }).map((_, index) => <Star key={index} size={12} fill={index < (fidelity?.stars || 0) ? "currentColor" : "none"} />)}
              </div>
            </div>
          </article>
        </section>

        <section className={styles.twoColumnGrid}>
          <article className={styles.panelCard}>
            <div className={styles.sectionHeader}>
              <div><Star size={19} /><h3>Tarotistas favoritas</h3></div>
              <button type="button" onClick={() => setFavoritePickerOpen((open) => !open)}><Plus size={16} /> Añadir favorita</button>
            </div>
            {favoritePickerOpen && (
              <div className={styles.favoritePicker}>
                <strong>Selecciona una tarotista</strong>
                <div>
                  {availableTarotists.map((tarotist) => (
                    <button
                      key={tarotist.id}
                      type="button"
                      disabled={favoriteIds.has(String(tarotist.id)) || favoriteBusy === tarotist.id}
                      onClick={() => changeFavorite(tarotist.id, "POST")}
                    >
                      <span className={styles.smallAvatar}>{tarotist.name.charAt(0).toUpperCase()}</span>
                      <span>{tarotist.name}</span>
                      <small>{favoriteIds.has(String(tarotist.id)) ? "Ya añadida" : "Añadir"}</small>
                    </button>
                  ))}
                </div>
                {!availableTarotists.length && <p>No hay tarotistas activas disponibles.</p>}
              </div>
            )}
            {favoriteError && <div className={styles.inlineError}>{favoriteError}</div>}
            {favorites.length ? (
              <div className={styles.favoriteList}>
                {favorites.map((favorite) => (
                  <div key={favorite.id} className={styles.favoriteRow}>
                    <span className={styles.smallAvatar}>{favorite.name.charAt(0).toUpperCase()}</span>
                    <strong>{favorite.name}</strong>
                    <button
                      type="button"
                      className={styles.removeFavorite}
                      aria-label={`Quitar ${favorite.name} de favoritas`}
                      disabled={favoriteBusy === favorite.tarotist_id}
                      onClick={() => changeFavorite(favorite.tarotist_id, "DELETE")}
                    ><X size={15} /></button>
                  </div>
                ))}
              </div>
            ) : <div className={styles.emptyState}>Todavía no hay favoritas registradas.</div>}
          </article>

          <article className={styles.panelCard}>
            <div className={styles.sectionHeader}><div><FileText size={19} /><h3>Notas</h3></div></div>
            {notes.length ? (
              <>
                <div className={styles.noteList}>
                  {(showAllNotes ? notes : notes.slice(0, 3)).map((note) => {
                    const noteType = note.tipo || note.type || (note.is_automatic || note.automatic ? "Automática" : "Manual");
                    const noteOrigin = note.origen || note.origin;
                    return (
                      <div key={note.id} className={styles.noteRow}>
                        <div>
                          <strong>{note.is_pinned ? "Nota anclada" : note.author_name || note.author_email || "Nota CRM"}</strong>
                          <small>{formatDate(note.created_at, true)}</small>
                        </div>
                        <div className={styles.noteMeta}><span>{noteType}</span>{noteOrigin && <span>{noteOrigin}</span>}</div>
                        <p>{note.texto || "Sin contenido"}</p>
                      </div>
                    );
                  })}
                </div>
                {notes.length > 3 && (
                  <button type="button" className={styles.showMoreNotes} onClick={() => setShowAllNotes((show) => !show)}>
                    {showAllNotes ? "Ver menos" : `Ver todas las notas (${notes.length})`}
                  </button>
                )}
              </>
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
        <article className={`${styles.sideCard} ${styles.balanceCard}`}>
          <div className={styles.sideIcon}><ShoppingBag size={21} /></div>
          <span>TOTAL COMPRADO</span>
          <strong>{money(totals.spent || 0)}</strong>
          <small>{totals.purchases || 0} {(totals.purchases || 0) === 1 ? "compra" : "compras"}</small>
          <div className={styles.balanceDivider} />
          <span>SALDO ACTUAL</span>
          <div className={styles.balanceRows}>
            <div><span>🎁 FREE</span><strong>{currentFree} min</strong></div>
            <div><span>⏱ NORMALES</span><strong>{currentNormal} min</strong></div>
          </div>
          <div className={styles.balanceTotal}><span>TOTAL DISPONIBLE</span><strong>{currentTotal} min</strong></div>
          {latestPayment && (
            <small className={styles.latestPurchaseLine}>Última compra: {money(Number(latestPayment.importe || 0), String(latestPayment.moneda || "EUR").toUpperCase())} · {formatDate(latestPayment.created_at)}</small>
          )}
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
