"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./RendimientoEditDialog.module.css";

type EditableRow = {
  id?: string; cliente_nombre?: string | null; telefonista_nombre?: string | null;
  tarotista_nombre?: string | null; tiempo?: number | null;
  importe?: number | null; resumen_codigo?: string | null;
};

export default function RendimientoEditDialog({ row, onClose, onSaved }: {
  row: EditableRow; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [draft, setDraft] = useState(() => ({
    cliente_nombre: row.cliente_nombre || "",
    tiempo: String(row.tiempo ?? 0), importe: String(row.importe ?? 0),
    resumen_codigo: row.resumen_codigo || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setError("");
    const decimal = (value: string, label: string) => {
      const normalized = value.trim().replace(",", ".");
      if (!/^\d+(\.\d{1,2})?$/.test(normalized) || !Number.isFinite(Number(normalized))) {
        throw new Error(label + ": introduce una cifra válida, sin negativos y con hasta dos decimales.");
      }
      return Number(normalized);
    };
    inFlight.current = true;
    setSaving(true);
    try {
      if (!draft.cliente_nombre.trim()) throw new Error("Escribe el nombre del cliente.");
      const updates = {
        cliente_nombre: draft.cliente_nombre.trim(),
        tiempo: decimal(draft.tiempo, "Tiempo"),
        importe: decimal(draft.importe, "Importe"),
        resumen_codigo: draft.resumen_codigo.trim(),
      };
      const { data, error: sessionError } = await supabaseBrowser().auth.getSession();
      if (sessionError || !data.session?.access_token) throw new Error("Tu sesión no está disponible. Vuelve a iniciar sesión antes de guardar.");
      const response = await fetch("/api/crm/rendimiento/update", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, updates }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        const fallback = response.status === 403
          ? "No tienes permiso para editar este registro. Cada central puede corregir sus propios registros; un administrador puede corregir todos."
          : response.status === 401 ? "Tu sesión ha caducado. Vuelve a iniciar sesión."
          : "No se pudo guardar. Tus cambios siguen aquí para que puedas reintentarlo.";
        throw new Error(result?.message || fallback);
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar. Tus cambios se conservan.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="rendimiento-edit-title"
    aria-describedby="rendimiento-edit-description" onCancel={(event) => { event.preventDefault(); if (!inFlight.current) onClose(); }}>
    <form onSubmit={save} aria-busy={saving}>
      <header className={styles.header}>
        <div><span className={styles.kicker}>CORREGIR ACTIVIDAD</span><h2 id="rendimiento-edit-title">Editar registro</h2></div>
        <button type="button" aria-label="Cerrar edición" disabled={saving} onClick={onClose}>×</button>
      </header>
      <p id="rendimiento-edit-description" className={styles.description}>
        Central: <strong>{row.telefonista_nombre || "Sin asignar"}</strong> · Tarotista: {row.tarotista_nombre || "—"}.
        Revisa las cifras antes de guardar.
      </p>
      <fieldset className={styles.fields} disabled={saving}>
        <label className={styles.full}>Cliente<input autoFocus required maxLength={300} value={draft.cliente_nombre} onChange={(e) => setDraft({ ...draft, cliente_nombre: e.target.value })} /></label>
        <label>Tiempo (minutos)<input inputMode="decimal" required value={draft.tiempo} onChange={(e) => setDraft({ ...draft, tiempo: e.target.value })} /><small>Ejemplo: 15 o 15,50</small></label>
        <label>Importe (€)<input inputMode="decimal" required value={draft.importe} onChange={(e) => setDraft({ ...draft, importe: e.target.value })} /><small>Ejemplo: 22 o 22,50</small></label>
        <label className={styles.full}>Código / resumen<input maxLength={1000} value={draft.resumen_codigo} onChange={(e) => setDraft({ ...draft, resumen_codigo: e.target.value })} /></label>
      </fieldset>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <footer className={styles.actions}>
        <button type="button" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="submit" disabled={saving} className={styles.save}>{saving ? "Guardando…" : "Guardar cambios"}</button>
      </footer>
    </form>
  </dialog>;
}
