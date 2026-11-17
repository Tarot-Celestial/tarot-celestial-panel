"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Plus, Settings2 } from "lucide-react";
import { ACCOUNT_LABELS, KIND_LABELS, accountingToday, parseAmountToCents, validateEntryInput, type Account, type AccountingSnapshot, type Currency, type EntryInput, type EntryKind } from "@/lib/accounting";
import { AccountingRequestError } from "./accounting-client";
import { entryRoute, ROUTE_LABELS } from "./monthly-model";
import s from "./monthly.module.css";

const HINTS: Record<EntryKind,string> = {
 income: "Dinero recibido. No utilices Ingreso para trasladar un saldo que ya tenías.",
 expense: "Registra un pago realizado e indica su categoría y medio de pago.",
 transfer: "El dinero sale de una cuenta y entra en la otra. No se cuenta como ingreso ni como gasto.",
 opening_balance: "Introduce el saldo disponible con el que empiezas. No se cuenta como ingreso del mes.",
 vault_deposit: "Aparta dinero disponible en la bóveda de esta misma cuenta, sin generar un gasto.",
 vault_withdrawal: "Devuelve dinero de la bóveda al disponible de esta misma cuenta.",
 vault_payout: "Registra un reparto ya realizado a Alex o Ricky. No se ejecutan pagos bancarios.",
};
const REJECTED_SAVE_CODES = new Set([
 "INVALID_INPUT", "FUTURE_DATE", "INSUFFICIENT_VAULT", "INSUFFICIENT_AVAILABLE",
 "OPENING_EXISTS", "OPENING_DATE", "OPTION_UNAVAILABLE",
]);
export default function MonthlyEntryForm({ snapshot, currency, onSave, onOptions }: {
 snapshot: AccountingSnapshot; currency: Currency; onSave: (input: EntryInput) => Promise<void>; onOptions: () => void;
}) {
 const [kind,setKind] = useState<EntryKind>("income"), [account,setAccount] = useState<Account>("celestial");
 const [date,setDate] = useState(accountingToday), [amount,setAmount] = useState("");
 const [category,setCategory] = useState(""), [method,setMethod] = useState(""), [description,setDescription] = useState(""), [reference,setReference] = useState("");
 const [recipient,setRecipient] = useState<"Alex"|"Ricky">("Alex");
 const [busy,setBusy] = useState(false), [error,setError] = useState(""), [saved,setSaved] = useState(false);
 const [pending,setPending] = useState<EntryInput|null>(null);
 const inFlight = useRef(false);
 const flow = kind === "income" || kind === "expense";
 const categories = snapshot.categories.filter(o => o.active && o.kind === kind);
 const methods = snapshot.methods.filter(o => o.active);
 const toAccount: Account = account === "celestial" ? "leonaris" : "celestial";
 const route = entryRoute({kind,account,to_account:kind === "transfer" ? toAccount : null,recipient:kind === "vault_payout" ? recipient : null});
 function resetConfirmed() { setPending(null); setAmount(""); setDescription(""); setReference(""); setError(""); setSaved(true); }
 useEffect(() => {
  if (pending && snapshot.entries.some(entry => entry.id === pending.id)) resetConfirmed();
  // A matching server-issued entry ID confirms an uncertain response without issuing another write.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [snapshot.entries, pending]);
 async function submit(event: FormEvent) {
  event.preventDefault(); if (inFlight.current) return;
  let payload: EntryInput;
  try { payload = pending || validateEntryInput({ id: crypto.randomUUID(), kind, account, currency, occurred_on: date, amount_cents: parseAmountToCents(amount), description, reference, category_id: flow ? category : null, method_id: method || null, to_account: kind === "transfer" ? toAccount : null, recipient: kind === "vault_payout" ? recipient : null }); }
  catch (cause) { setError(cause instanceof Error ? cause.message : "Revisa los campos."); return; }
  inFlight.current = true; setBusy(true); setSaved(false); setError(""); setPending(payload);
  try { await onSave(payload); resetConfirmed(); }
  catch (cause) {
   const rejected = cause instanceof AccountingRequestError && (cause.status === 400 || cause.status === 409) && REJECTED_SAVE_CODES.has(cause.code || "");
   // Only a definitive rejection permits editing. Unknown outcomes retain the exact request for an idempotent retry.
   if (rejected) setPending(null);
   setError((cause instanceof Error ? cause.message : "No se pudo confirmar el guardado.") + (rejected ? " Corrige los datos y vuelve a guardar." : " Reintenta este mismo movimiento: conserva su identificador para evitar duplicados."));
  }
  finally { inFlight.current = false; setBusy(false); }
 }
 return <form onSubmit={submit} aria-label="Nuevo movimiento contable" aria-busy={busy}>
  <fieldset className={s.formFieldset} disabled={busy || !!pending}>
   <div className={s.formGrid}>
    <label>Movimiento<select value={kind} onChange={e => { setKind(e.target.value as EntryKind);setCategory("");setSaved(false); }}>
     {Object.entries(KIND_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label>Fecha<input type="date" required min="2000-01-01" max={accountingToday()} value={date} onChange={e => setDate(e.target.value)} /></label>
    <label>Negocio<select value={account} onChange={e => setAccount(e.target.value as Account)}>{Object.entries(ACCOUNT_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Origen del dinero<input className={s.readonly} readOnly value={ROUTE_LABELS[route.origin]} aria-describedby="monthly-kind-hint" /></label>
    {kind === "vault_payout" ? <label>Destinatario<select value={recipient} onChange={e => setRecipient(e.target.value as "Alex"|"Ricky")}><option>Alex</option><option>Ricky</option></select></label> : <label>Destino del dinero<input className={s.readonly} readOnly value={ROUTE_LABELS[route.destination]} aria-describedby="monthly-kind-hint" /></label>}
   </div>
   <div className={s.formGrid} style={{marginTop:13}}>
    <label>Medio de pago{flow ? " *" : ""}<select required={flow} value={method} onChange={e => e.target.value === "__manage__" ? onOptions() : setMethod(e.target.value)}>
     <option value="">{flow ? "Seleccionar medio" : "No aplica / opcional"}</option>{methods.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}<option value="__manage__">+ Añadir o administrar…</option>
    </select></label>
    <label>Categoría{flow ? " *" : ""}<select required={flow} value={category} disabled={!flow} onChange={e => e.target.value === "__manage__" ? onOptions() : setCategory(e.target.value)}>
     <option value="">{flow ? "Seleccionar categoría" : "Movimiento interno"}</option>{categories.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}{flow && <option value="__manage__">+ Añadir o administrar…</option>}
    </select></label>
    <label>Importe · {currency}<input required inputMode="decimal" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} autoComplete="off" maxLength={20} /></label>
    <label className={s.span2}>Concepto / motivo *<input required minLength={3} maxLength={500} value={description} onChange={e => setDescription(e.target.value)} placeholder="Por ejemplo: cobro de consulta o pago de centrales" /></label>
   </div>
   <div className={s.formBottom}>
    <label className={s.span3}>Referencia u observación<input maxLength={200} value={reference} onChange={e => setReference(e.target.value)} placeholder="Opcional" /></label>
    <button type="submit" className={s.primary}><Plus size={18}/>Añadir</button>
   </div>
  </fieldset>
  <p id="monthly-kind-hint" className={s.formHint}>{HINTS[kind]} · Origen y destino se calculan según el movimiento.</p>
  {pending && <div className={s.actions} style={{marginTop:12}}><button type="submit" className={s.primary} disabled={busy}>{busy ? <LoaderCircle size={17} className={s.spin}/> : null}{busy ? "Guardando y verificando…" : `Reintentar guardado · ${pending.currency}`}</button><span className={s.subtle}>Los campos quedan bloqueados hasta confirmar este movimiento.</span></div>}
  {error && <p className={s.error} role="alert">{error}</p>}
  {saved && <p className={s.statusMessage} role="status">Movimiento guardado y confirmado.</p>}
  <button type="button" className={s.ghost} onClick={onOptions} disabled={busy} style={{marginTop:5}}><Settings2 size={14}/>Administrar categorías y medios de pago</button>
 </form>;
}
