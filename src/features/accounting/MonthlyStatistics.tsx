"use client";
import { useId, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, BarChart3, Building2, ChartNoAxesCombined, Landmark, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { ACCOUNT_LABELS, accountingToday, buildCandles, formatMoney, type Account, type AccountingSnapshot, type Currency } from "@/lib/accounting";
import BalanceCandles from "./BalanceCandles";
import { ACCOUNTS, EMPTY_MONTHLY_FILTERS, accountShort, filteredTotals, historyMonthsForMetric, monthBounds, monthLabel, monthlyRows, monthlySummary, percentageChange, safeAdd, shiftMonth } from "./monthly-model";
import s from "./monthly.module.css";

type Point = { label: string; value: number };
export function MonthlyLineChart({ points, currency, title, empty = "Sin histórico disponible" }: { points: Point[]; currency: Currency; title: string; empty?: string }) {
 const id = useId().replaceAll(":", "");
 if (!points.length) return <div className={`${s.empty} ${s.chartEmpty}`}><ChartNoAxesCombined size={27} strokeWidth={1.2}/><span>{empty}</span><small>La gráfica se construirá con tus movimientos.</small></div>;
 const width=900, height=178, left=12, right=888, top=20, bottom=159;
 const min=Math.min(0,...points.map(p=>p.value)), max=Math.max(100,...points.map(p=>p.value));
 const spread=max-min || 100;
 const x=(i:number)=>points.length===1?width/2:left+i*(right-left)/(points.length-1);
 const y=(v:number)=>bottom-(v-min)/spread*(bottom-top);
 const path=points.map((p,i)=>`${i===0?"M":"L"}${x(i)},${y(p.value)}`).join(" ");
 const area=`${path} L${x(points.length-1)},${y(0)} L${x(0)},${y(0)} Z`;
 return <div className={s.chartWrap}>
  <svg className={s.chartSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
   <title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>{points.map(p=>`${p.label}: ${formatMoney(p.value,currency)}`).join(". ")}</desc>
   <defs><linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#85e3f4" stopOpacity=".24"/><stop offset="100%" stopColor="#ab86e4" stopOpacity=".015"/></linearGradient></defs>
   {[0,.25,.5,.75,1].map((n,i)=><line key={i} x1={left} x2={right} y1={top+n*(bottom-top)} y2={top+n*(bottom-top)} stroke="#b1d7ec" strokeOpacity=".08" strokeDasharray="3 6"/>)}
   <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#b4d5e5" strokeOpacity=".17"/>
   <path d={area} fill={`url(#${id}-fill)`}/><path d={path} fill="none" stroke="#8ae8f2" strokeWidth="2.5" strokeLinejoin="round"/>
   {points.map((p,i)=><circle key={`${p.label}-${i}`} cx={x(i)} cy={y(p.value)} r={points.length===1?4:2.5} fill="#b7f5ff"><title>{`${p.label}: ${formatMoney(p.value,currency)}`}</title></circle>)}
  </svg>
  <div className={s.chartLabels}>{points.filter((_,i)=>points.length<=6||i%Math.ceil(points.length/6)===0||i===points.length-1).map((p,i)=><div className={s.chartLabel} key={`${p.label}-${i}`}><span>{p.label}</span><strong>{formatMoney(p.value,currency)}</strong></div>)}</div>
 </div>;
}
function Metric({ label, value, previous, currency, icon:Icon, stock=false }: { label:string; value:number; previous:number; currency:Currency; icon:typeof Wallet; stock?:boolean }) {
 const change=percentageChange(value,previous);
 return <article className={s.kpi}><div className={s.kpiHead}><span><Icon size={16}/>{label}</span><ArrowUpRight size={15}/></div><strong>{formatMoney(value,currency)}</strong><div className={s.kpiBreakdown}><div><small>{stock?"Cierre anterior":"Anterior comparable"}</small>{formatMoney(previous,currency)}</div><div><small>Diferencia</small>{formatMoney(value-previous,currency)}</div></div><p className={s.kpiFoot}>{change===null?(value===0&&previous===0?"Sin movimientos para comparar":"Sin base anterior para calcular %"):`${change>0?"+":""}${change.toLocaleString("es-ES",{maximumFractionDigits:1})} % frente al periodo anterior`}</p></article>;
}
export default function MonthlyStatistics({ snapshot,month,currency,refreshing }: { snapshot:AccountingSnapshot;month:string;currency:Currency;refreshing:boolean }) {
 const [account,setAccount]=useState<Account|"all">("all"),[method,setMethod]=useState("all"),[category,setCategory]=useState("all"),[channel,setChannel]=useState("all");
 const [metric,setMetric]=useState<"income"|"expense"|"available"|"vault"|"candles">("income");
 const filters=useMemo(()=>({...EMPTY_MONTHLY_FILTERS,account,methodId:method,categoryId:category}),[account,method,category]);
 const today=accountingToday(), previousMonth=shiftMonth(month,-1),partial=month===today.slice(0,7);
 const previousCutoff=partial?`${previousMonth}-${String(Math.min(Number(today.slice(-2)),Number(monthBounds(previousMonth).to.slice(-2)))).padStart(2,"0")}`:monthBounds(previousMonth).to;
 const current=useMemo(()=>filteredTotals(monthlyRows(snapshot.entries,month,currency,filters)),[snapshot.entries,month,currency,filters]);
 const previous=useMemo(()=>filteredTotals(monthlyRows(snapshot.entries,previousMonth,currency,filters,previousCutoff)),[snapshot.entries,previousMonth,currency,filters,previousCutoff]);
 const balance=useMemo(()=>monthlySummary(snapshot.entries,month,currency,account),[snapshot.entries,month,currency,account]);
 const previousBalance=useMemo(()=>monthlySummary(snapshot.entries,previousMonth,currency,account),[snapshot.entries,previousMonth,currency,account]);
 const series=useMemo(()=>{
  if(metric==="candles")return [];
  return historyMonthsForMetric(snapshot.entries,month,currency,filters,metric,today).map(m=>{const totals=filteredTotals(monthlyRows(snapshot.entries,m,currency,filters,today));const b=monthlySummary(snapshot.entries,m,currency,account,today);return {label:monthLabel(m,true),value:metric==="income"?totals.income:metric==="expense"?totals.expense:metric==="vault"?b.vault:b.available};});
 },[snapshot.entries,month,currency,filters,account,metric,today]);
 const channelSeries=useMemo(()=>{
  const selected={...filters,methodId:channel==="all"?method:channel};
  return historyMonthsForMetric(snapshot.entries,month,currency,selected,"income",today).map(m=>({label:monthLabel(m,true),value:filteredTotals(monthlyRows(snapshot.entries,m,currency,selected,today)).income}));
 },[snapshot.entries,month,currency,filters,channel,method,today]);
 const distribution=useMemo(()=>{
  const totals=new Map<string,number>();
  for(const row of monthlyRows(snapshot.entries,month,currency,{...filters,kind:"income"})) { const name=snapshot.methods.find(m=>m.id===row.method_id)?.name||"Sin medio";totals.set(name,safeAdd(totals.get(name)||0,row.amount_cents)); }
  return [...totals].sort((a,b)=>b[1]-a[1]);
 },[snapshot,month,currency,filters]);
 const rankings=useMemo(()=>ACCOUNTS.filter(a=>account==="all"||a===account).map(a=>({account:a,...filteredTotals(monthlyRows(snapshot.entries,month,currency,{...filters,account:a}))})).sort((a,b)=>b.net-a.net),[snapshot.entries,month,currency,filters,account]);
 const candles=useMemo(()=>metric==="candles"?buildCandles(snapshot.entries,{account,currency,dateFrom:monthBounds(month).from,dateTo:monthBounds(month).to}):[],[snapshot.entries,month,currency,account,metric]);
 return <section className={`${s.section} ${s.intelligence}`} aria-labelledby="monthly-statistics-title">
  <div className={s.sectionHead}><div><p className={s.eyebrow}><Sparkles size={14}/>Inteligencia financiera</p><h2 id="monthly-statistics-title">Estadísticas financieras</h2><p className={s.subtitle}>{monthLabel(month)} frente a {monthLabel(previousMonth)}{partial?` · actividad comparada hasta el día ${today.slice(-2)}`:""}. Los traspasos no son ingresos.</p></div><span className={s.verified}>{refreshing?"Actualizando…":"Lectura del servidor"}</span></div>
  <div className={s.statsFilters}>
   <label>Negocio<select value={account} onChange={e=>setAccount(e.target.value as Account|"all")}><option value="all">Todos los negocios</option>{ACCOUNTS.map(a=><option key={a} value={a}>{ACCOUNT_LABELS[a]}</option>)}</select></label>
   <label>Método<select value={method} onChange={e=>setMethod(e.target.value)}><option value="all">Todos los métodos</option>{snapshot.methods.map(o=><option key={o.id} value={o.id}>{o.name}{o.active?"":" · archivado"}</option>)}</select></label>
   <label>Tipo / categoría<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">Todos los tipos</option>{snapshot.categories.map(o=><option key={o.id} value={o.id}>{o.name} · {o.kind==="income"?"ingreso":"gasto"}</option>)}</select></label>
  </div>
  <div className={s.kpis}><Metric label="Ingresos" icon={ArrowDownLeft} value={current.income} previous={previous.income} currency={currency}/><Metric label="Gastos" icon={Wallet} value={current.expense} previous={previous.expense} currency={currency}/><Metric label="Balance neto" icon={TrendingUp} value={current.net} previous={previous.net} currency={currency}/><Metric label="Caja extra · Bóveda" icon={Landmark} value={balance.vault} previous={previousBalance.vault} currency={currency} stock/></div>
  <p className={s.formHint}>Método y categoría filtran ingresos y gastos. Los saldos y la bóveda conservan el histórico completo del negocio seleccionado.</p>
  <div className={s.statGrid}>
   <article className={s.chartPanel}><div className={s.sectionHead}><div><p className={s.eyebrow}>¿De dónde viene el dinero?</p><h3>Ingresos por método</h3></div><BarChart3 size={20} className={s.accent}/></div>{distribution.length?<div className={s.bars}>{distribution.map(([name,value])=><div key={name}><div className={s.barHead}><span>{name}</span><strong>{formatMoney(value,currency)}</strong></div><div className={s.barTrack}><div className={s.barFill} style={{width:`${Math.max(1,value/distribution[0][1]*100)}%`}}/></div></div>)}</div>:<div className={`${s.empty} ${s.chartEmpty}`}><BarChart3 size={27} strokeWidth={1.2}/><span>No hay ingresos en el periodo seleccionado.</span></div>}</article>
   <article className={s.chartPanel}><div className={s.sectionHead}><div><p className={s.eyebrow}>Evolución por canal</p><h3>Ingresos de cada método</h3></div><label><span className={s.srOnly}>Método de la gráfica de canal</span><select value={channel} onChange={e=>setChannel(e.target.value)}><option value="all">Todos / filtro actual</option>{snapshot.methods.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div><MonthlyLineChart points={channelSeries} currency={currency} title="Evolución mensual de ingresos por medio"/></article>
  </div>
  <article className={s.chartPanel} style={{marginTop:15}}><div className={s.sectionHead}><div><p className={s.eyebrow}>Evolución financiera</p><h3>Histórico real disponible</h3></div><div className={s.chartButtons} aria-label="Métrica del histórico">{([{key:"income",label:"Ingresos"},{key:"expense",label:"Gastos"},{key:"available",label:"Saldo"},{key:"vault",label:"Caja extra"},{key:"candles",label:"Velas"}] as const).map(t=><button type="button" key={t.key} aria-pressed={metric===t.key} onClick={()=>setMetric(t.key)}>{t.label}</button>)}</div></div>{metric==="candles"?<BalanceCandles candles={candles} currency={currency}/>:<MonthlyLineChart points={series} currency={currency} title={`Histórico mensual de ${metric==="available"?"saldo disponible":metric==="vault"?"bóveda":metric==="expense"?"gastos":"ingresos"}`}/>}<p className={s.formHint}>{metric==="candles"?"Velas reales del saldo disponible del mes; no son cotizaciones.":"Hasta 12 meses. Los saldos se muestran al cierre de cada mes; el mes actual se calcula hasta hoy."}</p></article>
  <div className={s.statGrid}>
   <article className={s.chartPanel}><div className={s.sectionHead}><div><p className={s.eyebrow}>Rendimiento por negocio</p><h3>Comparación por balance neto</h3></div><Building2 size={21} className={s.accent}/></div>{rankings.some(r=>r.income||r.expense)?rankings.map(r=><div className={s.rankingRow} key={r.account}><div><span><Building2 size={14}/><b>{accountShort(r.account)}</b></span><small>Ingresos {formatMoney(r.income,currency)} · Gastos {formatMoney(r.expense,currency)}</small></div><strong className={r.net>=0?s.positive:s.negative}>{formatMoney(r.net,currency)}</strong></div>):<div className={s.empty}>Todavía no hay actividad para comparar los negocios.</div>}</article>
   <article className={s.chartPanel}><div className={s.sectionHead}><div><p className={s.eyebrow}>Lectura del periodo</p><h3>Resumen de tus movimientos</h3></div><Sparkles size={21} className={s.accent}/></div><ul className={s.insights}><li>{current.income||current.expense?`Los ingresos menos los gastos del periodo suman ${formatMoney(current.net,currency)}.`:"No hay ingresos ni gastos que coincidan con los filtros del periodo."}</li><li>{distribution.length?`${distribution[0][0]} es el método con más ingresos: ${formatMoney(distribution[0][1],currency)}.`:"No hay ingresos clasificados por método en este periodo."}</li><li>{balance.vault?`La bóveda conserva ${formatMoney(balance.vault,currency)}, separados del disponible.`:"La bóveda todavía no tiene un saldo reservado en esta moneda."}</li></ul></article>
  </div>
 </section>;
}
