"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Download, ExternalLink, ImageIcon, MessageCircle, RefreshCw, Send } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  buildCaptacionMessage, buildCaptacionWhatsAppUrl, captacionContactName,
  CAPTACION_BENEFITS_IMAGE, type CaptacionMessageContact,
} from "@/lib/captacion-whatsapp";
import styles from "./CaptacionWhatsAppComposer.module.css";

export type { CaptacionMessageContact } from "@/lib/captacion-whatsapp";
export type CaptacionWhatsAppComposerProps = {
  contacts: readonly CaptacionMessageContact[];
  selectedLeadId: string | null;
  onSelectLead: (leadId: string | null) => void;
};

export default function CaptacionWhatsAppComposer({ contacts, selectedLeadId, onSelectLead }: CaptacionWhatsAppComposerProps) {
  const contact = contacts.find(item => item.id === selectedLeadId) || null;
  return <section className={styles.shell} aria-label="Preparar WhatsApp de captación" id="captacion-whatsapp">
    <header className={styles.header}>
      <span className={styles.icon}><MessageCircle size={22} aria-hidden="true"/></span>
      <div><span className={styles.eyebrow}>UNA BIENVENIDA QUE CONECTA</span><h2>Prepara su WhatsApp</h2><p>Elige el contacto, revisa el mensaje y comparte sus beneficios.</p></div>
      <span className={styles.pill}><ImageIcon size={14} aria-hidden="true"/> Mensaje + imagen</span>
    </header>
    <div className={styles.content}>
      <div className={styles.editor}>
        <label className={styles.field}>Contacto
          <select value={contact?.id || ""} onChange={event => onSelectLead(event.target.value || null)}>
            <option value="">Selecciona un contacto o pulsa «Enviar WhatsApp» en su tarjeta</option>
            {contacts.map(item => <option key={item.id} value={item.id}>{captacionContactName(item) || "Contacto sin nombre"}{item.cliente?.telefono ? ` · ${item.cliente.telefono}` : ""}</option>)}
          </select>
        </label>
        <OfficialSend contact={contact}/>
        <details className={styles.manual}>
          <summary>Preparación manual · copiar, editar y abrir WhatsApp</summary>
          <p>Los cambios de texto y número de esta sección se usan solo al copiar o abrir WhatsApp manualmente.</p>
          <MessageEditor key={contact?.id || "no-contact"} contact={contact}/>
        </details>
      </div>
      <ImageActions/>
    </div>
  </section>;
}

type OfficialStatus = {
  configured: boolean;
  ready: boolean;
  reason?: string | null;
  preview_message?: string | null;
  template: { status: string; name?: string; body?: string; media_url?: string } | null;
  delivery: { id: string; status: string; message_id?: string | null } | null;
};
type OfficialReceipt = { status: string; error?: string };

function updateOfficialReceipt(previous: Record<string, OfficialReceipt>, leadId: string, next: OfficialReceipt) {
  const current = previous[leadId];
  const confirmation: Record<string, number> = { accepted: 1, queued: 1, sent: 2, delivered: 3, read: 4 };
  const currentLevel = confirmation[current?.status] || 0;
  const nextLevel = confirmation[next.status] || 0;
  // A late POST response or older status read cannot erase delivery confirmation.
  if (currentLevel > nextLevel && (currentLevel >= 3 || ["sending", "unknown", "session", "blocked"].includes(next.status) || nextLevel > 0)) return previous;
  return { ...previous, [leadId]: next };
}

function officialDeliveryMessage(status: string) {
  if (status === "read") return "WhatsApp confirmó que el mensaje fue leído.";
  if (status === "delivered") return "WhatsApp confirmó la entrega del mensaje y la imagen.";
  if (status === "sent") return "WhatsApp indica que salió el mensaje. Aún falta confirmar la entrega.";
  if (["accepted", "queued"].includes(status)) return "WhatsApp aceptó la solicitud. La entrega está pendiente de confirmación.";
  if (status === "sending") return "La solicitud está en proceso. Comprueba su estado antes de intentar otra acción.";
  if (["failed", "undelivered"].includes(status)) return "El envío falló. Requiere revisión antes de volver a enviarlo.";
  return "Todavía no se pudo confirmar el resultado. Comprueba el estado; no se reenviará automáticamente.";
}

function officialConfigurationMessage(reason?: string | null) {
  if (reason === "ALREADY_SENT") return "Este contacto ya tiene un envío registrado.";
  if (reason === "PENDING_CONFIRMATION") return "Hay un envío pendiente de confirmación para este contacto.";
  if (reason === "DELIVERY_FAILED") return "El envío anterior necesita revisión antes de volver a intentarlo.";
  if (reason === "LEAD_CLOSED") return "El contacto está cerrado. Revisa su gestión antes de preparar un nuevo envío.";
  if (reason && /TEMPLATE/i.test(reason)) return "La plantilla de bienvenida está pendiente de aprobación o configuración en WhatsApp.";
  if (reason && /PHONE|RECIPIENT/i.test(reason)) return "Revisa el teléfono con prefijo de país en la ficha del CRM.";
  if (reason && /CONSENT|OPT_IN/i.test(reason)) return "Falta confirmar la autorización del contacto para recibir esta bienvenida por WhatsApp.";
  return "La conexión oficial está pendiente de configuración. Mientras tanto puedes preparar el mensaje manualmente.";
}

function OfficialSend({ contact }: { contact: CaptacionMessageContact | null }) {
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<{ scopeKey: string | null; loading: boolean; data: OfficialStatus | null; error: string }>({ scopeKey: null, loading: false, data: null, error: "" });
  const [receipts, setReceipts] = useState<Record<string, OfficialReceipt>>({});
  const requests = useRef(new Map<string, string>());
  const inFlight = useRef(new Set<string>());
  const leadId = contact?.id || null;
  const scopeKey = leadId ? `${leadId}:${contact?.latest_meta_lead_at || ""}` : null;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!leadId) {
      setView({ scopeKey: null, loading: false, data: null, error: "" });
      return () => { active = false; controller.abort(); };
    }
    setView({ scopeKey, loading: true, data: null, error: "" });
    void (async () => {
      try {
        const { data, error } = await supabaseBrowser().auth.getSession();
        if (!active) return;
        if (error || !data.session?.access_token) throw new Error("SESSION_REQUIRED");
        const response = await fetch(`/api/captacion/whatsapp?brand=celestial&lead_id=${encodeURIComponent(leadId)}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok || body.ok !== true) throw new Error(response.status === 401 ? "SESSION_REQUIRED" : "STATUS_UNAVAILABLE");
        if (!active) return;
        setView({ scopeKey, loading: false, data: body as OfficialStatus, error: "" });
        if (body.delivery?.status && scopeKey) setReceipts(previous => updateOfficialReceipt(previous, scopeKey, { status: body.delivery.status }));
        else setReceipts(previous => {
          if (!scopeKey || !["session", "blocked"].includes(previous[scopeKey]?.status)) return previous;
          const next = { ...previous }; delete next[scopeKey]; return next;
        });
      } catch (error) {
        if (!active) return;
        setView({ scopeKey, loading: false, data: null, error: error instanceof Error && error.message === "SESSION_REQUIRED" ? "Tu sesión ha caducado. Vuelve a entrar para consultar el envío oficial." : "No se pudo comprobar la conexión oficial. Pulsa «Comprobar estado» para consultarla de nuevo." });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [leadId, scopeKey, revision]);

  const current = view.scopeKey === scopeKey ? view : null;
  const status = current?.data;
  const receipt = scopeKey ? receipts[scopeKey] : null;
  const loading = Boolean(leadId && (!current || current.loading));
  const ready = Boolean(contact && !loading && status?.ready && status.template && !receipt);
  const preview = status?.preview_message || (contact && status?.template?.body ? status.template.body.replace(/\{\{1\}\}/g, () => captacionContactName(contact)) : "");

  async function send() {
    if (!leadId || !scopeKey || !ready || inFlight.current.has(scopeKey)) return;
    const targetId = leadId;
    const targetKey = scopeKey;
    inFlight.current.add(targetKey);
    setReceipts(previous => ({ ...previous, [targetKey]: { status: "sending" } }));
    let dispatched = false;
    try {
      const { data, error } = await supabaseBrowser().auth.getSession();
      if (error || !data.session?.access_token) throw new Error("SESSION_REQUIRED");
      const requestId = requests.current.get(targetKey) || crypto.randomUUID();
      requests.current.set(targetKey, requestId);
      dispatched = true;
      const response = await fetch("/api/captacion/whatsapp?brand=celestial", {
        method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: targetId, request_id: requestId }),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true) {
        const rejectedBeforeSending = [400, 401, 403, 404, 409].includes(response.status);
        setReceipts(previous => updateOfficialReceipt(previous, targetKey, rejectedBeforeSending ? {
          status: "blocked", error: response.status === 401 ? "La sesión caducó antes de iniciar el envío. Vuelve a entrar y comprueba su estado." : "El envío no se inició. Revisa el contacto y la conexión, y pulsa «Comprobar estado».",
        } : { status: "unknown", error: "No se confirmó el envío. Comprueba su estado antes de continuar." }));
        return;
      }
      setReceipts(previous => updateOfficialReceipt(previous, targetKey, { status: String(body.status || "unknown") }));
    } catch {
      setReceipts(previous => updateOfficialReceipt(previous, targetKey, { status: dispatched ? "unknown" : "session", error: dispatched ? "La conexión se interrumpió. El envío podría seguir en curso: comprueba su estado." : "No se inició el envío. Vuelve a entrar y comprueba el estado antes de continuar." }));
    } finally { inFlight.current.delete(targetKey); }
  }

  return <div className={styles.official} aria-label="Envío oficial por WhatsApp">
    <div className={styles.officialTitle}><CheckCircle2 size={17} aria-hidden="true"/><strong>Mensaje + imagen por WhatsApp</strong><span>Envío oficial</span></div>
    <p>{contact ? <>Para <strong>{captacionContactName(contact) || "el contacto seleccionado"}</strong> · {contact.cliente?.telefono || "Sin teléfono en el CRM"}</> : "Selecciona un contacto para comprobar su envío."}</p>
    {preview && <details className={styles.templatePreview}><summary>Ver la bienvenida que se enviará</summary><p>{preview}</p><small>Incluye la imagen de beneficios de Tarot Celestial.</small></details>}
    <p className={styles.officialState} role="status">{loading ? "Comprobando conexión y envío anterior…" : receipt ? receipt.error || officialDeliveryMessage(receipt.status) : current?.error || (status ? status.ready ? "Todo preparado. Envía la bienvenida con su nombre y la imagen en un solo paso." : officialConfigurationMessage(status.reason) : "La plantilla oficial usa el nombre y el teléfono guardados en su ficha.")}</p>
    <div className={styles.actions}>
      <button type="button" className={styles.whatsapp} disabled={!ready} onClick={() => void send()}><Send size={16} aria-hidden="true"/>{receipt?.status === "sending" ? "Envío en proceso…" : "Enviar WhatsApp"}</button>
      <button type="button" className={styles.checkStatus} disabled={!contact || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} aria-hidden="true"/>Comprobar estado</button>
    </div>
    <small>Se enviará la plantilla aprobada y la imagen al número del CRM. La preparación manual de abajo es independiente.</small>
  </div>;
}

function MessageEditor({ contact }: { contact: CaptacionMessageContact | null }) {
  const [message, setMessage] = useState(() => contact ? buildCaptacionMessage(contact) : "");
  const [phone, setPhone] = useState(() => contact?.cliente?.telefono || "");
  const [feedback, setFeedback] = useState("");
  const preview = useRef<HTMLTextAreaElement>(null);
  const url = contact ? buildCaptacionWhatsAppUrl(phone, message) : null;

  async function copyMessage() {
    if (!contact || !message.trim()) return;
    try {
      await navigator.clipboard.writeText(message);
      setFeedback("Mensaje copiado. Puedes pegarlo en WhatsApp y añadir la imagen.");
    } catch {
      preview.current?.focus();
      preview.current?.select();
      setFeedback("Seleccionamos el mensaje: pulsa Ctrl+C o mantén pulsado para copiarlo.");
    }
  }

  return <>
    <label className={styles.field}>Mensaje personalizado · editable
      <textarea ref={preview} value={message} disabled={!contact} rows={6} onChange={event => { setMessage(event.target.value); setFeedback(""); }} placeholder="Selecciona a quién quieres dar la bienvenida."/>
    </label>
    <div className={styles.destination}>
      <label className={styles.field}>Número para WhatsApp
        <input type="tel" inputMode="tel" value={phone} disabled={!contact} onChange={event => { setPhone(event.target.value); setFeedback(""); }} placeholder="Incluye + y el prefijo del país" aria-describedby="captacion-whatsapp-phone-help"/>
      </label>
      <p id="captacion-whatsapp-phone-help">{contact && !buildCaptacionWhatsAppUrl(phone, "comprobar") ? "Confirma el número completo con su prefijo de país para abrir WhatsApp." : "Puedes corregir el destinatario para este envío sin cambiar su ficha."}</p>
    </div>
    <div className={styles.actions}>
      <button className={styles.copy} type="button" disabled={!contact || !message.trim()} onClick={() => void copyMessage()}><Copy size={16} aria-hidden="true"/>Copiar mensaje</button>
      {url ? <a className={styles.whatsapp} href={url} target="_blank" rel="noopener noreferrer" onClick={() => setFeedback("WhatsApp se abrirá con el texto preparado. Pega o adjunta la imagen y revisa antes de enviar.")}><Send size={16} aria-hidden="true"/>Abrir WhatsApp<ExternalLink size={13} aria-hidden="true"/></a> : <button className={styles.whatsapp} type="button" disabled><Send size={16} aria-hidden="true"/>Abrir WhatsApp</button>}
    </div>
    <p className={styles.hint}>El texto se prepara al abrir WhatsApp. La imagen se pega o adjunta dentro del chat.</p>
    <p className={styles.feedback} role="status">{feedback}</p>
  </>;
}

function ImageActions() {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function copyImage() {
    if (busy) return;
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      setFeedback("Este navegador no permite copiar imágenes. Descárgala y adjúntala en WhatsApp.");
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      // Pass the fetch promise immediately, preserving clipboard user activation.
      const png = fetch(CAPTACION_BENEFITS_IMAGE, { cache: "force-cache" }).then(async response => {
        if (!response.ok) throw new Error("IMAGE_UNAVAILABLE");
        const blob = await response.blob();
        if (blob.type !== "image/png") throw new Error("INVALID_IMAGE");
        return blob;
      });
      // A denied clipboard may reject before it ever reads the promised blob.
      void png.catch(() => undefined);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setFeedback("Imagen copiada. En WhatsApp pulsa Ctrl+V o Pegar para añadirla al chat.");
    } catch {
      setFeedback("No se pudo copiar la imagen. Descárgala y adjúntala en WhatsApp.");
    } finally { setBusy(false); }
  }

  return <aside className={styles.imagePanel} aria-label="Imagen de beneficios para compartir">
    <a className={styles.imagePreview} href={CAPTACION_BENEFITS_IMAGE} target="_blank" rel="noopener noreferrer" aria-label="Ver imagen de beneficios completa">
      <img src={CAPTACION_BENEFITS_IMAGE} alt="Tarot Celestial: panel cliente, ruletas de tres niveles, Coins, Oráculo y beneficios por rango" loading="lazy"/>
      <span>Ver imagen completa <ExternalLink size={13} aria-hidden="true"/></span>
    </a>
    <button type="button" className={styles.copyImage} disabled={busy} onClick={() => void copyImage()}><ImageIcon size={16} aria-hidden="true"/>{busy ? "Copiando imagen…" : "Copiar imagen"}</button>
    <a className={styles.download} href={CAPTACION_BENEFITS_IMAGE} download="Tarot-Celestial-beneficios.png"><Download size={15} aria-hidden="true"/>Descargar imagen</a>
    <p className={styles.imageFeedback} role="status">{feedback || "1. Copia la imagen. 2. Abre WhatsApp. 3. Pégala y envía con el mensaje."}</p>
  </aside>;
}
