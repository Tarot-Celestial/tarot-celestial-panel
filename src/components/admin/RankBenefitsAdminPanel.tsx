"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, RefreshCw, Save, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import CrystalEmblem from "@/components/benefits/CrystalEmblem";
import styles from "./RankBenefitsAdminPanel.module.css";
const sb = supabaseBrowser();
type Row = Record<string, any>;
type Data = { ranks: Row[]; bands: Row[]; bonuses: Row[]; events: Row[]; audit: Row[]; has_more: boolean };
type SaveRow = (action: string, data: Row) => Promise<boolean>;
const levelName = (n: number) => n === 5 ? "Diamante" : n === 4 ? "Especial" : `Nivel ${n}`;
const money = (n: number, c: string) => new Intl.NumberFormat("es-ES", {style:"currency",currency:c || "EUR"}).format(n);
const date = (v: string) => new Date(v).toLocaleString("es-ES");
function localDate(v?: string) { if (!v) return ""; const d=new Date(v); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }

export function Toggle({ label, value, onChange }: {label:string;value:boolean;onChange:(v:boolean)=>void}) {
  return <label className={styles.toggle}><span>{label}</span><input type="checkbox" role="switch" checked={value} onChange={e=>onChange(e.target.checked)}/><i aria-hidden="true"/></label>;
}
export default function RankBenefitsAdminPanel({ mode = "config" }: {mode?:"config"|"bonuses"}) {
  const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[message,setMessage]=useState("");
  const [success,setSuccess]=useState(false),[tab,setTab]=useState("ranks"),[page,setPage]=useState(0),[client,setClient]=useState("");
  const [bonus,setBonus]=useState<Row|null>(null),[newRank,setNewRank]=useState<Row|null>(null),[newBand,setNewBand]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    try {
      const token=(await sb.auth.getSession()).data.session?.access_token;
      if(!token) throw new Error("Inicia sesión como administrador.");
      const response=await fetch(`/api/admin/rank-benefits?page=${page}${client?`&client_id=${encodeURIComponent(client)}`:""}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
      const result=await response.json(); if(!response.ok||!result.ok) throw new Error(result.error);
      setData(result);
    }catch(e:any){setSuccess(false);setMessage(e.message||"No se pudo cargar la configuración.");}
    finally{setLoading(false);}
  },[page,client]);
  useEffect(()=>{void load()},[load]);
  const save:SaveRow=async(action,row)=>{
    setMessage("");setSuccess(false);
    try {
      const token=(await sb.auth.getSession()).data.session?.access_token;
      const response=await fetch("/api/admin/rank-benefits",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({action,data:row})});
      const result=await response.json(); if(!response.ok||!result.ok) throw new Error(result.error);
      await load();setMessage("Cambios guardados. La nueva configuración ya está disponible.");setSuccess(true);return true;
    }catch(e:any){setMessage(e.message||"No se pudieron guardar los cambios.");return false;}
  };
  const createBonus=()=>setBonus({name:"",description:"",authorized_rank:data?.ranks.find(r=>r.rank_key==="diamante")?.rank_key||data?.ranks[0]?.rank_key||"",status:"draft",image_url:"",starts_at:new Date().toISOString(),ends_at:"",active_until_disabled:false,max_uses_per_client:1,benefit:{coins:0,minutes:0,oracle_credits:0}});
  return <section className={styles.wrap}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>{mode==="bonuses"?"PRECIOS DE HOY · ACCESO EXCLUSIVO":"FIDELIZACIÓN · CENTRO DE CONTROL"}</span><h1>{mode==="bonuses"?"Bono exclusivo Rango Diamante":"Beneficios de rango"}</h1><p>{mode==="bonuses"?"Una ventaja diaria para quienes han desbloqueado su rango. El consumo queda registrado en su cuenta.":"Configura lo que recibe cada cliente. Una compra puede activar varios beneficios a la vez."}</p></div>
      <CrystalEmblem size={112}/>
    </header>
    {message&&<div className={styles.message} data-success={success} role={success?"status":"alert"}>{success&&<Check size={18}/>}<span>{message}</span></div>}
    <div className={styles.toolbar}>
      {mode==="config"?<nav aria-label="Configuración de beneficios" className={styles.tabs}>{[["ranks","Por rango"],["bands","Tramos de compra"],["events","Entregas"],["audit","Cambios de Admin"]].map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>:<button className={styles.primary} onClick={createBonus} disabled={!data}><Plus size={16}/> Crear bono</button>}
      <button className={styles.secondary} onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>{loading?"Cargando…":"Actualizar"}</button>
    </div>
    {!data?<div className={styles.empty}>{loading?"Cargando configuración real…":"No se pudo cargar. Comprueba que la migración está aplicada y pulsa Actualizar."}</div>:<>
      {mode==="config"&&tab==="ranks"&&<>
        <div className={styles.rankGrid}>{data.ranks.map(row=><RankCard key={`${row.rank_key}:${row.revision}`} row={row} save={save}/>)}</div>
        {newRank?<RankCard row={newRank} save={async(a,r)=>{const ok=await save(a,r);if(ok)setNewRank(null);return ok}} isNew/>:<button className={styles.secondary} onClick={()=>setNewRank({rank_key:"",label:"",min_spend:1,sort_order:data.ranks.length+1,is_active:true,coins_enabled:false,purchase_coins:0,roulette_enabled:false,roulette_level:5,roulette_spins:1,daily_bonus_enabled:false})}><Plus size={16}/> Añadir rango</button>}
        <div className={styles.note}>Los extras del rango se suman a los beneficios del pack y al giro del tramo de compra. Desactivar un beneficio detiene futuras entregas; el historial se conserva.</div>
      </>}
      {mode==="config"&&tab==="bands"&&<section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Importe confirmado → tirada</h2><p>Límites incluidos y con céntimos. Cada moneda tiene sus propios tramos.</p></div><button className={styles.primary} onClick={()=>setNewBand(true)}><Plus size={16}/> Añadir tramo</button></div>
        <div className={styles.bandList}>{data.bands.map(row=><BandCard key={`${row.id}:${row.revision}`} row={row} save={save}/>)}</div>
        {newBand&&<BandCard row={{currency:"USD",min_amount:0,max_amount:"",roulette_level:1,spins:1,is_active:true}} save={async(a,r)=>{const ok=await save(a,r);if(ok)setNewBand(false);return ok}}/>}
        <div className={styles.note}>Si una compra queda fuera de los tramos activos, no recibe ruleta por importe. Sus beneficios por rango siguen aplicándose. Los tramos que se solapan se rechazan al guardar.</div>
      </section>}
      {mode==="config"&&tab==="events"&&<section className={styles.card}>
        <div className={styles.sectionHead}><div><h2>Beneficios entregados</h2><p>Rango y condiciones conservados en el momento de cada operación.</p></div><label>Filtrar por ID de cliente<input value={client} onChange={e=>{setClient(e.target.value);setPage(0)}} placeholder="UUID del cliente"/></label></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Cliente / rango</th><th>Beneficio</th><th>Compra</th><th>Entrega</th><th>Fecha</th><th>Detalle</th></tr></thead><tbody>{data.events.map(e=><tr key={e.id}><td><strong>{e.client_name}</strong><small>{e.rank_at_event||"Sin rango"}</small></td><td>{({coins:"Coins",roulette:"Tirada",bonus:"Bono utilizado",oracle_credits:"Oráculo",roulette_result:"Premio de ruleta"} as Row)[e.benefit_type]||e.benefit_type}</td><td>{e.purchase_amount!=null?money(e.purchase_amount,e.currency):"—"}<small>{e.payment_id||"Sin compra asociada"}</small></td><td>{[e.coins?`+${e.coins} Coins`:null,e.minutes?`+${e.minutes} min`:null,e.oracle_credits?`+${e.oracle_credits} Oráculo`:null,e.benefit_type==="roulette"?`1 giro ${levelName(e.snapshot?.level)}`:null].filter(Boolean).join(" · ")||"Registrado"}</td><td>{date(e.created_at)}</td><td><details><summary>Ver registro</summary><pre>{JSON.stringify({id:e.id,spin_id:e.spin_id,promotion_id:e.promotion_id,condiciones:e.snapshot},null,2)}</pre></details></td></tr>)}</tbody></table></div>
        {!data.events.length&&<div className={styles.empty}>No hay entregas que mostrar.</div>}
        <div className={styles.pagination}><button className={styles.secondary} disabled={page===0} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={16}/> Anterior</button><span>Página {page+1}</span><button className={styles.secondary} disabled={!data.has_more} onClick={()=>setPage(p=>p+1)}>Siguiente <ChevronRight size={16}/></button></div>
      </section>}
      {mode==="config"&&tab==="audit"&&<section className={styles.card}><h2>Cambios de configuración</h2><div className={styles.audit}>{data.audit.map(a=><details key={a.id}><summary><strong>{a.actor_name}</strong><span>{a.action} · {a.entity_id}</span><time>{date(a.created_at)}</time></summary><div className={styles.auditDiff}><div><small>ANTES</small><pre>{JSON.stringify(a.before_data,null,2)}</pre></div><div><small>DESPUÉS</small><pre>{JSON.stringify(a.after_data,null,2)}</pre></div></div></details>)}{!data.audit.length&&<p>Todavía no hay cambios registrados.</p>}</div></section>}
      {mode==="bonuses"&&<div className={styles.bonusGrid}>{data.bonuses.map(b=><article key={b.id} className={styles.bonusCard}>
        <div className={styles.sectionHead}><CrystalEmblem size={64} tone={b.authorized_rank}/><span className={styles.pill} data-on={b.status==="active"}>{b.status==="active"?"Activo":b.status==="scheduled"?"Programado":b.status==="draft"?"Borrador":"Inactivo"}</span></div>
        <span className={styles.eyebrow}>{b.authorized_rank}</span><h2>{b.name}</h2><p>{b.description}</p><BenefitLine benefit={b.benefit}/><small>{b.max_uses_per_client} uso(s) por cliente y día · horario de Madrid</small><small>{b.starts_at?date(b.starts_at):"Disponible desde su activación"} → {b.active_until_disabled?"Hasta desactivar":b.ends_at?date(b.ends_at):"Sin fin"}</small><button className={styles.secondary} onClick={()=>setBonus(b)}>Editar bono</button>
      </article>)}{!data.bonuses.length&&<div className={styles.empty}>No hay bonos creados. Crea el primero y define su beneficio antes de activarlo.</div>}</div>}
    </>}
    {bonus&&data&&<BonusEditor row={bonus} ranks={data.ranks} save={save} close={()=>setBonus(null)}/>}
  </section>;
}

export function BenefitLine({benefit}:{benefit:Row}) {
  return <div className={styles.benefitLine}>{Number(benefit?.coins)>0&&<span><b className={styles.coin}>✦</b> +{benefit.coins} Coins</span>}{Number(benefit?.minutes)>0&&<span>+{benefit.minutes} minutos FREE</span>}{Number(benefit?.oracle_credits)>0&&<span>+{benefit.oracle_credits} tiradas Oráculo</span>}</div>;
}
function RankCard({row,save,isNew=false}:{row:Row;save:SaveRow;isNew?:boolean}) {
  const [form,setForm]=useState(row),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  const set=(key:string,v:any)=>{setForm(f=>({...f,[key]:v}));setDirty(true)};
  return <form className={styles.rankCard} data-rank={form.rank_key} onSubmit={async e=>{e.preventDefault();setBusy(true);const ok=await save("rank",form);if(ok)setDirty(false);setBusy(false)}}>
    <div className={styles.rankHeader}><CrystalEmblem tone={form.rank_key}/><div><span className={styles.eyebrow}>BENEFICIOS DE RANGO</span><h2>{form.label||"Nuevo rango"}</h2><span className={styles.pill} data-on={form.is_active}>{form.is_active?"Activo":"Pausado"}</span></div></div>
    {isNew&&<div className={styles.fields}><label>Clave<input required pattern="[a-z][a-z0-9_]{1,39}" value={form.rank_key} onChange={e=>set("rank_key",e.target.value)} placeholder="Ej. platino"/></label><label>Nombre<input required value={form.label} onChange={e=>set("label",e.target.value)}/></label></div>}
    <Toggle label="Beneficios activos" value={form.is_active} onChange={v=>set("is_active",v)}/>
    <div className={styles.benefitGroup}><Toggle label="Coins extra por compra" value={form.coins_enabled} onChange={v=>set("coins_enabled",v)}/><label className={styles.numberField}><b className={styles.coin}>✦</b><input aria-label={`Coins por compra ${form.label}`} type="number" required min="0" max="1000000" step="1" value={form.purchase_coins} onChange={e=>set("purchase_coins",Number(e.target.value))}/><span>Coins</span></label></div>
    <div className={styles.benefitGroup}><Toggle label="Ruleta extra por compra" value={form.roulette_enabled} onChange={v=>set("roulette_enabled",v)}/><div className={styles.fields}><label>Ruleta<select value={form.roulette_level} onChange={e=>set("roulette_level",Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{levelName(n)}</option>)}</select></label><label>Tiradas<input type="number" required min="1" max="20" value={form.roulette_spins} onChange={e=>set("roulette_spins",Number(e.target.value))}/></label></div></div>
    <Toggle label="Acceso al bono diario" value={form.daily_bonus_enabled} onChange={v=>set("daily_bonus_enabled",v)}/>
    <details className={styles.advanced}><summary>Umbral y orden del rango</summary><label>Gasto mínimo en 30 días<input type="number" required min="0.01" step="0.01" value={form.min_spend} onChange={e=>set("min_spend",Number(e.target.value))}/></label><label>Orden<input type="number" value={form.sort_order} onChange={e=>set("sort_order",Number(e.target.value))}/></label></details>
    <button className={styles.primary} disabled={busy||(!dirty&&!isNew)} type="submit"><Save size={16}/>{busy?"Guardando…":dirty||isNew?"Guardar cambios":"Guardado"}</button>
  </form>;
}
function BandCard({row,save}:{row:Row;save:SaveRow}) {
  const [f,setF]=useState<Row>({...row,max_amount:row.max_amount??""}),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(!row.id);
  const set=(k:string,v:any)=>{setF(f=>({...f,[k]:v}));setDirty(true)};
  return <form className={styles.band} onSubmit={async e=>{e.preventDefault();setBusy(true);if(await save("band",f))setDirty(false);setBusy(false)}}>
    <label>Moneda<select value={f.currency} onChange={e=>set("currency",e.target.value)}><option>USD</option><option>EUR</option></select></label>
    <label>Desde<input type="number" min="0" step="0.01" required value={f.min_amount} onChange={e=>set("min_amount",Number(e.target.value))}/></label>
    <label>Hasta (incluido)<input type="number" min={f.min_amount} step="0.01" value={f.max_amount} placeholder="Sin límite" onChange={e=>set("max_amount",e.target.value===""?"":Number(e.target.value))}/></label>
    <label>Ruleta<select value={f.roulette_level} onChange={e=>set("roulette_level",Number(e.target.value))}>{[1,2,3].map(n=><option key={n} value={n}>Nivel {n}</option>)}</select></label>
    <label>Tiradas<input type="number" required min="1" max="20" value={f.spins} onChange={e=>set("spins",Number(e.target.value))}/></label>
    <Toggle label="Activo" value={f.is_active} onChange={v=>set("is_active",v)}/><button className={styles.secondary} disabled={busy||!dirty} type="submit"><Save size={15}/>{busy?"Guardando…":"Guardar"}</button>
  </form>;
}
function BonusEditor({row,ranks,save,close}:{row:Row;ranks:Row[];save:SaveRow;close:()=>void}) {
  const [f,setF]=useState<Row>({...row,starts_at:localDate(row.starts_at),ends_at:localDate(row.ends_at)}),[busy,setBusy]=useState(false);
  const set=(k:string,v:any)=>setF(f=>({...f,[k]:v}));
  useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&!busy)close()};document.addEventListener("keydown",escape);return()=>document.removeEventListener("keydown",escape)},[busy,close]);
  return <div className={styles.overlay}><form className={styles.modal} role="dialog" aria-modal="true" aria-label="Configurar bono exclusivo" onSubmit={async e=>{e.preventDefault();setBusy(true);const ok=await save("bonus",{...f,starts_at:f.starts_at?new Date(f.starts_at).toISOString():null,ends_at:f.ends_at?new Date(f.ends_at).toISOString():null});setBusy(false);if(ok)close()}}>
    <div className={styles.sectionHead}><div><span className={styles.eyebrow}>BONO EXCLUSIVO</span><h2>{row.id?"Editar bono":"Nuevo bono"}</h2></div><button type="button" className={styles.iconButton} aria-label="Cerrar" disabled={busy} onClick={close}><X/></button></div>
    <div className={styles.fields}><label className={styles.full}>Título<input autoFocus required maxLength={160} value={f.name} onChange={e=>set("name",e.target.value)}/></label><label className={styles.full}>Descripción<textarea maxLength={2000} value={f.description||""} onChange={e=>set("description",e.target.value)}/></label><label>Rango autorizado<select value={f.authorized_rank} onChange={e=>set("authorized_rank",e.target.value)}>{ranks.map(r=><option key={r.rank_key} value={r.rank_key}>{r.label}</option>)}</select></label><label>Estado<select value={f.status} onChange={e=>set("status",e.target.value)}><option value="draft">Borrador</option><option value="active">Activo</option><option value="scheduled">Programado</option><option value="inactive">Inactivo</option></select></label><label className={styles.full}>Imagen (URL opcional)<input value={f.image_url||""} onChange={e=>set("image_url",e.target.value)} placeholder="Sin URL se usa el diamante cristalino"/></label>
      {[['coins','Coins'],['minutes','Minutos FREE'],['oracle_credits','Tiradas de Oráculo']].map(([key,label])=><label key={key}>{label}<input type="number" min="0" max="1000000" step="1" required value={f.benefit?.[key]||0} onChange={e=>set("benefit",{...f.benefit,[key]:Number(e.target.value)})}/></label>)}
      <label>Máximo de usos al día<input type="number" min="1" max="20" step="1" required value={f.max_uses_per_client} onChange={e=>set("max_uses_per_client",Number(e.target.value))}/></label><label>Desde<input type="datetime-local" value={f.starts_at} onChange={e=>set("starts_at",e.target.value)}/></label><label>Hasta<input type="datetime-local" required={!f.active_until_disabled} disabled={f.active_until_disabled} value={f.ends_at} onChange={e=>set("ends_at",e.target.value)}/></label>
    </div>
    <Toggle label="Disponible hasta desactivarlo" value={f.active_until_disabled} onChange={v=>set("active_until_disabled",v)}/><p className={styles.note}>El día se reinicia a medianoche de Madrid. Editar o sustituir el bono no borra los usos del día. El acceso al bono también debe estar activo en la tarjeta del rango.</p>
    <button className={styles.primary} type="submit" disabled={busy}><Save size={16}/>{busy?"Guardando…":"Guardar bono"}</button>
  </form></div>;
}
