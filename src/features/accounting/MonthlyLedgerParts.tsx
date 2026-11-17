"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Filter, ListFilter, Search, ShieldCheck, X } from "lucide-react";
import { ACCOUNT_LABELS, KIND_LABELS, formatMoney, type Account, type AccountingSnapshot, type Currency, type Entry } from "@/lib/accounting";
import { dateLabel } from "./accounting-client";
import { ACCOUNTS, EMPTY_MONTHLY_FILTERS, ROUTE_LABELS, entryRoute, filterCount, monthBounds, type MonthlyFilters, type RouteKey } from "./monthly-model";
import s from "./monthly.module.css";

export function MoneyTile({ label, value, currency, tone="" }: { label:string;value:number;currency:Currency;tone?:string }) {
 return <div className={s.tile}><span className={s.tileLabel}>{label}</span><strong className={`${s.tileValue} ${tone}`}>{formatMoney(value,currency)}</strong></div>;
}
export function MovementFilters({ filters, onChange, snapshot, month, fixedAccount }: { filters:MonthlyFilters;onChange:(filters:MonthlyFilters)=>void;snapshot:AccountingSnapshot;month:string;fixedAccount?:Account }) {
 const count=filterCount({...filters,account:fixedAccount?"all":filters.account});
 const update=(patch:Partial<MonthlyFilters>)=>onChange({...filters,...patch,...(fixedAccount?{account:fixedAccount}:{})});
 const routes=Object.entries(ROUTE_LABELS).filter(([key])=>key!=="all");
 return <div className={s.filtersBox}>
  <div className={s.filtersTitle}><span><Filter size={13}/>Filtros{count?` (${count})`:""}</span>{count>0&&<button type="button" onClick={()=>onChange({...EMPTY_MONTHLY_FILTERS,account:fixedAccount||"all"})}>× Limpiar</button>}</div>
  <div className={s.filtersGrid}>
   <label>Fecha<input type="date" min={monthBounds(month).from} max={monthBounds(month).to} value={filters.date} onChange={e=>update({date:e.target.value})}/></label>
   {!fixedAccount&&<label>Negocio<select value={filters.account} onChange={e=>update({account:e.target.value as Account|"all"})}><option value="all">Todos</option>{ACCOUNTS.map(a=><option key={a} value={a}>{ACCOUNT_LABELS[a]}</option>)}</select></label>}
   <label>Origen<select value={filters.origin} onChange={e=>update({origin:e.target.value as RouteKey})}><option value="all">Todos</option>{routes.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>Destino<select value={filters.destination} onChange={e=>update({destination:e.target.value as RouteKey})}><option value="all">Todos</option>{routes.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>Medio<select value={filters.methodId} onChange={e=>update({methodId:e.target.value})}><option value="all">Todos</option>{snapshot.methods.map(o=><option key={o.id} value={o.id}>{o.name}{o.active?"":" · archivado"}</option>)}</select></label>
   <label>Tipo / categoría<select value={filters.categoryId} onChange={e=>update({categoryId:e.target.value})}><option value="all">Todos</option>{snapshot.categories.map(o=><option key={o.id} value={o.id}>{o.name} · {o.kind==="income"?"ingreso":"gasto"}</option>)}</select></label>
   <label>Movimiento<select value={filters.kind} onChange={e=>update({kind:e.target.value as MonthlyFilters["kind"]})}><option value="all">Todos</option>{Object.entries(KIND_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  </div>
  <div className={s.filterExtras}><div className={s.search}><Search size={14}/><input aria-label={fixedAccount?`Buscar en ${ACCOUNT_LABELS[fixedAccount]}`:"Buscar movimientos"} placeholder="Buscar concepto o referencia…" value={filters.search} onChange={e=>update({search:e.target.value})}/></div><label className={s.check}><input type="checkbox" checked={filters.includeVoided} onChange={e=>update({includeVoided:e.target.checked})}/>Incluir anulados</label></div>
 </div>;
}
export function LedgerTable({ rows,snapshot,onVoid,pageSize=10,empty="No hay movimientos que coincidan con estos filtros." }: { rows:Entry[];snapshot:AccountingSnapshot;onVoid:(entry:Entry)=>void;pageSize?:number;empty?:string }) {
 const [page,setPage]=useState(1),pages=Math.max(1,Math.ceil(rows.length/pageSize)),current=Math.min(page,pages);
 if(!rows.length)return <div className={s.empty}><ListFilter size={25} strokeWidth={1.3}/><span>{empty}</span></div>;
 const categories=new Map(snapshot.categories.map(o=>[o.id,o.name])),methods=new Map(snapshot.methods.map(o=>[o.id,o.name]));
 return <><div className={s.tableScroll} tabIndex={0} role="region" aria-label="Tabla de movimientos, desplazamiento horizontal disponible"><table className={s.table}><thead><tr><th>Movimiento</th><th>Fecha</th><th>Origen</th><th>Destino</th><th>Medio</th><th>Tipo</th><th className={s.money}>Importe</th><th>Concepto</th><th><span className={s.srOnly}>Acciones</span></th></tr></thead><tbody>{rows.slice((current-1)*pageSize,current*pageSize).map(entry=>{
  const route=entryRoute(entry);
  return <tr key={entry.id} className={entry.voided_at?s.voided:undefined}><td><span className={`${s.pill} ${entry.kind==="income"?s.pillIncome:entry.kind==="expense"?s.pillExpense:entry.kind.startsWith("vault_")?s.pillVault:""}`}>{KIND_LABELS[entry.kind]}</span>{entry.voided_at&&<small>Anulado</small>}</td><td className={s.date}>{dateLabel(entry.occurred_on)}</td><td>{ROUTE_LABELS[route.origin]}</td><td>{ROUTE_LABELS[route.destination]}</td><td>{methods.get(entry.method_id||"")||"—"}</td><td>{categories.get(entry.category_id||"")||"Interno"}</td><td className={`${s.money} ${entry.kind==="income"?s.positive:entry.kind==="expense"?s.negative:""}`}>{formatMoney(entry.amount_cents,entry.currency)}</td><td className={s.note}>{entry.description}{entry.reference&&<small>Ref.: {entry.reference}</small>}{entry.voided_at&&<small>Motivo: {entry.void_reason}</small>}</td><td>{entry.voided_at?<ShieldCheck size={16} aria-label="Anulación conservada"/>:<button type="button" className={s.iconButton} title="Anular con motivo" aria-label={`Anular: ${entry.description}`} onClick={()=>onVoid(entry)}><X size={14}/></button>}</td></tr>;
 })}</tbody></table></div><div className={s.pagination}><span>{rows.length} {rows.length===1?"movimiento":"movimientos"}</span><div><button type="button" className={s.iconButton} disabled={current===1} aria-label="Página anterior de movimientos" onClick={()=>setPage(current-1)}><ChevronLeft size={14}/></button><span>{current} / {pages}</span><button type="button" className={s.iconButton} disabled={current===pages} aria-label="Página siguiente de movimientos" onClick={()=>setPage(current+1)}><ChevronRight size={14}/></button></div></div></>;
}
