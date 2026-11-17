"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronLeft, Download, Landmark, LoaderCircle, LockKeyhole, Plus, ReceiptText, RefreshCw, Settings2, ShieldCheck, Vault, X } from "lucide-react";
import { ACCOUNT_LABELS, KIND_LABELS, accountingToday, formatMoney, type Account, type AccountingSnapshot, type Currency, type Entry, type EntryInput, type EntryKind, type OptionInput } from "@/lib/accounting";
import AccountingDialog from "./AccountingDialog";
import AccountingOptions from "./AccountingOptions";
import EntryForm from "./EntryForm";
import { csvCell, dateLabel } from "./accounting-client";
import MonthlyEntryForm from "./MonthlyEntryForm";
import MonthlyStatistics from "./MonthlyStatistics";
import { LedgerTable, MoneyTile, MovementFilters } from "./MonthlyLedgerParts";
import { ACCOUNTS, EMPTY_MONTHLY_FILTERS, ROUTE_LABELS, accountShort, entryRoute, filteredTotals, monthLabel, monthlyRows, monthlySummary, vaultHistory, type MonthlyFilters } from "./monthly-model";
import s from "./monthly.module.css";
import legacyStyles from "./accounting.module.css";

function VoidForm({entry,onSave,onClose}:{entry:Entry;onSave:(id:string,reason:string)=>Promise<void>;onClose:()=>void}) {
 const [reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const pending=useRef(false);
 async function submit(event:FormEvent){event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError("");try{await onSave(entry.id,reason.trim());onClose();}catch(cause){setError(cause instanceof Error?cause.message:"No se pudo confirmar la anulación.");}finally{pending.current=false;setBusy(false);}}
 return <AccountingDialog title="Anular movimiento" subtitle="Se conservará el historial. No se borra el registro." busy={busy} onClose={onClose}><form onSubmit={submit} className={legacyStyles.entryForm}><p>{entry.description} · <strong>{formatMoney(entry.amount_cents,entry.currency)}</strong></p><label>Motivo de la anulación<textarea data-initial-focus rows={3} required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label><p className={s.formHint}>Para corregir un importe, anula con motivo y registra el movimiento correcto.</p>{error&&<p className={s.error} role="alert">{error}</p>}<div className={s.actions}><button type="button" className={s.button} disabled={busy} onClick={onClose}>Conservar</button><button type="submit" className={s.danger} disabled={busy}>{busy?<LoaderCircle size={15} className={s.spin}/>:<X size={15}/>}Confirmar anulación</button></div></form></AccountingDialog>;
}
function BusinessColumn({account,month,currency,snapshot,onCreate,onVoid}:{account:Account;month:string;currency:Currency;snapshot:AccountingSnapshot;onCreate:(kind:EntryKind,account:Account)=>void;onVoid:(entry:Entry)=>void}) {
 const [filters,setFilters]=useState<MonthlyFilters>({...EMPTY_MONTHLY_FILTERS,account});
 const [vaultLimit,setVaultLimit]=useState(12);
 const summary=useMemo(()=>monthlySummary(snapshot.entries,month,currency,account),[snapshot.entries,month,currency,account]);
 const rows=useMemo(()=>monthlyRows(snapshot.entries,month,currency,filters),[snapshot.entries,month,currency,filters]);
 const vaultRows=useMemo(()=>vaultHistory(snapshot.entries,month,currency,account),[snapshot.entries,month,currency,account]);
 return <article className={s.business} aria-label={`Cuenta ${ACCOUNT_LABELS[account]}`}>
  <header className={s.businessHead}><div><p className={s.eyebrow}>Negocio</p><h2>{accountShort(account)}</h2></div><span className={s.count}>{rows.length} líneas</span></header>
  <div className={s.businessStats}><MoneyTile label="Saldo anterior" value={summary.opening} currency={currency} tone={s.purple}/><MoneyTile label="Ingresos del mes" value={summary.income} currency={currency} tone={s.positive}/><MoneyTile label="Gastos del mes" value={summary.expense} currency={currency} tone={s.negative}/><MoneyTile label="Saldo disponible" value={summary.available} currency={currency} tone={s.accent}/><MoneyTile label="Caja extra · Bóveda" value={summary.vault} currency={currency} tone={s.gold}/></div>
  <p className={s.formHint}>Saldos al cierre del mes, o hasta hoy si es el mes actual. Los filtros siguientes solo afectan a la tabla.</p>
  <MovementFilters filters={filters} onChange={setFilters} snapshot={snapshot} month={month} fixedAccount={account}/>
  <LedgerTable key={JSON.stringify(filters)} rows={rows} snapshot={snapshot} onVoid={onVoid} pageSize={6} empty={`Sin movimientos para ${accountShort(account)} con estos filtros.`}/>
  <section className={s.vault} aria-label={`Caja extra de ${accountShort(account)}`}><div className={s.headingIcon}><span className={`${s.iconBox} ${s.iconGold}`}><Vault size={19}/></span><div><h3>Caja extra · {accountShort(account)}</h3><p className={s.subtitle}>Bóveda independiente y acumulada para futuros meses.</p></div></div>
   <div className={s.vaultStats}><MoneyTile label="Entradas del mes" value={summary.vaultIn} currency={currency} tone={s.positive}/><MoneyTile label="Salidas del mes" value={summary.vaultOut} currency={currency} tone={s.negative}/><MoneyTile label="Saldo de bóveda" value={summary.vault} currency={currency} tone={s.gold}/></div>
   <p className={s.formHint} style={{marginBottom:12}}>Arrastre anterior: {formatMoney(summary.openingVault,currency)}. Los filtros de la tabla no alteran esta caja.</p>
   {vaultRows.length?<><div className={s.tableScroll} tabIndex={0} role="region" aria-label={`Historial de bóveda de ${accountShort(account)}`}><table className={s.table}><thead><tr><th>Fecha / concepto</th><th className={s.money}>Entrada</th><th className={s.money}>Salida</th><th className={s.money}>Saldo</th></tr></thead><tbody>{vaultRows.slice(0,vaultLimit).map(row=><tr key={row.entry.id}><td>{dateLabel(row.entry.occurred_on)}<small>{row.entry.description}{row.entry.recipient?` · ${row.entry.recipient}`:""}</small></td><td className={`${s.money} ${s.positive}`}>{row.incoming?formatMoney(row.incoming,currency):"—"}</td><td className={`${s.money} ${s.negative}`}>{row.outgoing?formatMoney(row.outgoing,currency):"—"}</td><td className={`${s.money} ${s.gold}`}>{formatMoney(row.balance,currency)}</td></tr>)}</tbody></table></div>{vaultRows.length>vaultLimit&&<button type="button" className={s.ghost} onClick={()=>setVaultLimit(v=>v+12)}>Mostrar más movimientos de bóveda</button>}</>:<div className={s.empty}>Sin movimientos de caja extra este mes.</div>}
   <div className={s.vaultActions}><button type="button" className={s.button} onClick={()=>onCreate("vault_deposit",account)}><Plus size={14}/>Apartar dinero</button><button type="button" className={s.button} onClick={()=>onCreate("vault_withdrawal",account)}><ArrowUpRight size={14}/>Devolver a cuenta</button><button type="button" className={s.button} onClick={()=>onCreate("vault_payout",account)}><ArrowDownLeft size={14}/>Reparto Alex / Ricky</button></div>
   {(summary.payouts.Alex>0||summary.payouts.Ricky>0)&&<p className={s.formHint}>Repartido este mes · Alex: {formatMoney(summary.payouts.Alex,currency)} · Ricky: {formatMoney(summary.payouts.Ricky,currency)}</p>}
  </section>
 </article>;
}

export default function AccountingWorkspace({snapshot,updatedAt,refreshing,locking,message,error,onRefresh,onLock,onSaveEntry,onVoidEntry,onSaveOption}:{
 snapshot:AccountingSnapshot;updatedAt:string;refreshing:boolean;locking:boolean;message:string|null;error:string|null;
 onRefresh:()=>Promise<unknown>;onLock:()=>Promise<void>;onSaveEntry:(entry:EntryInput)=>Promise<void>;onVoidEntry:(id:string,reason:string)=>Promise<void>;onSaveOption:(option:OptionInput)=>Promise<void>;
}) {
 const [month,setMonth]=useState(()=>accountingToday().slice(0,7)),[currency,setCurrency]=useState<Currency>("EUR");
 const [filters,setFilters]=useState<MonthlyFilters>({...EMPTY_MONTHLY_FILTERS});
 const [voiding,setVoiding]=useState<Entry|null>(null),[dialog,setDialog]=useState<{kind:EntryKind;account:Account}|null>(null),[localError,setLocalError]=useState("");
 const optionsRef=useRef<HTMLDetailsElement>(null);
 const summary=useMemo(()=>monthlySummary(snapshot.entries,month,currency),[snapshot.entries,month,currency]);
 const rows=useMemo(()=>monthlyRows(snapshot.entries,month,currency,filters),[snapshot.entries,month,currency,filters]);
 const totals=useMemo(()=>filteredTotals(rows),[rows]);
 const monthlyCount=useMemo(()=>monthlyRows(snapshot.entries,month,currency,{...EMPTY_MONTHLY_FILTERS}).length,[snapshot.entries,month,currency]);
 useEffect(()=>setFilters(f=>({...f,date:""})),[month]);
 function openOptions(){const node=optionsRef.current;if(node){node.open=true;node.scrollIntoView({block:"center",behavior:"auto"});node.querySelector<HTMLElement>("summary")?.focus();}}
 async function save(input:EntryInput){await onSaveEntry(input);setMonth(input.occurred_on.slice(0,7));setCurrency(input.currency);}
 async function refresh(){setLocalError("");try{await onRefresh();}catch(cause){setLocalError(cause instanceof Error?cause.message:"No se pudieron actualizar los datos.");}}
 async function lock(){setLocalError("");try{await onLock();}catch(cause){setLocalError(cause instanceof Error?cause.message:"No se pudo bloquear la sesión.");}}
 function exportRows(){
  const categories=new Map(snapshot.categories.map(o=>[o.id,o.name])),methods=new Map(snapshot.methods.map(o=>[o.id,o.name]));
  const header=["ID","Fecha","Movimiento","Negocio","Origen","Destino","Medio","Categoría","Moneda","Importe","Concepto","Referencia","Estado","Motivo de anulación"];
  const body=rows.map(e=>{const route=entryRoute(e);return[e.id,e.occurred_on,KIND_LABELS[e.kind],ACCOUNT_LABELS[e.account],ROUTE_LABELS[route.origin],ROUTE_LABELS[route.destination],methods.get(e.method_id||"")||"",categories.get(e.category_id||"")||"",e.currency,(e.amount_cents/100).toFixed(2),e.description,e.reference,e.voided_at?"Anulado":"Activo",e.void_reason||""];});
  const csv="\uFEFF"+[header,...body].map(r=>r.map(csvCell).join(";")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));const a=document.createElement("a");a.href=url;a.download=`contabilidad-${month}-${currency}.csv`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const lastRead=updatedAt&&Number.isFinite(Date.parse(updatedAt))?new Intl.DateTimeFormat("es-ES",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Madrid"}).format(new Date(updatedAt)):"—";
 return <main className={s.workspace}><div className={s.inner}>
  <div className={s.topbar}><a href="/admin" className={s.back}><ChevronLeft size={15}/>Volver al panel</a><div className={s.actions}><button type="button" className={s.button} onClick={openOptions} title="Categorías y medios"><Settings2 size={15}/>Opciones</button><button type="button" className={s.button} disabled={refreshing} onClick={()=>void refresh()} title="Actualizar datos"><RefreshCw size={15} className={refreshing?s.spin:""}/>Actualizar</button><button type="button" className={s.button} disabled={locking} onClick={()=>void lock()} title="Bloquear contabilidad"><LockKeyhole size={15}/>{locking?"Bloqueando…":"Bloquear"}</button></div></div>
  <header className={s.hero}><div><p className={s.eyebrow}><ShieldCheck size={14}/>Privado · Bienvenido, Alex</p><h1>Contabilidad mensual</h1><p className={s.subtitle}>Los saldos se arrastran automáticamente. Cada negocio conserva su propia caja extra.</p></div><div className={s.heroStats}><MoneyTile label="Saldo anterior" value={summary.opening} currency={currency} tone={s.purple}/><MoneyTile label="Ingresos del mes" value={summary.income} currency={currency} tone={s.positive}/><MoneyTile label="Gastos del mes" value={summary.expense} currency={currency} tone={s.negative}/><MoneyTile label="Saldo disponible" value={summary.available} currency={currency} tone={s.accent}/><MoneyTile label="Cajas extra" value={summary.vault} currency={currency} tone={s.gold}/></div></header>
  <div className={s.context}><span>{monthLabel(month)} · {currency} · última lectura {lastRead}, Madrid</span><div className={s.sectionControls}><label>Mes visible<input type="month" value={month} min="2000-01" max={accountingToday().slice(0,7)} onChange={e=>{if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value))setMonth(e.target.value);}}/></label><label>Moneda<select value={currency} onChange={e=>setCurrency(e.target.value as Currency)}><option value="EUR">EUR · €</option><option value="USD">USD · $</option></select></label></div></div>
  {message&&<p className={s.statusMessage} role="status"><CheckCircle2 size={17}/>{message}</p>}{(error||localError)&&<p className={s.error} role="alert">{error||localError}</p>}
  {!snapshot.entries.length&&<p className={s.inlineNotice}>Tu contabilidad está vacía. Empieza registrando un <strong>saldo inicial</strong> por cuenta y moneda y añade después tus ingresos y gastos.</p>}
  <MonthlyStatistics snapshot={snapshot} month={month} currency={currency} refreshing={refreshing}/>
  <section className={s.section} aria-labelledby="monthly-new-title"><div className={s.sectionHead}><div className={s.headingIcon}><span className={s.iconBox}><Plus size={22}/></span><div><h3 id="monthly-new-title">Nuevo movimiento</h3><p className={s.subtitle}>Añade o administra categorías y medios desde cada desplegable.</p></div></div><span className={s.count}>Registro en {currency}</span></div><MonthlyEntryForm snapshot={snapshot} currency={currency} onSave={save} onOptions={openOptions}/></section>
  <section className={s.section} aria-labelledby="monthly-entries-title"><div className={s.sectionHead}><div className={s.headingIcon}><span className={s.iconBox}><ReceiptText size={21}/></span><div><h3 id="monthly-entries-title">Movimientos del mes</h3><p className={s.subtitle}>{monthlyCount} movimientos activos registrados · {monthLabel(month)}</p></div></div><button type="button" className={s.button} onClick={exportRows}><Download size={16}/>Descargar informe CSV</button></div>
   <MovementFilters filters={filters} onChange={setFilters} snapshot={snapshot} month={month}/>
   <div className={s.filteredSummary}><div className={s.summaryDescription}><strong>Resumen de resultados filtrados</strong><p>Periodo: {monthLabel(month)} · {filters.account==="all"?"Todos los negocios":ACCOUNT_LABELS[filters.account]}</p><p>Los anulados no suman. Los saldos iniciales y la bóveda no generan ingresos.</p></div><div className={s.filteredNumbers}><div className={s.tile}><span className={s.tileLabel}>Movimientos activos</span><strong className={`${s.tileValue} ${s.purple}`}>{totals.count}</strong></div><MoneyTile label="Ingresos filtrados" value={totals.income} currency={currency} tone={s.positive}/><MoneyTile label="Gastos filtrados" value={totals.expense} currency={currency} tone={s.negative}/><MoneyTile label="Balance neto" value={totals.net} currency={currency} tone={s.accent}/><MoneyTile label="Total traspasado" value={totals.transferred} currency={currency} tone={s.purple}/></div></div>
   <LedgerTable key={`${month}-${currency}-${JSON.stringify(filters)}`} rows={rows} snapshot={snapshot} onVoid={setVoiding}/>
  </section>
  <div className={s.businesses}>{ACCOUNTS.map(account=><BusinessColumn key={`${account}-${month}-${currency}`} account={account} month={month} currency={currency} snapshot={snapshot} onCreate={(kind,a)=>setDialog({kind,account:a})} onVoid={setVoiding}/>)}</div>
  <details ref={optionsRef} className={s.optionsSection}><summary><Settings2 size={19}/>Categorías y medios de pago</summary><p className={s.subtitle} style={{marginBottom:18}}>Añade nuevas opciones o archiva las que ya no utilices. El historial permanece intacto.</p><AccountingOptions snapshot={snapshot} onSave={onSaveOption}/></details>
  <footer className={s.footer}><span><ShieldCheck size={12} style={{display:"inline",verticalAlign:"middle"}}/> Contabilidad privada · cambios verificados en el servidor</span><span>EUR y USD separados · no ejecuta transferencias ni pagos reales</span></footer>
  {voiding&&<VoidForm entry={voiding} onSave={onVoidEntry} onClose={()=>setVoiding(null)}/>}
  {dialog&&<EntryForm kind={dialog.kind} account={dialog.account} currency={currency} snapshot={snapshot} onSave={save} onClose={()=>setDialog(null)}/>}
 </div></main>;
}
