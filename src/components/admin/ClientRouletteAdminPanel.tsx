"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, CalendarClock, Coins, Crown, Diamond, Flame, Gift, History,
  Plus, RefreshCw, Save, ShieldCheck, Sparkles, Star, Target, Trash2, Trophy,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./ClientRouletteAdminPanel.module.css";

const sb = supabaseBrowser();
const rarityOrder = ["common","uncommon","rare","epic","legendary","ultra","diamond","jackpot"] as const;
const rarityNames: Record<string,string> = {
  common:"Común", uncommon:"Poco común", rare:"Raro", epic:"Épico",
  legendary:"Legendario", ultra:"Ultra", diamond:"Diamante", jackpot:"Jackpot",
};
const rewardTypeNames: Record<string,string> = {
  minutes:"Minutos FREE", coins:"Coins", rank:"Rango cliente", ritual:"Ritual",
  streak_minutes:"Premio diario", perk:"Ventaja especial",
};

function localDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function fmt(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("es-ES") : "—";
}

export default function ClientRouletteAdminPanel() {
  const [data,setData] = useState<any>({campaigns:[],rewards:[],history:[],entitlements:[],stats:{}});
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState("");
  const [message,setMessage] = useState("");
  const [selectedCampaignId,setSelectedCampaignId] = useState("");
  const [level,setLevel] = useState<1|2|3|4>(1);
  const [view,setView] = useState<"rewards"|"history"|"benefits">("rewards");
  const [campaignForm,setCampaignForm] = useState<any>(null);
  const [editingReward,setEditingReward] = useState<any>(null);

  const token = async()=> (await sb.auth.getSession()).data.session?.access_token || "";
  const load = useCallback(async()=>{
    setLoading(true); setMessage("");
    try {
      const t=await token();
      const r=await fetch("/api/admin/client-roulette",{headers:{Authorization:`Bearer ${t}`},cache:"no-store"});
      const j=await r.json();
      if(!r.ok||!j.ok) throw new Error(j.error||"No se pudo cargar la Ruleta Ultra Sorpresas.");
      setData(j);
      const activeId=String(j.active_campaign?.id||j.campaigns?.[0]?.id||"");
      setSelectedCampaignId((current)=> current && j.campaigns?.some((x:any)=>String(x.id)===current) ? current : activeId);
    } catch(e:any) { setMessage(e.message||"Error al cargar"); }
    finally { setLoading(false); }
  },[]);

  useEffect(()=>{void load()},[load]);
  useEffect(()=>{
    let timer:number|undefined;
    const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>void load(),350)};
    const ch=sb.channel("admin-roulette-ultra-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"tc_client_roulette_campaigns"},schedule)
      .on("postgres_changes",{event:"*",schema:"public",table:"tc_client_roulette_rewards"},schedule)
      .on("postgres_changes",{event:"*",schema:"public",table:"tc_client_roulette_entitlements"},schedule)
      .on("postgres_changes",{event:"*",schema:"public",table:"cliente_ruleta_giros"},schedule)
      .subscribe();
    const fallback=window.setInterval(()=>{if(!document.hidden) void load()},45000);
    return()=>{window.clearTimeout(timer);window.clearInterval(fallback);void sb.removeChannel(ch)};
  },[load]);

  const campaign=useMemo(()=>data.campaigns?.find((x:any)=>String(x.id)===selectedCampaignId)||null,[data.campaigns,selectedCampaignId]);
  useEffect(()=>{
    if(!campaign){setCampaignForm(null);return}
    setCampaignForm({
      id:campaign.id,name:campaign.name||"",title:campaign.title||"",subtitle:campaign.subtitle||"",
      status:campaign.status||"draft",starts_at:localDate(campaign.starts_at),ends_at:localDate(campaign.ends_at),
      active_until_disabled:Boolean(campaign.active_until_disabled),
    });
  },[campaign]);

  const rewards=useMemo(()=> (data.rewards||[]).filter((x:any)=>String(x.campaign_id)===selectedCampaignId && Number(x.nivel)===level),[data.rewards,selectedCampaignId,level]);
  const totalWeight=useMemo(()=>rewards.filter((r:any)=>r.is_active).reduce((a:number,r:any)=>a+Number(r.weight||0),0),[rewards]);

  async function mutate(payload:any,key="save") {
    setBusy(key);setMessage("");
    try {
      const t=await token();
      const r=await fetch("/api/admin/client-roulette",{method:"POST",headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const j=await r.json();
      if(!r.ok||!j.ok) throw new Error(j.error||"No se pudo guardar.");
      setData(j);
      setMessage("Guardado y sincronizado correctamente.");
      return j;
    } catch(e:any){setMessage(e.message||"Error al guardar");return null}
    finally{setBusy("")}
  }

  function blankReward() {
    return {campaign_id:selectedCampaignId,nivel:level,name:"Nuevo premio",description:"",reward_type:"minutes",reward_value:5,rarity:"common",weight:10,special:false,fulfillment_mode:"immediate",icon_key:"gift",metadata:{},is_active:true,sort_order:(rewards.length+1)*10};
  }

  return <section className={styles.wrap}>
    <header className={styles.hero}>
      <div>
        <span className={styles.eyebrow}><Sparkles size={14}/> Fidelización · Ruleta Ultra Sorpresas</span>
        <h1>Ruletas clientes</h1>
        <p>Controla campañas, premios, rarezas y probabilidades reales desde una única fuente de verdad.</p>
      </div>
      <button className={styles.refresh} onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>{loading?"Sincronizando…":"Actualizar"}</button>
    </header>

    {message?<div className={styles.message}>{message}</div>:null}

    <div className={styles.stats}>
      <article><span><Activity/></span><div><small>Giros auditados</small><strong>{data.stats?.total_spins_loaded??0}</strong></div></article>
      <article><span><Trophy/></span><div><small>Premios fuertes</small><strong>{data.stats?.special_spins??0}</strong></div></article>
      <article><span><Gift/></span><div><small>Premios pendientes</small><strong>{data.stats?.pending_fulfillment??0}</strong></div></article>
      <article><span><Target/></span><div><small>Más entregado</small><strong>{data.stats?.most_awarded?.name||"—"}</strong></div></article>
    </div>

    <section className={styles.controlGrid}>
      <article className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.eyebrow}>CAMPAÑA</span><h2>Ruleta activa</h2></div><button className={styles.secondary} onClick={()=>void mutate({action:"create_campaign",name:"Nueva Ultra Sorpresas",title:"Ruleta Ultra Sorpresas"},"new-campaign")}><Plus size={14}/> Nueva</button></div>
        <label>Campaña<select value={selectedCampaignId} onChange={e=>setSelectedCampaignId(e.target.value)}>{(data.campaigns||[]).map((c:any)=><option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}</select></label>
        {campaignForm?<div className={styles.formGrid}>
          <label>Nombre<input value={campaignForm.name} onChange={e=>setCampaignForm({...campaignForm,name:e.target.value})}/></label>
          <label>Estado<select value={campaignForm.status} onChange={e=>setCampaignForm({...campaignForm,status:e.target.value})}><option value="draft">Borrador</option><option value="scheduled">Programada</option><option value="active">Activa</option><option value="inactive">Inactiva</option><option value="finished">Finalizada</option></select></label>
          <label className={styles.span2}>Título cliente<input value={campaignForm.title} onChange={e=>setCampaignForm({...campaignForm,title:e.target.value})}/></label>
          <label className={styles.span2}>Subtítulo<input value={campaignForm.subtitle} onChange={e=>setCampaignForm({...campaignForm,subtitle:e.target.value})}/></label>
          <label>Inicio<input type="datetime-local" value={campaignForm.starts_at} onChange={e=>setCampaignForm({...campaignForm,starts_at:e.target.value})}/></label>
          <label>Fin<input type="datetime-local" disabled={campaignForm.active_until_disabled} value={campaignForm.ends_at} onChange={e=>setCampaignForm({...campaignForm,ends_at:e.target.value})}/></label>
          <label className={styles.check}><input type="checkbox" checked={campaignForm.active_until_disabled} onChange={e=>setCampaignForm({...campaignForm,active_until_disabled:e.target.checked})}/> Activa hasta desactivarla</label>
          <div className={styles.actions}><button className={styles.primary} disabled={busy==="campaign"} onClick={()=>void mutate({action:"save_campaign",...campaignForm},"campaign")}><Save size={14}/> Guardar</button>{campaign?.status!=="active"?<button className={styles.gold} onClick={()=>void mutate({action:"activate_campaign",id:campaign.id},"activate")}><Flame size={14}/> Activar ahora</button>:<span className={styles.live}><span/> EN VIVO</span>}</div>
        </div>:null}
      </article>

      <article className={styles.card}>
        <span className={styles.eyebrow}>REGLAS DE PROBABILIDAD</span>
        <h2>Pesos seguros y normalizados</h2>
        <p className={styles.help}>Cada premio tiene un peso. El servidor suma los pesos activos del nivel y calcula la probabilidad real automáticamente. Así puedes editar premios sin dejar la ruleta en un estado inválido.</p>
        <div className={styles.rarityLegend}>{rarityOrder.map(r=><span key={r} data-rarity={r}>{rarityNames[r]}</span>)}</div>
        <div className={styles.ruleBox}><ShieldCheck size={18}/><div><strong>El resultado nunca se decide en frontend.</strong><small>Se bloquea y acredita en PostgreSQL antes de que la animación muestre el premio.</small></div></div>
      </article>
    </section>

    <nav className={styles.tabs}>
      <button data-active={view==="rewards"} onClick={()=>setView("rewards")}><Gift/> Premios y probabilidades</button>
      <button data-active={view==="history"} onClick={()=>setView("history")}><History/> Historial de giros</button>
      <button data-active={view==="benefits"} onClick={()=>setView("benefits")}><Crown/> Premios especiales</button>
    </nav>

    {view==="rewards"?<section className={styles.card}>
      <div className={styles.rewardToolbar}>
        <div><span className={styles.eyebrow}>CATÁLOGO CONFIGURABLE</span><h2>Premios de la Ruleta Ultra</h2></div>
        <button className={styles.gold} disabled={!selectedCampaignId} onClick={()=>setEditingReward(blankReward())}><Plus/> Añadir premio</button>
      </div>
      <div className={styles.levelTabs}>{([1,2,3,4] as const).map(n=><button key={n} data-active={level===n} onClick={()=>setLevel(n)}><span>{n===4?"NIVEL ESPECIAL":"NIVEL "+n}</span><strong>{(data.rewards||[]).filter((r:any)=>String(r.campaign_id)===selectedCampaignId&&Number(r.nivel)===n&&r.is_active).length} premios</strong></button>)}</div>
      <div className={styles.levelSummary}><span>Peso activo total <b>{totalWeight.toFixed(2)}</b></span><span>Probabilidad mostrada = peso / total</span></div>
      <div className={styles.rewardList}>{rewards.length?rewards.map((r:any)=><article className={styles.reward} key={r.id} data-rarity={r.rarity} data-disabled={!r.is_active}>
        <div className={styles.rewardRarity}><span>{rarityNames[r.rarity]||r.rarity}</span>{r.special?<b>PREMIO FUERTE</b>:null}</div>
        <div className={styles.rewardMain}><div className={styles.rewardIcon}>{r.rarity==="diamond"?<Diamond/>:r.rarity==="jackpot"?<Flame/>:r.reward_type==="coins"?<Coins/>:r.reward_type==="rank"?<Crown/>:<Gift/>}</div><div><h3>{r.name}</h3><p>{r.description||rewardTypeNames[r.reward_type]}</p></div><strong className={styles.prob}>{Number(r.probability||0).toFixed(2)}%</strong></div>
        <div className={styles.rewardMeta}><span>{rewardTypeNames[r.reward_type]||r.reward_type}</span><span>Peso {Number(r.weight||0).toFixed(2)}</span><span>{r.is_active?"Activo":"Desactivado"}</span></div>
        <div className={styles.rewardActions}><button onClick={()=>setEditingReward({...r,metadata:r.metadata||{}})}>Editar</button><button onClick={()=>void mutate({action:"toggle_reward",id:r.id,is_active:!r.is_active},`toggle:${r.id}`)}>{r.is_active?"Desactivar":"Activar"}</button><button className={styles.danger} onClick={()=>{if(window.confirm("¿Eliminar este premio? Si ya tiene historial se archivará para conservar la auditoría.")) void mutate({action:"delete_reward",id:r.id},`delete:${r.id}`)}}><Trash2 size={13}/></button></div>
      </article>):<div className={styles.empty}>Este nivel todavía no tiene premios. Añade el primero.</div>}</div>
    </section>:null}

    {view==="history"?<section className={styles.card}>
      <div className={styles.cardHead}><div><span className={styles.eyebrow}>AUDITORÍA REAL</span><h2>Últimos giros</h2></div><span className={styles.live}><span/> DATOS REALES</span></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Cliente</th><th>Nivel</th><th>Premio</th><th>Rareza</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>{(data.history||[]).map((row:any)=><tr key={row.id}><td><strong>{row.client_name}</strong></td><td>N{row.nivel}</td><td>{row.reward_label||"Premio"}</td><td><span className={styles.tableRarity} data-rarity={row.reward_rarity||"common"}>{rarityNames[row.reward_rarity]||row.reward_rarity||"Común"}</span></td><td>{row.result_status||"credited"}</td><td>{fmt(row.used_at||row.created_at)}</td></tr>)}</tbody></table></div>
    </section>:null}

    {view==="benefits"?<section className={styles.card}>
      <div className={styles.cardHead}><div><span className={styles.eyebrow}>FULFILLMENT</span><h2>Rituales, rangos y beneficios activos</h2></div><span className={styles.counter}>{(data.entitlements||[]).length}</span></div>
      <div className={styles.benefitList}>{(data.entitlements||[]).length?(data.entitlements||[]).map((e:any)=><article key={e.id}><div><strong>{e.reward_name}</strong><span>{e.reward_type} · {e.fulfillment_mode}</span></div><div><span className={styles.status}>{e.status}</span>{["pending","active"].includes(e.status)?<button className={styles.secondary} onClick={()=>void mutate({action:"complete_entitlement",id:e.id},`ent:${e.id}`)}>Marcar completado</button>:null}</div></article>):<div className={styles.empty}>No hay premios especiales pendientes.</div>}</div>
    </section>:null}

    {editingReward?<RewardModal reward={editingReward} busy={busy} onClose={()=>setEditingReward(null)} onSave={async(form)=>{const result=await mutate({action:"save_reward",...form},"reward");if(result)setEditingReward(null)}}/>:null}
  </section>;
}

function RewardModal({reward,busy,onClose,onSave}:{reward:any;busy:string;onClose:()=>void;onSave:(v:any)=>Promise<void>}) {
  const [form,setForm]=useState<any>({...reward,metadata:reward.metadata||{}});
  const metadata=form.metadata||{};
  return <div className={styles.modalBackdrop} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className={styles.modal} data-rarity={form.rarity}>
    <div className={styles.cardHead}><div><span className={styles.eyebrow}>CONFIGURAR PREMIO</span><h2>{form.id?"Editar premio":"Nuevo premio"}</h2></div><button className={styles.close} onClick={onClose}>×</button></div>
    <div className={styles.formGrid}>
      <label className={styles.span2}>Nombre<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>Tipo<select value={form.reward_type} onChange={e=>setForm({...form,reward_type:e.target.value})}>{Object.entries(rewardTypeNames).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
      <label>Rareza<select value={form.rarity} onChange={e=>setForm({...form,rarity:e.target.value})}>{rarityOrder.map(r=><option value={r} key={r}>{rarityNames[r]}</option>)}</select></label>
      <label>Valor<input type="number" min="0" step="1" value={form.reward_value} onChange={e=>setForm({...form,reward_value:Number(e.target.value)})}/></label>
      <label>Peso<input type="number" min="0" step="0.1" value={form.weight} onChange={e=>setForm({...form,weight:Number(e.target.value)})}/></label>
      <label>Nivel<select value={form.nivel} onChange={e=>setForm({...form,nivel:Number(e.target.value)})}><option value={1}>Nivel 1</option><option value={2}>Nivel 2</option><option value={3}>Nivel 3</option><option value={4}>Nivel Especial</option></select></label>
      <label>Entrega<select value={form.fulfillment_mode} onChange={e=>setForm({...form,fulfillment_mode:e.target.value})}><option value="immediate">Inmediata</option><option value="temporary">Temporal</option><option value="manual">Manual supervisada</option><option value="claim">Reclamación</option><option value="scheduled">Programada</option></select></label>
      <label className={styles.span2}>Descripción<textarea rows={2} value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      {form.reward_type==="rank"?<><label>Rango<select value={metadata.rank||"plata"} onChange={e=>setForm({...form,metadata:{...metadata,rank:e.target.value}})}><option value="plata">Plata</option><option value="oro">Oro</option></select></label><label>Duración días <small>(0 = permanente)</small><input type="number" min="0" value={metadata.duration_days??30} onChange={e=>setForm({...form,metadata:{...metadata,duration_days:Number(e.target.value)}})}/></label></>:null}
      {form.reward_type==="streak_minutes"?<><label>Minutos diarios<input type="number" min="1" value={metadata.daily_minutes??10} onChange={e=>setForm({...form,reward_value:Number(e.target.value),metadata:{...metadata,daily_minutes:Number(e.target.value)}})}/></label><label>Días<input type="number" min="1" value={metadata.days_total??7} onChange={e=>setForm({...form,metadata:{...metadata,days_total:Number(e.target.value)}})}/></label></>:null}
      {form.reward_type==="ritual"?<label className={styles.span2}>Código ritual<input value={metadata.ritual||"proteccion"} onChange={e=>setForm({...form,metadata:{...metadata,ritual:e.target.value}})}/></label>:null}
      <label>Orden<input type="number" value={form.sort_order||0} onChange={e=>setForm({...form,sort_order:Number(e.target.value)})}/></label>
      <label className={styles.check}><input type="checkbox" checked={Boolean(form.special)} onChange={e=>setForm({...form,special:e.target.checked})}/> Premio fuerte / destacado</label>
      <label className={styles.check}><input type="checkbox" checked={form.is_active!==false} onChange={e=>setForm({...form,is_active:e.target.checked})}/> Activo</label>
    </div>
    <div className={styles.actions}><button className={styles.secondary} onClick={onClose}>Cancelar</button><button className={styles.gold} disabled={busy==="reward"||!form.name} onClick={()=>void onSave(form)}><Save size={14}/>{busy==="reward"?"Guardando…":"Guardar premio"}</button></div>
  </div></div>;
}
