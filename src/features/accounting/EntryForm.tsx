"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Info, LoaderCircle } from "lucide-react";
import { ACCOUNT_LABELS, KIND_LABELS, accountingToday, parseAmountToCents, validateEntryInput, type Account, type AccountingSnapshot, type Currency, type EntryInput, type EntryKind } from "@/lib/accounting";
import AccountingDialog from "./AccountingDialog";
import { madridDate } from "./accounting-client";
import styles from "./accounting.module.css";

const descriptions: Record<EntryKind, string> = {
  income: "Registra dinero recibido en la cuenta correspondiente.",
  expense: "Indica el motivo del gasto y cómo se pagó.",
  transfer: "Un único movimiento: sale de una cuenta y entra en la otra, sin generar ingresos nuevos.",
  vault_deposit: "Aparta dinero del saldo disponible. Seguirá perteneciendo a la cuenta de origen.",
  vault_withdrawal: "Devuelve dinero de la bóveda al saldo disponible de su cuenta.",
  opening_balance: "El dinero que ya había antes de empezar este registro. No se contará como un ingreso.",
  vault_payout: "Registra un reparto ya realizado a Alex o Ricky. No se aplican porcentajes automáticos.",
};

export default function EntryForm({ kind: initialKind, account: initialAccount, currency: initialCurrency, snapshot, onSave, onClose }: {
  kind: EntryKind; account: Account; currency: Currency; snapshot: AccountingSnapshot;
  onSave: (entry: EntryInput) => Promise<void>; onClose: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [account, setAccount] = useState<Account>(initialAccount);
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(madridDate);
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [recipient, setRecipient] = useState<"Alex" | "Ricky">("Alex");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFlow = kind === "income" || kind === "expense";
  const categories = snapshot.categories.filter(option => option.active && option.kind === kind);
  const methods = snapshot.methods.filter(option => option.active);
  const destination: Account = account === "celestial" ? "leonaris" : "celestial";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    let payload: EntryInput;
    try {
      payload = validateEntryInput({ id, kind, account, currency, amount_cents: parseAmountToCents(amount), occurred_on: date,
        category_id: isFlow ? category : null, method_id: method || null, description, reference,
        to_account: kind === "transfer" ? destination : null, recipient: kind === "vault_payout" ? recipient : null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Comprueba los campos del movimiento."); return; }
    setBusy(true);
    try { await onSave(payload); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar. Tu formulario se conserva."); }
    finally { setBusy(false); }
  }

  return <AccountingDialog title={KIND_LABELS[kind]} subtitle={descriptions[kind]} busy={busy} onClose={onClose}>
    <form onSubmit={submit} className={styles.entryForm}>
      <fieldset disabled={busy} className={styles.fieldset}>
        <div className={styles.formGrid}>
          <label>Tipo de movimiento<select value={kind} onChange={event => { setKind(event.target.value as EntryKind); setCategory(""); }}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>{kind === "transfer" ? "Cuenta de origen" : "Cuenta"}<select value={account} onChange={event => setAccount(event.target.value as Account)}>{Object.entries(ACCOUNT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Importe<input data-initial-focus inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required placeholder="0,00" maxLength={15} aria-describedby="accounting-amount-help" autoComplete="off" /></label>
          <label>Moneda<select value={currency} onChange={event => setCurrency(event.target.value as Currency)}><option value="EUR">EUR · euros</option><option value="USD">USD · dólares</option></select></label>
          <label>Fecha contable<input type="date" value={date} onChange={event => setDate(event.target.value)} min="2000-01-01" max={accountingToday()} required /></label>
          <label>Medio de pago {isFlow ? "" : "(opcional)"}<select value={method} onChange={event => setMethod(event.target.value)} required={isFlow}><option value="">Selecciona un medio</option>{methods.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          {isFlow ? <label className={styles.fullWidth}>{kind === "income" ? "Origen del ingreso" : "Categoría del gasto"}<select value={category} onChange={event => setCategory(event.target.value)} required><option value="">Selecciona una categoría</option>{categories.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label> : null}
          {kind === "vault_payout" ? <label className={styles.fullWidth}>Destinatario del reparto<select value={recipient} onChange={event => setRecipient(event.target.value as "Alex" | "Ricky")}><option value="Alex">Alex</option><option value="Ricky">Ricky</option></select></label> : null}
          <label className={styles.fullWidth}>Motivo / concepto<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} minLength={3} maxLength={500} required placeholder={kind === "expense" ? "Ej.: pago de centrales — noviembre" : kind === "income" ? "Ej.: venta de minutos recibida por PayPal" : "Describe este movimiento"} /></label>
          <label className={styles.fullWidth}>Referencia o justificante (opcional)<input value={reference} onChange={event => setReference(event.target.value)} maxLength={200} placeholder="N.º de operación, factura o nota" /></label>
        </div>
        {kind === "transfer" ? <div className={styles.transferPreview}><span>{ACCOUNT_LABELS[account]}</span><ArrowRight size={19} /><span>{ACCOUNT_LABELS[destination]}</span></div> : null}
        <p className={styles.formHint} id="accounting-amount-help"><Info size={15} /> Los importes se guardan en la moneda elegida; no se convierten ni se mezclan euros y dólares. Este registro no mueve dinero en tu banco.</p>
      </fieldset>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.dialogActions}><button type="button" onClick={onClose} disabled={busy} className={styles.secondary}>Cancelar</button><button type="submit" disabled={busy} className={styles.primary}>{busy ? <LoaderCircle size={17} className={styles.spin} /> : <Check size={17} />}{busy ? "Guardando y verificando…" : "Guardar movimiento"}</button></div>
    </form>
  </AccountingDialog>;
}
