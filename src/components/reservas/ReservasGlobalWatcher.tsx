"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { BellRing, CalendarClock, CheckCircle2, ChevronRight, Radio, X } from "lucide-react";
import styles from "./ReservasGlobalWatcher.module.css";

const sb = supabaseBrowser();

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

function parseReservaDate(value: any) {
  if (!value) return null;
  try {
    const s = String(value);
    return new Date(/z$/i.test(s) ? s : `${s}Z`);
  } catch {
    return null;
  }
}

function isClosedEstado(v: any) {
  const s = String(v || "").trim().toLowerCase();
  return s === "finalizada" || s === "completada";
}

export default function ReservasGlobalWatcher({ enabled = true, onGoToReserva }: { enabled?: boolean; onGoToReserva?: (reserva: any) => void; }) {
  const [popupReserva, setPopupReserva] = useState<any | null>(null);
  const avisadasRef = useRef<string[]>([]);
  const tickInFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function getTokenOrLogin() {
      const { data } = await sb.auth.getSession();
      return data.session?.access_token || "";
    }

    async function tick() {
      if (document.visibilityState === "hidden" || tickInFlightRef.current) return;
      tickInFlightRef.current = true;
      try {
        if (popupReserva) return;
        const token = await getTokenOrLogin();
        if (!token) return;
        const readyRes = await fetch("/api/crm/reservas/ready", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const readyJson = await safeJson(readyRes);
        const readyRows = Array.isArray(readyJson?.reservas) ? readyJson.reservas : [];
        for (const row of readyRows) {
          const id = String(row?.id || "");
          if (!id || avisadasRef.current.includes(`ready:${id}`)) continue;
          avisadasRef.current = [...avisadasRef.current, `ready:${id}`];
          if (!cancelled) setPopupReserva({ ...row, __popup_kind: "tarotista_idle" });
          return;
        }

        const r = await fetch("/api/crm/reservas/listar", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const j = await safeJson(r);
        if (!j?._ok || !j?.ok) return;
        const rows = Array.isArray(j.reservas) ? j.reservas : [];
        const now = new Date();
        for (const row of rows) {
          const id = String(row?.id || "");
          const fecha = parseReservaDate(row?.fecha_reserva);
          if (!id || !fecha || isClosedEstado(row?.estado) || avisadasRef.current.includes(id)) continue;
          const diff = fecha.getTime() - now.getTime();
          if (diff <= 30000 && diff >= -30000) {
            avisadasRef.current = [...avisadasRef.current, id];
            if (!cancelled) setPopupReserva(row);
            break;
          }
        }
      } catch {
        // El siguiente ciclo vuelve a intentarlo sin solapar peticiones.
      } finally {
        tickInFlightRef.current = false;
      }
    }

    void tick();
    // Realtime cubre los cambios normales; este sondeo es solo una red de
    // seguridad. Antes hacía hasta 24 peticiones/minuto por cada panel abierto.
    const interval = window.setInterval(() => void tick(), 30000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [enabled, popupReserva]);

  if (!enabled || !popupReserva) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Aviso de reserva">
      <div className={styles.alertCard}>
        <button className={styles.closeIcon} onClick={() => setPopupReserva(null)} aria-label="Cerrar aviso"><X /></button>
        <div className={styles.signal}><span><Radio /></span><b>ALERTA DE RESERVA</b><i>AHORA</i></div>
        <div className={styles.heroIcon}>{popupReserva?.__popup_kind === "tarotista_idle" ? <CheckCircle2 /> : <BellRing />}</div>
        <h2>{popupReserva?.__popup_kind === "tarotista_idle" ? "Tarotista disponible" : "Es hora de la reserva"}</h2>
        <p><strong>{popupReserva?.cliente_nombre || "Cliente"}</strong> {popupReserva?.__popup_kind === "tarotista_idle" ? "estaba esperando. La tarotista ha terminado y ya está libre." : "tiene una conexión programada en este momento."}</p>
        <div className={styles.missionData}><div><CalendarClock/><span>Hora programada<b>{parseReservaDate(popupReserva?.fecha_reserva)?.toLocaleString("es-ES") || "—"}</b></span></div>{(popupReserva?.tarotista_display_name || popupReserva?.tarotista_nombre || popupReserva?.tarotista_nombre_manual) ? <div><Radio/><span>Tarotista<b>{popupReserva?.tarotista_display_name || popupReserva?.tarotista_nombre || popupReserva?.tarotista_nombre_manual}</b></span></div> : null}</div>
        <div className={styles.actions}><button className={styles.secondary} onClick={() => setPopupReserva(null)}>Recordar después</button><button className={styles.primary} onClick={() => { const current = popupReserva; setPopupReserva(null); onGoToReserva?.(current); }}>Abrir reserva <ChevronRight /></button></div>
      </div>
    </div>
  );
}
