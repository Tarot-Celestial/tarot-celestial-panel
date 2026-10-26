"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ImagePlus, MessageCircle, Save, ShieldCheck, Smartphone, Trash2, Users } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { blankWhatsAppDraftSlots, parseWhatsAppContactLines, renderWhatsAppDraftMessage, safeWhatsAppDraftImage, type WhatsAppDraft, type WhatsAppDraftContact, type WhatsAppDraftSlot } from "@/lib/whatsapp-campaign-drafts";
import styles from "./AdminWhatsAppCampaignsPanel.module.css";

async function request(body?: object | FormData, signal?: AbortSignal) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("Inicia sesión con tu cuenta de administración.");
  const upload = body instanceof FormData;
  const response = await fetch(`/api/admin/whatsapp-campaign-drafts${upload ? "/image" : ""}`, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(!upload ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: upload ? body : JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "No se pudo completar la operación. Vuelve a intentarlo.");
  return result;
}

const consentLabel = { pending: "Por confirmar", confirmed: "Permiso confirmado", withdrawn: "No contactar" };

export default function AdminWhatsAppCampaignsPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [draft, setDraft] = useState<WhatsAppDraft>(() => ({ version: 0, updated_at: null, slots: blankWhatsAppDraftSlots() }));
  const [active, setActive] = useState(1);
  const [inputs, setInputs] = useState<Record<number, string>>({ 1: "", 2: "" });
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [page, setPage] = useState(0);
  const [previewId, setPreviewId] = useState("");
  const mutation = useRef(false);
  const alive = useRef(true);
  const saveAttempt = useRef<{ key: string; id: string } | null>(null);
  const input = inputs[active] || "";
  const setInput = (value: string) => setInputs(current => ({ ...current, [active]: value }));
  const hasUnsavedChanges = dirty || Object.values(inputs).some(value => value.trim());

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    request(undefined, controller.signal).then(result => { if (!cancelled) { setDraft(result.draft); setReady(true); } })
      .catch(e => { if (!cancelled) setError(e.name === "AbortError" ? "La conexión tardó demasiado. Vuelve a abrir WhatsApp para reintentar." : e.message); })
      .finally(() => { clearTimeout(timer); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; clearTimeout(timer); controller.abort(); };
  }, []);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);
  useEffect(() => { onDirtyChange?.(hasUnsavedChanges); }, [hasUnsavedChanges, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const slot = draft.slots.find(item => item.slot === active)!;
  const allContacts = draft.slots.flatMap(item => item.contacts);
  const previewContact = slot.contacts.find(item => item.id === previewId) || slot.contacts[0];
  const allowed = slot.contacts.filter(item => item.consent_status === "confirmed" && item.consent_note.trim().length >= 3 && item.name.trim()).length;
  const totalPages = Math.max(1, Math.ceil(slot.contacts.length / 20));
  let previewImage = "";
  try { previewImage = safeWhatsAppDraftImage(slot.image_url, process.env.NEXT_PUBLIC_SUPABASE_URL); } catch { /* Validation is also enforced on save. */ }

  function edit(patch: Partial<WhatsAppDraftSlot>) {
    setDraft(current => ({ ...current, slots: current.slots.map(item => item.slot === active ? { ...item, ...patch } : item) }));
    setDirty(true); setNotice("");
  }
  function editContact(id: string, patch: Partial<WhatsAppDraftContact>) {
    edit({ contacts: slot.contacts.map(contact => contact.id === id ? { ...contact, ...patch } : contact) });
  }
  async function act(key: string, work: (signal: AbortSignal) => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true; setBusy(key); setError(""); setNotice("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try { await work(controller.signal); }
    catch (e: any) { if (alive.current) setError(e.name === "AbortError" ? "No se pudo confirmar la operación a tiempo. Puedes reintentar; no se enviará ningún mensaje." : e.message); }
    finally { clearTimeout(timer); mutation.current = false; if (alive.current) setBusy(""); }
  }
  async function addContacts(signal: AbortSignal) {
    const parsedResult = parseWhatsAppContactLines(input);
    if (parsedResult.errors.length) throw new Error(parsedResult.errors.map(item => `Línea ${item.line}: ${item.message}`).slice(0, 5).join(" · "));
    const parsed = parsedResult.contacts;
    const existing = new Set(allContacts.map(contact => contact.phone));
    const fresh = parsed.filter(contact => !existing.has(contact.phone));
    if (!fresh.length) throw new Error("No hay números nuevos. Un número solo puede estar en una de las dos listas.");
    if (slot.contacts.length + fresh.length > 300) throw new Error("Cada lista admite hasta 300 contactos en este borrador.");
    const resolved = await request({ action: "resolve", phones: fresh.map(contact => contact.phone) }, signal);
    if (!alive.current) return;
    const names = new Map<string, string>((resolved.contacts || []).filter((contact: any) => contact.match === "unique").map((contact: any) => [contact.phone, contact.name]));
    const added: WhatsAppDraftContact[] = fresh.map(contact => ({ ...contact, id: crypto.randomUUID(), name: contact.name || names.get(contact.phone) || "", consent_status: "pending", consent_note: "" }));
    edit({ contacts: [...slot.contacts, ...added] }); setInput("");
    setNotice(`${added.length} contactos añadidos al borrador.${parsed.length > fresh.length ? " Se omitieron números ya presentes en las listas." : ""} Revisa sus nombres y permisos.`);
  }
  async function save(signal: AbortSignal) {
    if (Object.values(inputs).some(value => value.trim())) throw new Error("Hay números escritos que aún no has añadido. Añádelos a su lista antes de guardar los dos borradores.");
    const key = JSON.stringify({ version: draft.version, slots: draft.slots });
    if (saveAttempt.current?.key !== key) saveAttempt.current = { key, id: crypto.randomUUID() };
    const result = await request({ action: "save", request_id: saveAttempt.current.id, expected_version: draft.version, slots: draft.slots }, signal);
    if (!alive.current) return;
    setDraft(result.draft); setDirty(false); saveAttempt.current = null;
    setNotice("Los dos borradores están guardados. No se ha enviado ningún mensaje.");
  }
  async function upload(file: File, signal: AbortSignal) {
    if (file.size > 3 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Usa una imagen JPG, PNG o WebP de hasta 3 MB.");
    const form = new FormData(); form.set("file", file);
    const result = await request(form, signal);
    if (alive.current) { edit({ image_url: result.image_url }); setNotice("Imagen subida. Guarda el borrador para conservarla en esta lista."); }
  }

  return <section className={styles.shell} aria-label="WhatsApp de administración">
    <header className={styles.hero}>
      <div className={styles.heroTitle}><span className={styles.heroIcon}><MessageCircle size={28}/></span><div><p className={styles.eyebrow}>COMUNICACIÓN · ADMIN</p><h1>Tu centro de WhatsApp</h1><p>Dos números, listas ordenadas y un mensaje pensado para cada clienta.</p></div></div>
      <span className={styles.stage}><span/>Preparación de campañas</span>
    </header>
    <div className={styles.connection}><ShieldCheck size={22}/><div><strong>La automatización necesita conexión oficial</strong><p>Puedes guardar números, destinatarios, mensajes e imágenes. El envío seguirá desactivado hasta conectar y verificar las dos cuentas de WhatsApp Business y sus plantillas. Estos espacios no cambian el WhatsApp compartido de Centrales.</p></div></div>
    {error && <div role="alert" className={styles.error}><AlertCircle size={18}/>{error}</div>}
    {notice && <div role="status" className={styles.notice}><Check size={18}/>{notice}</div>}
    {loading ? <div role="status" className={styles.card}>Cargando tus borradores…</div> : !ready ? <div className={styles.card}><p>No se han cargado los borradores. Tus datos guardados se conservan.</p><button className={styles.save} disabled={!!busy} onClick={() => void act("reload", async signal => { const result = await request(undefined, signal); if (alive.current) { setDraft(result.draft); setReady(true); } })}>Reintentar carga</button></div> : <>
      <div className={styles.accounts} role="group" aria-label="Listas por número">
        {draft.slots.map(item => <button key={item.slot} type="button" id={`wa-slot-${item.slot}`} aria-controls="wa-slot-panel" aria-pressed={active === item.slot} disabled={!!busy} className={styles.account} onClick={() => { setActive(item.slot); setPage(0); setPreviewId(""); setNotice(""); }}>
          <span className={styles.accountIcon}><Smartphone size={24}/></span><span className={styles.accountText}><strong>{item.label || `WhatsApp ${item.slot}`}</strong><span>{item.sender_phone || "Número por indicar"}</span><small>{item.contacts.length} contactos · Conexión pendiente</small></span><span className={styles.accountNumber}>0{item.slot}</span>
        </button>)}
      </div>
      <div id="wa-slot-panel" role="region" aria-labelledby={`wa-slot-${active}`}>
        <fieldset disabled={!!busy} className={styles.editor}>
          <div className={styles.formColumn}>
            <section className={styles.card}><h2><Smartphone size={20}/>Tu número y tu mensaje</h2><div className={styles.twoFields}>
              <label>Nombre de esta lista<input maxLength={60} value={slot.label} onChange={e => edit({ label: e.target.value })} placeholder={active === 1 ? "WhatsApp principal" : "Segundo WhatsApp"}/></label>
              <label>Número que enviará · con prefijo<input type="tel" autoComplete="off" value={slot.sender_phone} onChange={e => edit({ sender_phone: e.target.value })} placeholder="+34…" maxLength={30}/></label>
            </div><label>Mensaje predeterminado<textarea rows={7} maxLength={1500} value={slot.message} onChange={e => edit({ message: e.target.value })} placeholder="Hola {{nombre}}, tenemos una novedad para ti…"/></label>
              <div className={styles.messageHint}><button type="button" disabled={slot.message.length + (slot.message && !slot.message.endsWith(" ") ? 1 : 0) + 10 > 1500} onClick={() => edit({ message: `${slot.message}${slot.message && !slot.message.endsWith(" ") ? " " : ""}{{nombre}}` })}>+ Añadir nombre</button><span>{slot.message.length}/1500</span></div>
              <p className={styles.help}>El marcador {"{{nombre}}"} toma el nombre de cada contacto. Si el número coincide con una única ficha CRM, te proponemos su nombre para revisarlo.</p>
              <div className={styles.imageField}><label className={styles.upload}><ImagePlus size={19}/>Adjuntar imagen<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void act("image", signal => upload(file, signal)); }}/></label><span className={styles.help}>JPG, PNG o WebP · hasta 3 MB</span></div>
              <label>Enlace de la imagen · opcional<input type="url" value={slot.image_url} onChange={e => edit({ image_url: e.target.value })} placeholder="Imagen de Tarot Celestial" maxLength={2000}/></label>
              <p className={styles.help}>Al adjuntarla se crea un enlace público para tu imagen promocional. También puedes pegar una imagen del sitio o del almacenamiento de Tarot Celestial.</p>
              {slot.image_url && !previewImage && <p className={styles.help}>Ese enlace no es compatible. Adjunta el archivo para crear un enlace válido.</p>}
            </section>
          </div>
          <aside className={styles.previewCard}><div className={styles.previewHeading}><MessageCircle size={20}/><strong>Vista previa</strong><span>Sin enviar</span></div>
            <label>Ver mensaje para<select value={previewContact?.id || ""} onChange={e => setPreviewId(e.target.value)}><option value="" disabled>Primero añade contactos</option>{slot.contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name || "Falta nombre"} · {contact.phone}</option>)}</select></label>
            <div className={styles.phonePreview}><div className={styles.chatHeader}><span><MessageCircle size={20}/></span><div><strong>{slot.label || `WhatsApp ${active}`}</strong><small>Vista previa de tu borrador</small></div></div><div className={styles.bubble}>
              {previewImage && <img src={previewImage} alt="Imagen seleccionada para la promoción" loading="lazy" referrerPolicy="no-referrer"/>}
              <p>{slot.message ? renderWhatsAppDraftMessage(slot.message, previewContact?.name || "") : "Tu mensaje aparecerá aquí."}</p><span>Borrador</span>
            </div></div>
            <div className={styles.previewNote}><ShieldCheck size={17}/><p>«Enviado», «entregado» y «leído» se mostrarán solo cuando la conexión oficial confirme cada estado. Ahora no hay envíos activos.</p></div>
          </aside>
          <section className={`${styles.card} ${styles.recipients}`}><div className={styles.sectionHeading}><div><h2><Users size={20}/>Destinatarios de esta lista</h2><p className={styles.help}>Añade los números que tú elijas. No se importan clientas automáticamente.</p></div><span className={styles.count}>{slot.contacts.length}/300</span></div>
            <label>Números y nombres · uno por línea<textarea rows={3} value={input} onChange={e => setInput(e.target.value)} placeholder={"+34600000000; Ana\n+17870000000; María"}/></label>
            <div className={styles.addRow}><button type="button" disabled={!input.trim() || !!busy} onClick={() => void act("contacts", addContacts)}>{busy === "contacts" ? "Buscando nombres…" : "Añadir y buscar nombres en CRM"}</button><p className={styles.help}>Incluye el prefijo internacional. Los duplicados no pasan a la otra lista.</p></div>
            <div className={styles.consentInfo}><ShieldCheck size={18}/><span>Confirma el permiso para recibir promociones e indica cómo lo obtuviste. «No contactar» excluye a esa persona; cambiar de número no sustituye su permiso.</span></div>
            {!slot.contacts.length ? <div className={styles.empty}><Users size={28}/><strong>Tu lista está vacía</strong><span>Aquí verás los contactos y el mensaje personalizado que preparas para cada uno.</span></div> : <>
              <div className={styles.tableScroll}><table><thead><tr><th>Clienta y número</th><th>Permiso de comunicación</th><th><span className={styles.srOnly}>Acciones</span></th></tr></thead><tbody>{slot.contacts.slice(page * 20, (page + 1) * 20).map(contact => <tr key={contact.id}>
                <td><input aria-label={`Nombre de ${contact.phone}`} value={contact.name} onChange={e => editContact(contact.id, { name: e.target.value })} maxLength={120} placeholder="Escribe su nombre"/><small>{contact.phone}</small></td>
                <td><select aria-label={`Permiso de ${contact.phone}`} value={contact.consent_status} onChange={e => editContact(contact.id, { consent_status: e.target.value as WhatsAppDraftContact["consent_status"] })}>{Object.entries(consentLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input aria-label={`Origen del permiso de ${contact.phone}`} value={contact.consent_note} onChange={e => editContact(contact.id, { consent_note: e.target.value })} maxLength={300} placeholder={contact.consent_status === "withdrawn" ? "Motivo o fecha de la baja" : "Cómo y cuándo dio permiso"}/></td>
                <td><button className={styles.remove} type="button" aria-label={`Quitar ${contact.name || contact.phone} de este borrador`} onClick={() => { edit({ contacts: slot.contacts.filter(item => item.id !== contact.id) }); setPage(0); }}><Trash2 size={17}/></button></td>
              </tr>)}</tbody></table></div>
              <div className={styles.pagination}><button type="button" disabled={!page} onClick={() => setPage(value => value - 1)}>Anterior</button><span>{page + 1} / {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage(value => value + 1)}>Siguiente</button></div>
            </>}
          </section>
          <section className={`${styles.card} ${styles.readiness}`}><div><h2><ShieldCheck size={20}/>Antes de automatizar</h2><p>{allowed} contactos con nombre y permiso documentado en esta lista.</p><p className={styles.help}>Falta verificar la conexión oficial de los números, aprobar la plantilla y revisar los límites y costes. Un ritmo de 10 mensajes cada 10 minutos no garantiza evitar bloqueos. La programación y las pausas se ajustarán a los límites reales de la cuenta.</p></div><span className={styles.pending}>Envío desactivado</span></section>
          <footer className={styles.saveBar}><div><strong>{hasUnsavedChanges ? "Cambios sin guardar" : "Tus borradores"}</strong><span>{draft.updated_at ? `Último guardado: ${new Date(draft.updated_at).toLocaleString("es-ES")}` : "Guarda ambos espacios para continuar después."}</span></div><button className={styles.save} type="button" disabled={!!busy} onClick={() => void act("save", save)}><Save size={18}/>{busy === "save" ? "Guardando…" : "Guardar los dos borradores"}</button></footer>
        </fieldset>
      </div>
    </>}
  </section>;
}
