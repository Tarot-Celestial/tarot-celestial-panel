"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlarmClock,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  History,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./FirstTarotistReservationsPanel.module.css";

const sb = supabaseBrowser();

type Tarotist = {
  id: string;
  display_name: string;
  team?: string | null;
};

type Reservation = {
  id: string;
  reservation_number: number;
  brand: string;
  client_name: string;
  phone: string | null;
  client_key: string;
  tarotista_id: string;
  tarotista_name: string;
  scheduled_at: string;
  original_scheduled_at: string | null;
  status: string;
  notes: string | null;
  postpone_reason: string | null;
  postponed_count: number;
  free_consult_used: boolean;
  free_consult_used_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type FilterKey = "activas" | "hoy" | "aplazadas" | "cumplidas" | "todas";

const statusLabel: Record<string, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  aplazada: "Aplazada",
  cumplida: "Cumplida",
  no_presentada: "No se presentó",
  cancelada: "Cancelada",
};

function localInputValue(date = new Date(Date.now() + 30 * 60 * 1000)) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayKey() {
  return dateKey(new Date().toISOString());
}

function statusTone(status: string) {
  if (status === "cumplida") return "green";
  if (status === "cancelada" || status === "no_presentada") return "red";
  if (status === "aplazada") return "violet";
  if (status === "confirmada") return "blue";
  return "gold";
}

function isOpen(status: string) {
  return !["cumplida", "cancelada"].includes(String(status || "").toLowerCase());
}

export default function FirstTarotistReservationsPanel() {
  const [brand, setBrand] = useState("celestial");
  const [rows, setRows] = useState<Reservation[]>([]);
  const [tarotists, setTarotists] = useState<Tarotist[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("activas");
  const [tarotistFilter, setTarotistFilter] = useState("");
  const [selectedTarotist, setSelectedTarotist] = useState("");
  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => localInputValue());
  const [notes, setNotes] = useState("");
  const [actionRow, setActionRow] = useState<Reservation | null>(null);
  const [newDate, setNewDate] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [actionType, setActionType] = useState<"postpone" | "complete" | "cancel" | "no_show" | null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const loadSerial = useRef(0);

  const token = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const value = data.session?.access_token;
    if (!value) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
    return value;
  }, []);

  const load = useCallback(async (silent = false) => {
    const serial = ++loadSerial.current;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/central/first-tarotist-reservations?brand=${encodeURIComponent(brand)}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "No se pudo cargar Primera tarotista.");
      if (serial !== loadSerial.current) return;
      setRows(Array.isArray(json.rows) ? json.rows : []);
      const workers = Array.isArray(json.tarotists) ? json.tarotists : [];
      setTarotists(workers);
      setSelectedTarotist((current) => {
        if (current && workers.some((worker: Tarotist) => String(worker.id) === String(current))) return current;
        const atenas = workers.find((worker: Tarotist) => String(worker.display_name || "").toLowerCase().includes("atenas"));
        return String(atenas?.id || workers[0]?.id || "");
      });
      setError("");
    } catch (e: any) {
      if (serial === loadSerial.current) setError(e?.message || "Error cargando las reservas.");
    } finally {
      if (serial === loadSerial.current && !silent) setLoading(false);
    }
  }, [brand, token]);

  useEffect(() => {
    setBrand(getActiveBrand());
    const onBrand = () => setBrand(getActiveBrand());
    window.addEventListener("tc-brand-changed", onBrand);
    return () => window.removeEventListener("tc-brand-changed", onBrand);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 30000);
    const visible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      loadSerial.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);

  useEffect(() => {
    if (actionRow && actionType) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [actionRow, actionType]);

  const metrics = useMemo(() => {
    const active = rows.filter((row) => isOpen(row.status)).length;
    const today = rows.filter((row) => isOpen(row.status) && dateKey(row.scheduled_at) === todayKey()).length;
    const postponed = rows.filter((row) => row.status === "aplazada").length;
    const used = rows.filter((row) => row.free_consult_used).length;
    return { active, today, postponed, used };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...rows]
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime() || a.reservation_number - b.reservation_number)
      .filter((row) => {
        if (tarotistFilter && String(row.tarotista_id) !== tarotistFilter) return false;
        if (filter === "activas" && !isOpen(row.status)) return false;
        if (filter === "hoy" && (!isOpen(row.status) || dateKey(row.scheduled_at) !== todayKey())) return false;
        if (filter === "aplazadas" && row.status !== "aplazada") return false;
        if (filter === "cumplidas" && row.status !== "cumplida") return false;
        if (needle) {
          const haystack = `${row.reservation_number} ${row.client_name} ${row.phone || ""} ${row.tarotista_name} ${row.notes || ""}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      });
  }, [rows, query, filter, tarotistFilter]);

  async function createReservation(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (!clientName.trim() && !phone.trim()) throw new Error("Escribe el nombre o el teléfono de la clienta.");
      if (!selectedTarotist) throw new Error("Selecciona la tarotista nueva.");
      if (!scheduledAt) throw new Error("Indica la fecha y hora de la reserva.");
      const res = await fetch("/api/central/first-tarotist-reservations", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          brand,
          client_name: clientName,
          phone,
          tarotista_id: selectedTarotist,
          scheduled_at: new Date(scheduledAt).toISOString(),
          notes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        if (json?.code === "FIRST_CONSULT_ALREADY_USED") {
          throw new Error(`Esta clienta ya utilizó su primera consulta gratis con ${json?.existing?.tarotista_name || "esta tarotista"} · reserva #${json?.existing?.reservation_number || "—"}.`);
        }
        if (json?.code === "RESERVATION_ALREADY_EXISTS") {
          throw new Error(`Esta clienta ya tiene un registro para esta tarotista · reserva #${json?.existing?.reservation_number || "—"}. Búscala y actualiza esa reserva.`);
        }
        throw new Error(json?.error || "No se pudo crear la reserva.");
      }
      setClientName("");
      setPhone("");
      setNotes("");
      setScheduledAt(localInputValue());
      setNotice(`Reserva #${json?.row?.reservation_number || ""} creada correctamente.`);
      await load(true);
      setTimeout(() => setNotice(""), 2500);
    } catch (e: any) {
      setError(e?.message || "Error creando la reserva.");
    } finally {
      setSaving(false);
    }
  }

  async function quickAction(row: Reservation, action: "confirm") {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/central/first-tarotist-reservations", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: row.id, brand }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "No se pudo actualizar la reserva.");
      setNotice(`Reserva #${row.reservation_number} actualizada.`);
      await load(true);
      setTimeout(() => setNotice(""), 2200);
    } catch (e: any) {
      setError(e?.message || "Error actualizando la reserva.");
    } finally {
      setSaving(false);
    }
  }

  function openAction(row: Reservation, action: "postpone" | "complete" | "cancel" | "no_show") {
    setActionRow(row);
    setActionType(action);
    setActionNote("");
    setNewDate(action === "postpone" ? localInputValue(new Date(new Date(row.scheduled_at).getTime() + 30 * 60 * 1000)) : "");
  }

  async function submitAction(event: FormEvent) {
    event.preventDefault();
    if (!actionRow || !actionType || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (actionType === "postpone" && !newDate) throw new Error("Indica la nueva fecha y hora de la reserva.");
      const res = await fetch("/api/central/first-tarotist-reservations", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionType,
          id: actionRow.id,
          brand,
          new_scheduled_at: newDate ? new Date(newDate).toISOString() : undefined,
          note: actionNote,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "No se pudo actualizar la reserva.");
      const label = actionType === "complete" ? "Consulta cumplida y primera consulta gratis marcada como utilizada." : "Reserva actualizada correctamente.";
      setNotice(label);
      setActionRow(null);
      setActionType(null);
      await load(true);
      setTimeout(() => setNotice(""), 2600);
    } catch (e: any) {
      setError(e?.message || "Error actualizando la reserva.");
    } finally {
      setSaving(false);
    }
  }

  const activeTarotist = tarotists.find((worker) => String(worker.id) === String(selectedTarotist));

  return (
    <section className={styles.panel}>
      <div className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>PRIMERA CONSULTA GRATIS · CONTROL OPERATIVO</span>
          <h2>Primera tarotista</h2>
          <p>
            Gestiona la cola de bienvenida, respeta el orden de reservas y comprueba de un vistazo quién ya utilizó su primera consulta gratis con la tarotista nueva.
          </p>
        </div>
        <div className={styles.heroBadge}>
          <Sparkles size={19} />
          <div><span>Tarotista activa</span><strong>{activeTarotist?.display_name || "Selecciona tarotista"}</strong></div>
        </div>
      </div>

      <div className={styles.metrics}>
        <article><span>Reservas activas</span><strong>{metrics.active}</strong><small>En cola o pendientes de cerrar.</small></article>
        <article><span>Para hoy</span><strong>{metrics.today}</strong><small>Reservas activas del día.</small></article>
        <article><span>Aplazadas</span><strong>{metrics.postponed}</strong><small>Con nueva fecha asignada.</small></article>
        <article className={styles.usedMetric}><span>Gratis ya utilizadas</span><strong>{metrics.used}</strong><small>Clientas que ya conocieron a la tarotista.</small></article>
      </div>

      <div className={styles.layout}>
        <form className={styles.createCard} onSubmit={createReservation}>
          <div className={styles.cardTitle}>
            <div className={styles.iconBox}><CalendarClock size={18} /></div>
            <div><span>Nueva reserva</span><h3>Añadir a la cola</h3></div>
          </div>
          <label>
            <span>Nombre de la clienta</span>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Ej. María García" />
          </label>
          <label>
            <span>Teléfono / número de cliente</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej. +34 600 000 000" />
            <small>Recomendado: el teléfono permite detectar duplicados con mucha más seguridad.</small>
          </label>
          <label>
            <span>Tarotista de bienvenida</span>
            <select value={selectedTarotist} onChange={(e) => setSelectedTarotist(e.target.value)}>
              <option value="">Seleccionar tarotista…</option>
              {tarotists.map((worker) => <option key={worker.id} value={worker.id}>{worker.display_name}{worker.team ? ` · ${worker.team}` : ""}</option>)}
            </select>
          </label>
          <label>
            <span>Fecha y hora de reserva</span>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </label>
          <label>
            <span>Nota operativa</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. Llamar a WhatsApp, viene por promo Atenas, tema pendiente…" />
          </label>
          <button className={styles.createButton} type="submit" disabled={saving}>
            <UserRoundCheck size={17} /> {saving ? "Guardando…" : "Crear reserva"}
          </button>
        </form>

        <div className={styles.queueCard}>
          <div className={styles.queueHeader}>
            <div>
              <span className={styles.eyebrow}>ORDEN DE ATENCIÓN</span>
              <h3>Reservas de primera consulta</h3>
            </div>
            <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>
              <RefreshCw size={15} /> {loading ? "Actualizando…" : "Actualizar"}
            </button>
          </div>

          <div className={styles.filters}>
            <label className={styles.searchBox}>
              <Search size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nombre, teléfono o # reserva" />
            </label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
              <option value="activas">Activas</option>
              <option value="hoy">Hoy</option>
              <option value="aplazadas">Aplazadas</option>
              <option value="cumplidas">Cumplidas</option>
              <option value="todas">Todas</option>
            </select>
            <select value={tarotistFilter} onChange={(e) => setTarotistFilter(e.target.value)}>
              <option value="">Todas las tarotistas</option>
              {tarotists.map((worker) => <option key={worker.id} value={worker.id}>{worker.display_name}</option>)}
            </select>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}
          {notice ? <div className={styles.notice}>{notice}</div> : null}

          <div className={styles.queueList}>
            {!filteredRows.length && !loading ? <div className={styles.empty}>No hay reservas que coincidan con estos filtros.</div> : null}
            {filteredRows.map((row, index) => (
              <article className={styles.reservation} key={row.id} data-used={row.free_consult_used ? "true" : "false"}>
                <div className={styles.orderRail}>
                  <span className={styles.queuePosition}>{index + 1}</span>
                  <span className={styles.reservationNumber}>#{row.reservation_number}</span>
                </div>

                <div className={styles.reservationBody}>
                  <div className={styles.reservationTop}>
                    <div className={styles.personBlock}>
                      <div className={styles.avatar}><UserRound size={18} /></div>
                      <div>
                        <h4>{row.client_name || row.phone || "Clienta"}</h4>
                        <div className={styles.personMeta}>
                          {row.phone ? <span><Phone size={13} /> {row.phone}</span> : null}
                          <span><Sparkles size={13} /> {row.tarotista_name}</span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.statusStack}>
                      <span className={styles.status} data-tone={statusTone(row.status)}>{statusLabel[row.status] || row.status}</span>
                      <span className={`${styles.freeBadge} ${row.free_consult_used ? styles.freeUsed : styles.freeAvailable}`}>
                        {row.free_consult_used ? <><BadgeCheck size={14} /> PRIMERA GRATIS UTILIZADA</> : <><Sparkles size={14} /> PRIMERA GRATIS DISPONIBLE</>}
                      </span>
                    </div>
                  </div>

                  <div className={styles.timeStrip}>
                    <div><Clock3 size={15} /><span>Reserva</span><strong>{fmtDate(row.scheduled_at)}</strong></div>
                    {row.status === "aplazada" && row.original_scheduled_at ? <div><History size={15} /><span>Original</span><strong>{fmtDate(row.original_scheduled_at)}</strong></div> : null}
                    {row.postponed_count > 0 ? <div><AlarmClock size={15} /><span>Aplazada</span><strong>{row.postponed_count} vez{row.postponed_count === 1 ? "" : "es"}</strong></div> : null}
                  </div>

                  {row.notes || row.postpone_reason ? (
                    <div className={styles.note}>{row.postpone_reason ? `Último aplazamiento: ${row.postpone_reason}` : row.notes}</div>
                  ) : null}

                  <div className={styles.actions}>
                    {!row.free_consult_used && row.status !== "confirmada" && !["cancelada", "cumplida"].includes(row.status) ? (
                      <button type="button" onClick={() => void quickAction(row, "confirm")} disabled={saving}>Confirmar</button>
                    ) : null}
                    {!row.free_consult_used && !["cancelada", "cumplida"].includes(row.status) ? (
                      <button type="button" className={styles.completeButton} onClick={() => openAction(row, "complete")} disabled={saving}>
                        <CheckCircle2 size={14} /> Cumplió consulta
                      </button>
                    ) : null}
                    {!row.free_consult_used && !["cancelada", "cumplida"].includes(row.status) ? (
                      <button type="button" className={styles.postponeButton} onClick={() => openAction(row, "postpone")} disabled={saving}>
                        <CalendarClock size={14} /> Aplazar
                      </button>
                    ) : null}
                    {!row.free_consult_used && !["cancelada", "cumplida"].includes(row.status) ? (
                      <button type="button" onClick={() => openAction(row, "no_show")} disabled={saving}>No se presentó</button>
                    ) : null}
                    {!row.free_consult_used && !["cancelada", "cumplida"].includes(row.status) ? (
                      <button type="button" className={styles.cancelButton} onClick={() => openAction(row, "cancel")} disabled={saving}>
                        <XCircle size={14} /> Cancelar
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

      <dialog ref={modalRef} className={styles.dialog} onClose={() => { setActionRow(null); setActionType(null); }}>
        {actionRow && actionType ? (
          <form method="dialog" onSubmit={submitAction}>
            <div className={styles.dialogHeader}>
              <div>
                <span className={styles.eyebrow}>RESERVA #{actionRow.reservation_number}</span>
                <h3>
                  {actionType === "postpone" ? "Aplazar reserva" : actionType === "complete" ? "Confirmar consulta cumplida" : actionType === "no_show" ? "Marcar no presentada" : "Cancelar reserva"}
                </h3>
                <p>{actionRow.client_name} · {actionRow.tarotista_name}</p>
              </div>
            </div>
            {actionType === "complete" ? <div className={styles.warningSuccess}>Al confirmar, esta clienta quedará marcada como <b>PRIMERA CONSULTA GRATIS UTILIZADA</b> con esta tarotista.</div> : null}
            {actionType === "postpone" ? (
              <label><span>Nueva fecha y hora</span><input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} required /></label>
            ) : null}
            <label>
              <span>{actionType === "postpone" ? "Motivo / nota del aplazamiento" : "Nota opcional"}</span>
              <textarea value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="Escribe una nota breve para que quede contexto…" />
            </label>
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => { setActionRow(null); setActionType(null); }}>Volver</button>
              <button type="submit" className={styles.createButton} disabled={saving}>{saving ? "Guardando…" : "Confirmar"}</button>
            </div>
          </form>
        ) : null}
      </dialog>
    </section>
  );
}
