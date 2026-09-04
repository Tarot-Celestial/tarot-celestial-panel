"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Clock3, Coins, Layers3, LockKeyhole, Plus, Save, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ACTIVITY_CODE_OPTIONS, decimalValue, parseActivityCodes, serializeActivityCodes, validateActivityCodes, type ActivitySource } from "@/lib/activity-codes";
import styles from "./RendimientoEditDialog.module.css";

export type EditableRow = ActivitySource & {
  id?: string; cliente_nombre?: string | null; telefonista_nombre?: string | null;
  tarotista_nombre?: string | null; importe?: number | null; edit_revision?: number;
  fecha_hora?: string | null; llamada_call?: boolean | null;
};
export default function RendimientoEditDialog({ row, onClose, onSaved }: {
  row: EditableRow; onClose: () => void; onSaved: (row: EditableRow, notice: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const nextKey = useRef(100);
  const [tiempo, setTiempo] = useState(String(row.tiempo ?? 0));
  const [importe, setImporte] = useState(String(row.importe ?? 0));
  const [tarotista, setTarotista] = useState(String(row.tarotista_nombre || ""));
  const [blocks, setBlocks] = useState(() => parseActivityCodes(row).map((b, key) => ({ key, code: String(b.code), minutes: String(b.minutes) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  let validation = "", summary = "", sum = 0, total = 0;
  try {
    total = decimalValue(tiempo, "Tiempo");
    decimalValue(importe, "Importe");
    sum = Math.round(blocks.reduce((n,b) => n + (Number(b.minutes.replace(",",".")) || 0),0)*100)/100;
    summary = serializeActivityCodes(validateActivityCodes(blocks, total));
  } catch (e) { validation = e instanceof Error ? e.message : "Revisa la distribución."; }
  const remaining = Math.round((total-sum)*100)/100;
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setError("");
    inFlight.current = true; setSaving(true);
    try {
      const minutes = decimalValue(tiempo, "Tiempo");
      const tarotistaNombre = tarotista.trim().replace(/\s+/g, " ");
      if (!tarotistaNombre || tarotistaNombre.length > 120) throw new Error("Escribe un nombre de tarotista válido (máximo 120 caracteres).");
      const updates = { tiempo: minutes, importe: decimalValue(importe, "Importe"), tarotista_nombre: tarotistaNombre, code_blocks: validateActivityCodes(blocks, minutes) };
      const { data, error: sessionError } = await supabaseBrowser().auth.getSession();
      if (sessionError || !data.session?.access_token) throw new Error("Tu sesión no está disponible. Vuelve a iniciar sesión.");
      const response = await fetch("/api/crm/rendimiento/update", {
        method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, revision: row.edit_revision, updates }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok || !result.data?.id) throw new Error(result?.message || "No se pudo confirmar el guardado. Tus cambios siguen aquí.");
      onSaved(result.data, `Registro corregido · Tarotista: ${result.data.tarotista_nombre || "—"} · ${row.resumen_codigo || serializeActivityCodes(parseActivityCodes(row)) || "Sin código"} → ${result.data.resumen_codigo || "Sin tramos"} · ${result.data.tiempo} min · ${Number(result.data.importe).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}`);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar. Tus cambios se conservan."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  function changeBlock(key: number, patch: { minutes?: string; code?: string }) {
    setBlocks(current => current.map(b => b.key === key ? { ...b, ...patch } : b));
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="rendimiento-edit-title"
    aria-describedby="rendimiento-edit-description" onCancel={e => { e.preventDefault(); if (!inFlight.current) onClose(); }}>
    <form onSubmit={save} aria-busy={saving}>
      <header className={styles.header}>
        <div className={styles.emblem}><ShieldCheck size={24} /></div>
        <div className={styles.heading}><span className={styles.kicker}>CONTROL DE ACTIVIDAD · EDICIÓN SEGURA</span><h2 id="rendimiento-edit-title">Corregir registro</h2></div>
        <button type="button" aria-label="Cerrar edición" disabled={saving} onClick={onClose} className={styles.iconButton}><X size={20} /></button>
      </header>
      <div className={styles.scroll}>
        <section className={styles.identity} id="rendimiento-edit-description">
          <div><span><LockKeyhole size={12} /> CLIENTE · IDENTIDAD PROTEGIDA</span><strong>{row.cliente_nombre || "Sin nombre"}</strong></div>
          <p>Central: <b>{row.telefonista_nombre || "Sin asignar"}</b> · Tarotista actual: <b>{row.tarotista_nombre || "—"}</b></p>
          <small>{row.fecha_hora ? new Date(row.fecha_hora).toLocaleString("es-ES") : "Fecha original conservada"} · Se conservan cliente, central, relación interna y fecha.</small>
        </section>
        <fieldset disabled={saving} className={styles.tarotistField}>
          <label><span><UserRound size={15}/> NOMBRE DEL TAROTISTA</span><input aria-label="Nombre del tarotista" required maxLength={120} value={tarotista} onChange={e=>setTarotista(e.target.value)} /></label>
          <small>Corrige el nombre mostrado en este registro. No renombra la cuenta ni cambia su relación interna.</small>
        </fieldset>
        <fieldset disabled={saving} className={styles.fields}>
          <label><span><Clock3 size={15} /> TIEMPO TOTAL</span><div className={styles.inputUnit}><input autoFocus aria-label="Tiempo total" inputMode="decimal" required value={tiempo} onChange={e=>setTiempo(e.target.value)} /><b>min</b></div></label>
          <label><span><Coins size={15} /> IMPORTE</span><div className={styles.inputUnit}><input aria-label="Importe" inputMode="decimal" required value={importe} onChange={e=>setImporte(e.target.value)} /><b>€</b></div></label>
        </fieldset>
        <section className={styles.distribution}>
          <div className={styles.sectionTitle}><h3><Layers3 size={17} /> Distribución de minutos</h3><span>{blocks.length} tramos</span></div>
          <p className={styles.hint}>Cada minuto, en su código. Los códigos repetidos se agrupan al guardar.</p>
          {row.resumen_codigo ? <details className={styles.legacy}><summary>Ver resumen original</summary><p>{String(row.resumen_codigo)}</p></details> : null}
          <fieldset disabled={saving} className={styles.blockList}>
            {blocks.map((b,index) => <div key={b.key} className={styles.block} data-code={b.code}>
              <span className={styles.ordinal}>{String(index+1).padStart(2,"0")}</span>
              <label><span>Minutos</span><input aria-label={`Minutos del tramo ${index+1}`} inputMode="decimal" required value={b.minutes} onChange={e=>changeBlock(b.key,{minutes:e.target.value})} /></label>
              <label><span>Código</span><select aria-label={`Código del tramo ${index+1}`} required value={b.code} onChange={e=>changeBlock(b.key,{code:e.target.value})}><option value="">Elegir código</option>{ACTIVITY_CODE_OPTIONS.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
              <button type="button" className={styles.iconButton} aria-label={`Eliminar tramo ${index+1}`} onClick={()=>setBlocks(current=>current.filter(x=>x.key!==b.key))}><Trash2 size={16}/></button>
            </div>)}
            <button type="button" className={styles.add} disabled={blocks.length>=32} onClick={()=>setBlocks(current=>[...current,{key:nextKey.current++,code:"",minutes:""}])}><Plus size={16}/> Añadir tramo</button>
          </fieldset>
          <div className={`${styles.balance} ${validation ? styles.unbalanced : styles.balanced}`} aria-live="polite">
            <strong>{sum} / {total} min</strong><span>{validation ? remaining>0 ? `Faltan ${remaining} min` : remaining<0 ? `Sobran ${-remaining} min` : "Revisar tramos" : "Distribución completa"}</span>
          </div>
          <div className={styles.track} aria-hidden="true"><span style={{width:`${total>0 ? Math.max(0,Math.min(100,sum/total*100)) : 0}%`}} /></div>
          {validation ? <p className={styles.validation}>{validation}</p> : <p className={styles.preview}>{summary || "Sin minutos registrados"}</p>}
        </section>
        <p className={styles.note}><ShieldCheck size={14}/> Los cambios quedan auditados. Las facturas en borrador deben regenerarse; las cerradas requieren reapertura.</p>
        {row.llamada_call ? <p className={styles.note}>Este registro mantiene la regla especial CALL y su tarifa; no cambia al editar los tramos.</p> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      </div>
      <footer className={styles.actions}><span>Revisa · Confirma · Guarda</span><button type="button" disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" disabled={saving || Boolean(validation)} className={styles.save}><Save size={15}/>{saving ? "Guardando…" : "Guardar cambios"}</button></footer>
    </form>
  </dialog>;
}
