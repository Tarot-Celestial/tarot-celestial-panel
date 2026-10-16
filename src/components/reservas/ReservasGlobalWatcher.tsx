"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { reservationAlertDate, reservationAlertDue, reservationAlertKey, reservationAlertOpen, sameReservationAlert } from "@/lib/reservation-alerts";
import { BellRing, CalendarClock, CheckCircle2, ChevronRight, Radio, X } from "lucide-react";
import styles from "./ReservasGlobalWatcher.module.css";

const sb = supabaseBrowser();

export default function ReservasGlobalWatcher({ enabled = true, onGoToReserva }: { enabled?: boolean; onGoToReserva?: (reserva: any) => void; }) {
  const [popupReserva, setPopupReserva] = useState<any | null>(null);
  const popupRef = useRef<any | null>(null);
  const dismiss = () => { popupRef.current = null; setPopupReserva(null); };

  useEffect(() => {
    popupRef.current = null;
    setPopupReserva(null);
    if (!enabled) return;
    let disposed = false, generation = 0, loadVersion = 0, readyInFlight = false;
    let schedule: any[] = [], fetchedAt = 0, clockOffset = 0;
    const notified = new Set<string>();
    const controllers = new Set<AbortController>();
    const show = (row: any | null) => {
      if (disposed) return;
      popupRef.current = row;
      setPopupReserva(row);
    };
    const serverNow = () => Date.now() + clockOffset;
    const fresh = () => fetchedAt > 0 && Date.now() - fetchedAt <= 330_000;
    const request = async (url: string, version: number) => {
      const { data } = await sb.auth.getSession();
      if (disposed || generation !== version || !data.session?.access_token) return null;
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
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
      const row = schedule.find(item => reservationAlertDue(item, serverNow()) && !notified.has(reservationAlertKey(item)));
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
            || !date || date.getTime() > serverNow() || notified.has(key)) continue;
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
        const result = await request("/api/crm/reservas/listar", version);
        if (!result || serial !== loadVersion) return;
        schedule = Array.isArray(result.reservas) ? result.reservas.filter(reservationAlertOpen) : [];
        fetchedAt = Date.now();
        const popup = popupRef.current;
        if (popup && !schedule.some(item => sameReservationAlert(popup, item))) show(null);
        checkDueLocally();
        void checkReady();
      } catch {
        if (!disposed && generation === version && serial === loadVersion) {
          schedule = []; fetchedAt = 0; show(null);
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
        notified.clear();
        if (event === "SIGNED_IN") window.setTimeout(refreshVisible, 0);
      }
    });
    void loadSchedule();
    const dueInterval = window.setInterval(checkDueLocally, 5000);
    const readyInterval = window.setInterval(() => void checkReady(), 60000);
    const scheduleInterval = window.setInterval(refreshVisible, 300000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    window.addEventListener("tc-reservation-changed", refreshReservation);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      disposed = true; generation++;
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
  }, [enabled]);

  if (!enabled || !popupReserva) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Aviso de reserva">
      <div className={styles.alertCard}>
        <button className={styles.closeIcon} onClick={dismiss} aria-label="Cerrar aviso"><X /></button>
        <div className={styles.signal}><span><Radio /></span><b>ALERTA DE RESERVA</b><i>AHORA</i></div>
        <div className={styles.heroIcon}>{popupReserva?.__popup_kind === "tarotista_idle" ? <CheckCircle2 /> : <BellRing />}</div>
        <h2>{popupReserva?.__popup_kind === "tarotista_idle" ? "Tarotista disponible" : "Es hora de la reserva"}</h2>
        <p><strong>{popupReserva?.cliente_nombre || "Cliente"}</strong> {popupReserva?.__popup_kind === "tarotista_idle" ? "tiene una reserva pendiente y la tarotista está disponible." : "tiene una conexión programada en este momento."}</p>
        <div className={styles.missionData}><div><CalendarClock/><span>Hora programada<b>{reservationAlertDate(popupReserva)?.toLocaleString("es-ES") || "—"}</b></span></div>{(popupReserva?.tarotista_display_name || popupReserva?.tarotista_nombre || popupReserva?.tarotista_nombre_manual) ? <div><Radio/><span>Tarotista<b>{popupReserva?.tarotista_display_name || popupReserva?.tarotista_nombre || popupReserva?.tarotista_nombre_manual}</b></span></div> : null}</div>
        <div className={styles.actions}><button className={styles.secondary} onClick={dismiss}>Cerrar aviso</button><button className={styles.primary} onClick={() => { const current = popupReserva; dismiss(); onGoToReserva?.(current); }}>Abrir reserva <ChevronRight /></button></div>
      </div>
    </div>
  );
}
