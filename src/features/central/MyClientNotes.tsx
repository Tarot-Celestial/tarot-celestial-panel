"use client";

import { Bold, Edit3, FileText, Pin, PinOff, Save, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./MyClientNotes.module.css";

type NoteRow = {
  id: string;
  cliente_id?: string | null;
  texto?: string | null;
  author_name?: string | null;
  author_email?: string | null;
  author_user_id?: string | null;
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

type Props = {
  clientId: string;
  notes: NoteRow[];
  onRefresh: () => void | Promise<void>;
};

function sortNotes(notes: NoteRow[]) {
  return [...notes].sort((a, b) => {
    const pinDiff = Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned));
    if (pinDiff) return pinDiff;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

function noteTone(text: string) {
  const value = String(text || "").toLowerCase();
  if (value.includes("compra web") || value.includes("panel cliente") || value.includes("stripe checkout") || value.includes("checkout completado")) return "webPurchase";
  if (value.includes("paypal")) return "paypal";
  if (value.includes("bizum")) return "bizum";
  if (value.includes("tpv")) return "tpv";
  if (value.includes("compra registrada")) return "purchase";
  if (value.includes("canje")) return "exchange";
  if (value.includes("cliente usa") || value.includes("uso actual:") || value.includes("minutos")) return "minutes";
  if (value.includes("llamada")) return "call";
  if (value.includes("seguimiento")) return "followUp";
  if (value.includes("promo")) return "promo";
  return "manual";
}

function toneLabel(note: NoteRow) {
  const explicit = note.tipo || note.type;
  if (explicit) return explicit;
  const tone = noteTone(note.texto || "");
  const labels: Record<string, string> = {
    webPurchase: "Compra web",
    paypal: "PayPal",
    bizum: "Bizum",
    tpv: "TPV",
    purchase: "Compra",
    exchange: "Canje",
    minutes: "Minutos",
    call: "Llamada",
    followUp: "Seguimiento",
    promo: "Promoción",
    manual: note.is_automatic || note.automatic ? "Sistema" : "Nota manual",
  };
  return labels[tone] || "Nota";
}

function formatDate(value?: string | null) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderNoteText(text: string) {
  return String(text || "").split(/\n/).map((line, lineIndex, lines) => (
    <span key={`line-${lineIndex}`}>
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
        /^\*\*[^*]+\*\*$/.test(part)
          ? <strong key={`part-${lineIndex}-${partIndex}`}>{part.slice(2, -2)}</strong>
          : <span key={`part-${lineIndex}-${partIndex}`}>{part}</span>
      )}
      {lineIndex < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

function applyBold(value: string, start: number, end: number) {
  const safeStart = Number.isFinite(start) ? start : value.length;
  const safeEnd = Number.isFinite(end) ? end : value.length;
  const selected = value.slice(safeStart, safeEnd) || "texto en negrita";
  return `${value.slice(0, safeStart)}**${selected}**${value.slice(safeEnd)}`;
}

async function getToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || null;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
}

export default function MyClientNotes({ clientId, notes, onRefresh }: Props) {
  const orderedNotes = useMemo(() => sortNotes(notes || []), [notes]);
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const newNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const editNoteRef = useRef<HTMLTextAreaElement | null>(null);

  async function runAction(action: () => Promise<void>, busyKey: string, success: string) {
    try {
      setBusy(busyKey);
      setMessage("");
      await action();
      await onRefresh();
      setMessage(success);
    } catch (error: any) {
      setMessage(error?.message || "No se pudo completar la acción.");
    } finally {
      setBusy("");
    }
  }

  async function createNote() {
    const text = newNote.trim();
    if (!text) {
      setMessage("Escribe una nota antes de guardarla.");
      return;
    }
    await runAction(async () => {
      const accessToken = await getToken();
      if (!accessToken) throw new Error("No se pudo validar la sesión.");
      const response = await fetch("/api/crm/clientes/notas/crear", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clientId, texto: text }),
      });
      await readJson(response);
      setNewNote("");
    }, "create", "Nota guardada correctamente.");
  }

  async function togglePin(note: NoteRow) {
    await runAction(async () => {
      const response = await fetch("/api/crm/clientes/notas/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: note.id, is_pinned: !note.is_pinned }),
      });
      await readJson(response);
    }, `pin-${note.id}`, note.is_pinned ? "Nota desanclada." : "Nota anclada.");
  }

  async function updateNote(noteId: string) {
    const text = editingText.trim();
    if (!text) {
      setMessage("La nota no puede estar vacía.");
      return;
    }
    await runAction(async () => {
      const response = await fetch("/api/crm/clientes/notas/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: noteId, texto: text }),
      });
      await readJson(response);
      setEditingId("");
      setEditingText("");
    }, `edit-${noteId}`, "Nota actualizada correctamente.");
  }

  function startEdit(note: NoteRow) {
    setEditingId(String(note.id));
    setEditingText(String(note.texto || ""));
    setMessage("");
    setTimeout(() => editNoteRef.current?.focus(), 0);
  }

  return (
    <section className={styles.notesPanel} aria-labelledby="my-client-notes-title">
      <header className={styles.header}>
        <div className={styles.headingIcon}><FileText size={22} aria-hidden="true" /></div>
        <div>
          <h3 id="my-client-notes-title">Historial de notas</h3>
          <p>Notas manuales y eventos automáticos compartidos con la ficha del CRM.</p>
        </div>
      </header>

      <div className={styles.composer}>
        <div className={styles.composerTop}>
          <span>Usa <strong>**texto**</strong> para destacar contenido.</span>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              const element = newNoteRef.current;
              setNewNote(applyBold(newNote, element?.selectionStart ?? newNote.length, element?.selectionEnd ?? newNote.length));
              setTimeout(() => element?.focus(), 0);
            }}
          ><Bold size={16} /> Negrita</button>
        </div>
        <textarea
          ref={newNoteRef}
          value={newNote}
          onChange={(event) => setNewNote(event.target.value)}
          placeholder="Escribe una nueva nota de la clienta…"
          aria-label="Nueva nota"
        />
        <div className={styles.composerActions}>
          <button type="button" className={styles.primaryButton} onClick={createNote} disabled={busy === "create" || !newNote.trim()}>
            <Save size={17} /> {busy === "create" ? "Guardando…" : "Guardar nota"}
          </button>
        </div>
        {message && <div className={styles.message} role="status">{message}</div>}
      </div>

      <div className={styles.listHeader}>
        <strong>{orderedNotes.length} {orderedNotes.length === 1 ? "nota" : "notas"}</strong>
        <span>Las ancladas aparecen primero; el resto se ordena de más reciente a más antigua.</span>
      </div>

      {orderedNotes.length ? (
        <div className={styles.noteList}>
          {orderedNotes.map((note) => {
            const tone = noteTone(note.texto || "");
            const origin = note.origen || note.origin;
            const isAutomatic = Boolean(note.is_automatic || note.automatic);
            const isEditing = editingId === String(note.id);
            return (
              <article key={note.id} className={`${styles.noteCard} ${styles[tone]} ${note.is_pinned ? styles.pinned : ""}`}>
                <div className={styles.noteHeader}>
                  <div className={styles.authorArea}>
                    <strong>{note.author_name || note.author_email || (isAutomatic ? "Sistema" : "Nota CRM")}</strong>
                    <div className={styles.badges}>
                      <span>{toneLabel(note)}</span>
                      {origin && <span>{origin}</span>}
                      {isAutomatic && <span>Automática</span>}
                      {note.is_pinned && <span className={styles.pinBadge}><Pin size={12} /> Anclada</span>}
                    </div>
                  </div>
                  <time dateTime={note.created_at || undefined}>{formatDate(note.created_at)}</time>
                </div>

                {isEditing ? (
                  <div className={styles.editor}>
                    <div className={styles.editorTop}>
                      <span>Editando la misma nota, sin crear duplicados.</span>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => {
                          const element = editNoteRef.current;
                          setEditingText(applyBold(editingText, element?.selectionStart ?? editingText.length, element?.selectionEnd ?? editingText.length));
                          setTimeout(() => element?.focus(), 0);
                        }}
                      ><Bold size={15} /> Negrita</button>
                    </div>
                    <textarea ref={editNoteRef} value={editingText} onChange={(event) => setEditingText(event.target.value)} />
                    <div className={styles.noteActions}>
                      <button type="button" className={styles.secondaryButton} onClick={() => { setEditingId(""); setEditingText(""); }} disabled={busy === `edit-${note.id}`}><X size={16} /> Cancelar</button>
                      <button type="button" className={styles.saveEditButton} onClick={() => updateNote(String(note.id))} disabled={busy === `edit-${note.id}`}><Save size={16} /> {busy === `edit-${note.id}` ? "Guardando…" : "Guardar"}</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.noteText}>{renderNoteText(note.texto || "—")}</div>
                )}

                {!isEditing && (
                  <div className={styles.noteActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => togglePin(note)} disabled={busy === `pin-${note.id}`}>
                      {note.is_pinned ? <PinOff size={16} /> : <Pin size={16} />}
                      {busy === `pin-${note.id}` ? "Guardando…" : note.is_pinned ? "Desanclar" : "Anclar"}
                    </button>
                    <button type="button" className={styles.secondaryButton} onClick={() => startEdit(note)} disabled={Boolean(busy)}><Edit3 size={16} /> Editar</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>Todavía no hay notas registradas para esta clienta.</div>
      )}
    </section>
  );
}
