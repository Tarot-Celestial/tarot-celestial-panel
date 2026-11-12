"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePanelInteraction } from "@/components/attendance/PanelInteractionContext";
import { reservationAlertDate, reservationAlertDue, reservationAlertKey, reservationAlertOpen, sameReservationAlert } from "@/lib/reservation-alerts";
import { reservasFreshUrl } from "@/lib/reservas-sync";
import { BellRing, CalendarClock, CheckCircle2, ChevronRight, Radio, X } from "lucide-react";
import ReservationAdvanceNotice from "./ReservationAdvanceNotice";
import styles from "./ReservasGlobalWatcher.module.css";

const sb = supabaseBrowser();

export default function ReservasGlobalWatcher({ enabled = true, advanceNotice = false, onGoToReserva }: { enabled?: boolean; advanceNotice?: boolean; onGoToReserva?: (reserva: any) => void; }) {
  const panelInteractive = usePanelInteraction();
  const active = enabled && panelInteractive;
  const [popupReserva, setPopupReserva] = useState<any | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [workerId, setWorkerId] = useState("");
  const [syncError, setSyncError] = useState("");
  const ownerRef = useRef("");
  const popupRef = useRef<any | null>(null);
  const dismissed = useRef(new Set<string>());
  const dismiss = () => {
    const row = popupRef.current;
    if (row) {
      const kinds = row.__popup_kind === "tarotista_idle" ? ["due", "ready"] : ["due"];
      for (const kind of kinds) {
        const key = reservationAlertKey(row, kind);
        dismissed.current.add(key);
        try { localStorage.setItem(`tc-reservation-seen-v2:${ownerRef.current}:${key}`, String(Date.now())); } catch { /* Keep the in-memory acknowledgement. */ }
      }
    }
    popupRef.current = null; setPopupReserva(null);
  };
  useEffect(() => {
    const element = dialog.current;
    if (active && popupReserva && element && !element.open) element.showModal();
    // React clears the ref on unmount; retain this exact node to release the
    // top layer when the access gate locks, without acknowledging the booking.
    return () => { if (element?.open) element.close(); };
  }, [active, popupReserva]);

  useEffect(() => {
    popupRef.current = null;
    setPopupReserva(null);
    if (!active) return;
    let disposed = false, generation = 0, loadVersion = 0, readyInFlight = false;
    let schedule: any[] = [], fetchedAt = 0, clockOffset = 0;
    const notified = new Set<string>();
    const controllers = new Set<AbortController>();
    const show = (row: any | null) => {
      if (disposed) return;
      if (!row && popupRef.current) notified.delete(reservationAlertKey(popupRef.current));
      popupRef.current = row;
      setPopupReserva(row);
    };
    const serverNow = () => Date.now() + clockOffset;
    const fresh = () => fetchedAt > 0 && Date.now() - fetchedAt <= 30_000;
    const acknowledged = (row: any, kind = row.__popup_kind === "tarotista_idle" ? "ready" : "due") => {
      const key = reservationAlertKey(row, kind);
      if (dismissed.current.has(key)) return true;
      try { return !!localStorage.getItem(`tc-reservation-seen-v2:${ownerRef.current}:${key}`); } catch { return false; }
    };
    const request = async (url: string, version: number) => {
      const { data } = await sb.auth.getSession();
      if (disposed || generation !== version || !data.session?.access_token) return null;
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(reservasFreshUrl(url), { headers: { Authorization: `Bearer ${data.session.access_token}`, "Cache-Control": "no-cache" }, cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (disposed || generation !== version) return null;
        if (!response.ok || !body.ok) throw new Error("No se pudo sincronizar la agenda.");
        const time = Date.parse(body.serverNow);
        if (Number.isFinite(time)) clockOffset = time - Date.now();
        return body;
      } finally {
        window.clearTimeout(timeout);
        controllers.delete(controller);
      }
    };

    function checkDueLocally() {
      // The server may be claiming an availability alert. Do not occupy its single display slot mid-request.
      if (disposed || document.visibilityState === "hidden" || readyInFlight || popupRef.current || !fresh()) return;
      const row = schedule.find(item => reservationAlertDue(item, serverNow()) && !notified.has(reservationAlertKey(item)) && !acknowledged(item));
      if (!row) return;
      notified.add(reservationAlertKey(row));
      show(row);
    }

    async function checkReady() {
      if (disposed || document.visibilityState === "hidden" || readyInFlight || popupRef.current || !fresh()) return;
      readyInFlight = true;
      const version = generation;
      try {
        const result = await request("/api/crm/reservas/ready", version);
        if (!result || popupRef.current) return;
        for (const row of Array.isArray(result.reservas) ? result.reservas : []) {
          const current = schedule.find(item => item.id === row.id);
          const date = reservationAlertDate(row);
          const key = reservationAlertKey(row, "ready");
          if (!current || !sameReservationAlert(row, current) || !reservationAlertOpen(row)
            || !date || date.getTime() > serverNow() || notified.has(key) || acknowledged(row, "ready")) continue;
          notified.add(key);
          notified.add(reservationAlertKey(row));
          show({ ...row, __popup_kind: "tarotista_idle" });
          break;
        }
      } catch {
        // A missing or failed source never means the tarotist is available.
      } finally { readyInFlight = false; checkDueLocally(); }
    }

    async function loadSchedule() {
      if (disposed || document.visibilityState === "hidden") return;
      const version = generation, serial = ++loadVersion;
      try {
        const result = await request("/api/crm/reservas/listar?scope=alerts", version);
        if (!result || serial !== loadVersion) return;
        schedule = Array.isArray(result.reservas) ? result.reservas.filter(reservationAlertOpen) : [];
        fetchedAt = Date.now();
        ownerRef.current = result.workerId || "";
        setWorkerId(result.workerId || "");
        setSyncError("");
        const popup = popupRef.current;
        if (popup && !schedule.some(item => sameReservationAlert(popup, item))) show(null);
        void checkReady();
        checkDueLocally();
      } catch {
        if (!disposed && generation === version && serial === loadVersion) {
          schedule = []; fetchedAt = 0; show(null); setSyncError("No se pudo sincronizar la agenda. Reconecta para recuperar los avisos.");
        }
      }
    }

    function invalidate(changedId?: string) {
      generation++;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      schedule = []; fetchedAt = 0;
      if (!changedId || popupRef.current?.id === changedId) show(null);
    }
    const storageChanged = (event: StorageEvent) => {
      if (event.key?.startsWith(`tc-reservation-seen-v2:${ownerRef.current}:`) && popupRef.current && acknowledged(popupRef.current)) show(null);
    };
    window.addEventListener("storage", storageChanged);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void loadSchedule();
    };
    const refreshReservation = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; reserva?: { id?: string } }>).detail;
      invalidate(detail?.id || detail?.reserva?.id);
      void loadSchedule();
    };
    const channel = sb.channel("global-reservation-monitor")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservas" }, (payload: any) => {
        const row = payload.new, id = String(row?.id || payload.old?.id || "");
        const previous = schedule.find(item => item.id === id) || popupRef.current;
        // A delivery timestamp update is not a cancellation. Keep the in-flight claim valid.
        if (payload.eventType === "UPDATE" && previous?.id === id && sameReservationAlert(previous, row)) {
          schedule = schedule.map(item => item.id === id ? { ...item, ...row } : item);
          return;
        }
        invalidate(id || undefined);
        void loadSchedule();
      })
      .subscribe();
    const auth = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
        invalidate();
        notified.clear(); dismissed.current.clear(); setWorkerId(""); ownerRef.current = "";
        if (event === "SIGNED_IN") window.setTimeout(refreshVisible, 0);
      }
    });
    void loadSchedule();
    const dueInterval = window.setInterval(checkDueLocally, 1000);
    const readyInterval = window.setInterval(() => void checkReady(), 60000);
    const scheduleInterval = window.setInterval(refreshVisible, 15000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    window.addEventListener("tc-reservation-changed", refreshReservation);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      disposed = true; generation++;
      window.removeEventListener("storage", storageChanged);
      for (const controller of controllers) controller.abort();
      window.clearInterval(dueInterval);
      window.clearInterval(readyInterval);
      window.clearInterval(scheduleInterval);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      window.removeEventListener("tc-reservation-changed", refreshReservation);
      document.removeEventListener("visibilitychange", refreshVisible);
      auth.data.subscription.unsubscribe();
      void sb.removeChannel(channel);
    };
  }, [active]);

  if (!active) return null;

  return (<>
    {advanceNotice && <ReservationAdvanceNotice workerId={workerId} hidden={!!popupReserva} onOpen={row => onGoToReserva?.(row)} />}
    {syncError && <p className={styles.syncError} role="status">{syncError}</p>}
    {popupReserva && <dialog ref={dialog} onCancel={event => { event.preventDefault(); dismiss(); }} className={styles.overlay} role="dialog" aria-modal="true" aria-label="Aviso de reserva">
      <div className={styles.alertCard}>
        <button type="button" className={styles.closeIcon} onClick={dismiss} aria-label="Cerrar aviso"><X /></button>
        <div className={styles.signal}><span><Radio /></span><b>ALERTA DE RESERVA</b><i>AHORA</i></div>
        <div className={styles.heroIcon}>{popupReserva?.__popup_kind === "tarotista_idle" ? <CheckCircle2 /> : <BellRing />}</div>
        <h2>{popupReserva?.__popup_kind === "tarotista_idle" ? "Tarotista disponible" : "Es hora de la reserva"}</h2>
        <p><strong>{popupReserva?.cliente_nombre || "Cliente"}</strong> {popupReserva?.__popup_kind === "tarotista_idle" ? "tiene una reserva pendiente y la tarotista está disponible." : "tiene una conexión programada en este momento."}</p>
        <div className={styles.missionData}><div><CalendarClock/><span>Hora · Madrid<b>{reservationAlertDate(popupReserva)?.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "medium", timeStyle: "short" }) || "—"}</b></span></div>{(popupReserva?.tarotista_display_name || popupReserva?.tarotista_nombre || popupReserva?.tarotista_nombre_manual) ? <div><Radio/><span>Tarotista<b>{popupReserva?.tarotista_display_name || popupReserva?.tarotista_nombre || popupReserva?.tarotista_nombre_manual}</b></span></div> : null}</div>
        {popupReserva.telefono_normalizado && <p>Teléfono: <a href={`tel:${String(popupReserva.telefono_normalizado).replace(/[^+\d]/g, "")}`}>{popupReserva.telefono_normalizado}</a></p>}
        <p>{popupReserva.numero_reserva ? `Reserva R-${String(popupReserva.numero_reserva).padStart(5, "0")} · ` : ""}Cerrar el aviso no marca la reserva como atendida.</p>
        {popupReserva.nota && <details className={styles.notes}><summary>Nota e historial</summary><p>{popupReserva.nota}</p></details>}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={dismiss}>Cerrar aviso</button><button type="button" className={styles.primary} onClick={() => { const current = popupReserva; dismiss(); onGoToReserva?.(current); }}>Ir hacia la reserva <ChevronRight /></button></div>
      </div>
    </dialog>}
  </>);
}
