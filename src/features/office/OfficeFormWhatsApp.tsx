"use client";

import { useEffect, useState } from "react";
import { officeRequest } from "./office-client";
import s from "./OfficeMonthlyReport.module.css";

const senders = { sandbox: "Número de pruebas", missing: "Falta configurar el número", configured: "Número configurado" };
const templates = { missing: "Falta configurar la plantilla", approved: "Aprobada", pending: "Sin aprobación vigente",
  mismatch: "Revisar el texto y la imagen de Captación", unverified: "Pendiente de verificación" };
type Status = { sender: keyof typeof senders; template: keyof typeof templates; ready: boolean; enabled: boolean;
  consent: number | null; forms: number | null;
  coverage: { month: string; submissions: number; granted: number; declined: number; missing: number; review: number } };

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
            `${state.consent} de ${state.forms} oportunidades de formulario tienen permiso para WhatsApp en su última entrada`}</li></ul>
        <p className={s.note}><strong>Respuestas de {state.coverage.month} · {state.coverage.submissions} envíos de formulario verificados</strong><br/>
          Con permiso · {state.coverage.granted} · Rechazado · {state.coverage.declined} · Sin respuesta registrada · {state.coverage.missing} ·
          {' '}Por verificar · {state.coverage.review}</p>
        <details className={s.details}><summary>Cómo recoger el permiso en Meta</summary>
          <p className={s.note}>En el formulario, añade una casilla opcional con la clave <code>whatsapp_opt_in</code> y el texto
            {' '}«Acepto que Tarot Celestial me escriba por WhatsApp al número que he indicado para responder a mi solicitud e informarme del Oráculo y de los beneficios de la consulta».
            Deja la casilla desmarcada y pide el número con el prefijo internacional. La Oficina comprueba la respuesta de ese envío y el número antes de contactar.</p>
        </details>
      </>)}
  </details>;
}
