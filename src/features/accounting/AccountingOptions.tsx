"use client";

import { useState, type FormEvent } from "react";
import { Archive, ArrowDownLeft, ArrowUpRight, Check, CreditCard, LoaderCircle, Pencil, Plus, RotateCcw } from "lucide-react";
import { validateOptionInput, type AccountingSnapshot, type OptionInput } from "@/lib/accounting";
import AccountingDialog from "./AccountingDialog";
import styles from "./accounting.module.css";

const GROUPS = [{ kind: "income", title: "Origen de los ingresos", icon: ArrowDownLeft }, { kind: "expense", title: "Motivos de los gastos", icon: ArrowUpRight }, { kind: "method", title: "Medios de pago", icon: CreditCard }] as const;

function OptionEditor({ option, onSave, onClose }: { option: OptionInput; onSave: (value: OptionInput) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(option.name);
  const [active, setActive] = useState(option.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try { await onSave(validateOptionInput({ ...(option.id ? { id: option.id } : {}), kind: option.kind, name, active })); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la opción."); }
    finally { setBusy(false); }
  }
  return <AccountingDialog title={option.id ? "Editar opción" : "Añadir opción"} subtitle={GROUPS.find(group => group.kind === option.kind)?.title} busy={busy} onClose={onClose}>
    <form onSubmit={submit} className={styles.entryForm}>
      <label>Nombre<input data-initial-focus required value={name} minLength={2} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} placeholder="Nombre de la nueva opción" /></label>
      {option.id ? <label className={styles.checkboxLabel}><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} disabled={busy} /> Disponible en nuevos movimientos</label> : null}
      <p className={styles.formHint}>Archivar una opción no borra sus movimientos. Los cambios de nombre se reflejan también en el historial.</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.dialogActions}><button className={styles.secondary} type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className={styles.primary} disabled={busy}>{busy ? <LoaderCircle size={17} className={styles.spin} /> : <Check size={17} />}Guardar opción</button></div>
    </form>
  </AccountingDialog>;
}

export default function AccountingOptions({ snapshot, onSave }: { snapshot: AccountingSnapshot; onSave: (option: OptionInput) => Promise<void> }) {
  const [editing, setEditing] = useState<OptionInput | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function toggle(option: OptionInput) {
    if (pending) return;
    setPending(option.id!); setError(null);
    try { await onSave({ ...option, active: !option.active }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar la opción."); }
    finally { setPending(null); }
  }
  return <section aria-label="Configuración de categorías y medios de pago">
    <div className={styles.sectionTitle}><div><h2>A tu manera</h2><p>Añade categorías y medios de pago cuando los necesites.</p></div></div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.optionsGrid}>
      {GROUPS.map(group => {
        const options = group.kind === "method" ? snapshot.methods : snapshot.categories.filter(category => category.kind === group.kind);
        return <div className={styles.panel} key={group.kind}><div className={styles.panelHeading}><div className={styles.row}><group.icon size={20} /><h3>{group.title}</h3></div><button type="button" className={styles.iconButton} onClick={() => setEditing({ kind: group.kind, name: "", active: true })} aria-label={`Añadir: ${group.title}`}><Plus size={19} /></button></div>
          <div className={styles.optionRows}>{options.map(option => <div className={`${styles.optionRow} ${!option.active ? styles.archived : ""}`} key={option.id}>
            <div><span>{option.name}</span>{!option.active ? <small>Archivado</small> : null}</div>
            <div className={styles.row}><button type="button" className={styles.iconButton} disabled={!!pending} onClick={() => setEditing({ ...option, kind: group.kind })} aria-label={`Editar ${option.name}`}><Pencil size={15} /></button>
              <button type="button" className={styles.iconButton} disabled={!!pending} onClick={() => void toggle({ ...option, kind: group.kind })} aria-label={`${option.active ? "Archivar" : "Reactivar"} ${option.name}`}>{pending === option.id ? <LoaderCircle size={15} className={styles.spin} /> : option.active ? <Archive size={15} /> : <RotateCcw size={15} />}</button></div>
          </div>)}</div>
          <button type="button" className={styles.addOption} onClick={() => setEditing({ kind: group.kind, name: "", active: true })}><Plus size={16} />Añadir nueva opción</button>
        </div>;
      })}
    </div>
    {editing ? <OptionEditor option={editing} onSave={onSave} onClose={() => setEditing(null)} /> : null}
  </section>;
}
