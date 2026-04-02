"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

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

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function getTokenOrLogin() {
      const { data } = await sb.auth.getSession();
      return data.session?.access_token || "";
    }

    async function tick() {
      try {
        if (popupReserva) return;
        const token = await getTokenOrLogin();
        if (!token) return;
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
      } catch {}
    }

    tick();
    const interval = window.setInterval(tick, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [enabled, popupReserva]);

  if (!enabled || !popupReserva) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 16 }}>
      <div className="tc-card" style={{ width: "100%", maxWidth: 520, borderRadius: 24, boxShadow: "0 30px 90px rgba(0,0,0,0.48)", background: "radial-gradient(circle at top right, rgba(215,181,109,.16), transparent 26%), radial-gradient(circle at top left, rgba(181,156,255,.12), transparent 24%), linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04))" }}>
        <div className="tc-title">⏰ Reserva ahora</div>
        <div className="tc-sub" style={{ marginTop: 10 }}><b>{popupReserva?.cliente_nombre || "Cliente"}</b> ya tiene su reserva programada.</div>
        <div className="tc-sub" style={{ marginTop: 6 }}>Hora: <b>{parseReservaDate(popupReserva?.fecha_reserva)?.toLocaleString("es-ES") || "—"}</b></div>
        {(popupReserva?.tarotista_display_name || popupReserva?.tarotista_nombre || popupReserva?.tarotista_nombre_manual) ? <div className="tc-sub" style={{ marginTop: 6 }}>Tarotista: <b>{popupReserva?.tarotista_display_name || popupReserva?.tarotista_nombre || popupReserva?.tarotista_nombre_manual}</b></div> : null}
        <div className="tc-row" style={{ marginTop: 18, justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          <button className="tc-btn" onClick={() => setPopupReserva(null)}>Cerrar</button>
          <button className="tc-btn tc-btn-ok" onClick={() => { const current = popupReserva; setPopupReserva(null); onGoToReserva?.(current); }}>Ir a la reserva</button>
        </div>
      </div>
    </div>
  );
}
