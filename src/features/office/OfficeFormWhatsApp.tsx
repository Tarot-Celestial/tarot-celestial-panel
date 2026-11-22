"use client";

import { useEffect, useState } from "react";
import { officeRequest } from "./office-client";
import s from "./OfficeMonthlyReport.module.css";

const senders = { sandbox: "Número de pruebas", missing: "Falta configurar el número", configured: "Número configurado" };
const templates = { missing: "Falta configurar la plantilla", approved: "Aprobada", pending: "Sin aprobación vigente",
  mismatch: "Revisar el texto y la imagen de Captación", unverified: "Pendiente de verificación" };
type Status = { sender: keyof typeof senders; template: keyof typeof templates; ready: boolean; enabled: boolean;
  consent: number | null; forms: number | null };

export default function OfficeFormWhatsApp() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState(null); setError(false);
    officeRequest<Status>("/api/admin/office/form-whatsapp", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setState(value);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [open]);
  return <details className={s.details} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Iniciar WhatsApp desde formularios de Meta</summary>
    {open && (error ? <p role="alert">No se pudo leer el estado. Cierra y vuelve a abrir para consultar.</p> :
      !state ? <p role="status">Comprobando remitente, plantilla y permisos…</p> : <>
        <p className={s.note}>Envío con plantilla · {state.ready ? "Proveedor preparado" : "Pendiente de habilitar"}</p>
        <ul><li>Remitente de Twilio · {senders[state.sender]}</li>
          <li>Plantilla de bienvenida · {templates[state.template]}</li>
          <li>Envíos desde formularios · {state.enabled ? "Habilitados en la configuración" : "Desactivados en la configuración"}</li>
          <li>{state.forms === null || state.consent === null ? "Permisos sin datos" :
            `${state.consent} de ${state.forms} formularios incorporados acreditan permiso para WhatsApp`}</li></ul>
        <p className={s.note}>El permiso procede de la respuesta expresa de cada contacto en el formulario. Los mensajes que llegan directamente a Central se atienden desde la bandeja vinculada.</p>
      </>)}
  </details>;
}
