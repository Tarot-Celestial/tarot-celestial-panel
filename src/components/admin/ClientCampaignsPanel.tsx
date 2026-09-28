"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CalendarClock, Eye, Megaphone, RefreshCw, Save, Send } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { CAMPAIGN_STATUS, normalizeCampaign, safeCampaignUrl, type CampaignDraft } from "@/lib/campaigns";
import styles from "./ClientCampaignsPanel.module.css";

const blank = (): CampaignDraft => ({ title: "", message: "", image_url: "", action_url: "", expires_at: "", channels: ["panel"], audience: { mode: "all", client_ids: [], country: "", inactive_days: null } });
const dateLabel = (value: string) => value ? new Date(value).toLocaleString("es-ES") : "Sin programar";
const localDate = (value: string) => { if (!value) return ""; const d = new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
type Recipient = { client_id: string; full_name: string; country: string; eligible: boolean; push_devices: number };
type AudienceResult = { matched: number; eligible: number; push_devices: number; countries: string[]; sample: Recipient[]; search_total: number };
type CampaignRow = CampaignDraft & { id: string; status: string; scheduled_at: string; created_at: string; results: Record<string,number> };
async function api(body?: object, query = "") {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("Inicia sesión con una cuenta de administración.");
  const res = await fetch(`/api/admin/campaigns${query}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo completar la operación.");
  return json;
}
export default function ClientCampaignsPanel() {
  const [draft,setDraft] = useState<CampaignDraft>(blank);
  const [id,setId] = useState("");
  const draftId = useRef("");
  const [campaigns,setCampaigns] = useState<CampaignRow[]>([]);
  const [capabilities,setCapabilities] = useState({push:false,scheduler:false,preview:false,whatsapp:false});
  const [recipients,setRecipients] = useState<AudienceResult|null>(null);
  const [audience,setAudience] = useState<AudienceResult|null>(null);
  const [search,setSearch] = useState("");
  const [recipientPage,setRecipientPage] = useState(0);
  const [schedule,setSchedule] = useState("");
  const [confirmed,setConfirmed] = useState(false);
  const [busy,setBusy] = useState("");
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [detail,setDetail] = useState<{id:string;rows:any[];total:number;offset:number}|null>(null);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const json = await api(); setCampaigns(json.campaigns || []); setCapabilities(json.capabilities);
  },[]);
  useEffect(() => {
    let active=true;
    load().catch(e=>active&&setError(e.message)).finally(()=>active&&setLoading(false));
    const refresh=()=>{if(!document.hidden) load().catch(()=>{});};
    const timer=window.setInterval(refresh,30000); window.addEventListener("focus",refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[load]);
  useEffect(()=>{
    let active=true;
    const timer=window.setTimeout(()=>{
      api(undefined,`?view=recipients&q=${encodeURIComponent(search)}&offset=${recipientPage*50}`).then(j=>{if(active)setRecipients(j.audience);}).catch(e=>{if(active)setError(e.message);});
    },250);
    return()=>{active=false;window.clearTimeout(timer);};
  },[search,recipientPage]);
  function edit(patch: Partial<CampaignDraft>) { requestVersion.current++;setDraft(d=>({...d,...patch}));setAudience(null);setConfirmed(false);setNotice(""); }
  async function act(key:string,fn:()=>Promise<void>) {setBusy(key);setError("");setNotice("");try{await fn();}catch(e:any){setError(e.message);}finally{setBusy("");}}
  async function save() {
    const campaign=normalizeCampaign(draft);
    if(!draftId.current) draftId.current=id||crypto.randomUUID();
    const result=await api({action:"save",id:draftId.current,campaign});setId(result.id);await load();return result.id;
  }
  async function preview() {const version=requestVersion.current;normalizeCampaign(draft);const result=await api({action:"preview",audience:draft.audience});if(version===requestVersion.current)setAudience(result.audience);}
  async function publish() {
    if(!confirmed||!audience?.eligible)throw new Error("Revisa primero el contenido y los destinatarios.");
    const saved=await save();
    await api({action:"schedule",id:saved,scheduled_at:schedule?new Date(schedule).toISOString():null});
    setDraft(blank());setId("");draftId.current="";setAudience(null);setConfirmed(false);setSchedule("");
    await load();
    if(!schedule) { const result=await api({action:"process",id:saved});setNotice(`Campaña guardada. Procesados ${result.processed} envíos; el resto continúa en la cola.${result.errors?" Hay operaciones pendientes de confirmar.":""}`);await load(); }
    else setNotice("Campaña programada. Los destinatarios quedan fijados; su permiso se vuelve a comprobar al enviar.");
  }
  function openDraft(c:CampaignRow) {draftId.current=c.id;setId(c.id);setDraft({title:c.title,message:c.message,image_url:c.image_url,action_url:c.action_url,expires_at:c.expires_at,channels:c.channels,audience:c.audience});setAudience(null);setConfirmed(false);setSchedule("");requestVersion.current++;}
  async function deliveryDetails(campaignId:string,offset=0) {const j=await api({action:"details",id:campaignId,offset});setDetail({id:campaignId,rows:j.deliveries,total:j.total,offset});}
  let previewImage="";try{previewImage=safeCampaignUrl(draft.image_url,true);}catch{}
  const selected=new Set(draft.audience.client_ids);
  const estimated=audience ? (draft.channels.includes("panel")?audience.eligible:0)+(draft.channels.includes("push")?audience.push_devices:0):0;
  return <div className={styles.shell}>
    <header className={styles.hero}><div><span className={styles.eyebrow}>Comunicación · Tarot Celestial</span><h1>Centro de campañas</h1><p>Una promoción, los clientes adecuados y cada envío bajo control.</p></div><button disabled={!!busy} onClick={()=>void act("refresh",load)}><RefreshCw size={16}/> Actualizar</button></header>
    {error&&<div className={styles.error} role="alert">{error}</div>}{notice&&<div className={styles.success} role="status">{notice}</div>}
    {capabilities.preview&&<div className={styles.notice}>Vista previa: la programación automática funciona en producción. Aquí puedes revisar borradores y procesar una campaña manualmente; un envío manual contactará a clientes reales.</div>}
    <fieldset disabled={!!busy} className={styles.grid} style={{border:0,padding:0,margin:0,minWidth:0}}><div className={styles.form}>
      <section className={styles.card}><h2><span className={styles.step}>01</span>El mensaje</h2><div className={styles.form}>
        <label className={styles.field}>Título<input maxLength={100} value={draft.title} onChange={e=>edit({title:e.target.value})} placeholder="¿Qué quieres comunicar?"/></label>
        <label className={styles.field}>Mensaje<textarea maxLength={1500} rows={5} value={draft.message} onChange={e=>edit({message:e.target.value})} placeholder="Escribe la promoción o novedad…"/></label>
        <div className={styles.row}><label className={styles.field}>Imagen · URL opcional<input value={draft.image_url} onChange={e=>edit({image_url:e.target.value})} placeholder="https://…"/></label><label className={styles.field}>Enlace de destino · opcional<input value={draft.action_url} onChange={e=>edit({action_url:e.target.value})} placeholder="/cliente/precios-ofertas"/></label></div>
        <label className={styles.field}>Caducidad<input type="datetime-local" value={localDate(draft.expires_at)} onChange={e=>edit({expires_at:e.target.value?new Date(e.target.value).toISOString():""})}/></label>
        <p className={styles.muted}>Las fechas se muestran en la zona horaria de tu dispositivo. Al caducar, la promoción deja de estar disponible.</p>
      </div></section>
      <section className={styles.card}><h2><span className={styles.step}>02</span>Destinatarios</h2>
        <label className={styles.field}>Audiencia<select value={draft.audience.mode} onChange={e=>edit({audience:{...draft.audience,mode:e.target.value as any,client_ids:[]}})}><option value="all">Todos los clientes con permiso</option><option value="selected">Seleccionar clientes</option><option value="segment">Crear un segmento</option></select></label>
        <p className={styles.muted}>Se incluyen cuentas web vinculadas y activas que hayan aceptado promociones. Los dispositivos sin suscripción no reciben push.</p>
        {draft.audience.mode==="segment"&&<div className={styles.row}><label className={styles.field}>País<select value={draft.audience.country} onChange={e=>edit({audience:{...draft.audience,country:e.target.value}})}><option value="">Todos los países</option>{recipients?.countries.map(c=><option key={c}>{c}</option>)}</select></label><label className={styles.field}>Sin actividad desde hace · días<input type="number" min={1} max={730} value={draft.audience.inactive_days??""} onChange={e=>edit({audience:{...draft.audience,inactive_days:e.target.value?Number(e.target.value):null}})} placeholder="Sin filtro"/></label></div>}
        {draft.audience.mode==="selected"&&<><label className={styles.field}>Buscar por nombre<input value={search} onChange={e=>{setSearch(e.target.value);setRecipientPage(0);}} placeholder="Nombre del cliente"/></label><p className={styles.muted}>{selected.size} seleccionados</p><div className={styles.list}>{recipients?.sample.map(r=><label key={r.client_id} className={styles.recipient}><input type="checkbox" checked={selected.has(r.client_id)} disabled={!r.eligible||!!busy} onChange={e=>{const ids=new Set(selected);e.target.checked?ids.add(r.client_id):ids.delete(r.client_id);edit({audience:{...draft.audience,client_ids:[...ids]}});}}/><span>{r.full_name||"Sin nombre"}<small>{r.country||"Sin país"} · {r.eligible?`${r.push_devices} dispositivos push`:"Sin permiso para promociones"}</small></span></label>)}</div><div className={styles.buttons}><button disabled={!recipientPage} onClick={()=>setRecipientPage(p=>p-1)}>Anterior</button><span className={styles.muted}>Página {recipientPage+1}</span><button disabled={!recipients||(recipientPage+1)*50>=recipients.search_total} onClick={()=>setRecipientPage(p=>p+1)}>Siguiente</button></div></>}
      </section>
      <section className={styles.card}><h2><span className={styles.step}>03</span>Canales y envío</h2><div className={styles.channels}>
        {([['panel','Panel del cliente'],['push','Notificación móvil']] as const).map(([key,label])=><label key={key} className={styles.channel}><input type="checkbox" checked={draft.channels.includes(key)} onChange={e=>edit({channels:e.target.checked?[...draft.channels,key]:draft.channels.filter(c=>c!==key)})}/><span>{label}<small>{key==='panel'?'En su historial de avisos':'Con permiso del navegador'}</small></span></label>)}
        <label className={styles.channel} data-disabled="true"><input type="checkbox" disabled/><span>WhatsApp<small>Pendiente de conectar API oficial</small></span></label>
      </div><p className={styles.muted}>Vuestro WhatsApp Business actual se conserva. La conexión de campañas con WhatsApp se hará en una segunda fase.</p>
      {draft.channels.includes('push')&&!capabilities.push&&<p className={styles.error}>Push pendiente de configuración VAPID en el servidor. Puedes guardar el borrador o usar solo el panel.</p>}
      <label className={styles.field}>Programar · déjalo vacío para enviar ahora<input type="datetime-local" value={schedule} onChange={e=>{setSchedule(e.target.value);setConfirmed(false);}}/></label>
      <p className={styles.muted}>La cola se revisa cada 5 minutos en producción. Los envíos se procesan por lotes; no se garantiza una hora exacta para toda la audiencia.</p>
      {!capabilities.scheduler&&<p className={styles.notice}>Programación pendiente de configurar CRON_SECRET. El envío manual sigue disponible.</p>}
      </section>
    </div><aside className={styles.aside}>
      <section className={styles.card}><h2><Eye size={18}/> Vista previa</h2><p className={styles.muted}>Esta vista no envía mensajes.</p><div className={styles.preview}>{previewImage&&<img src={previewImage} alt="Imagen de la campaña" referrerPolicy="no-referrer"/>}<div className={styles.previewBody}><span>TAROT CELESTIAL · NOVEDADES</span><h3>{draft.title||"Título de tu campaña"}</h3><p>{draft.message||"El mensaje aparecerá aquí mientras lo escribes."}</p>{draft.action_url&&<span className={styles.link}>Ver promoción →</span>}</div></div>
        <div className={styles.buttons}><button disabled={!!busy} onClick={()=>void act("preview",preview)}><Eye size={15}/> Revisar destinatarios</button><button disabled={!!busy} onClick={()=>void act("save",async()=>{await save();setNotice("Borrador guardado.");})}><Save size={15}/> Guardar borrador</button></div>
        {audience&&<><div className={styles.metrics}><div className={styles.metric}><strong>{audience.eligible}</strong><small>Clientes con permiso</small></div><div className={styles.metric}><strong>{audience.push_devices}</strong><small>Dispositivos push</small></div><div className={styles.metric}><strong>{estimated}</strong><small>Envíos previstos</small></div></div><p className={styles.muted}>{audience.matched-audience.eligible} cuentas excluidas por preferencias. Los permisos se revisan otra vez al enviar.</p>{!estimated&&<p className={styles.notice}>No hay destinatarios disponibles. Los clientes pueden aceptar promociones en su sección Notificaciones.</p>}</>}
        <label className={styles.choice}><input type="checkbox" disabled={!audience||!estimated} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>He revisado el mensaje, los canales y los destinatarios reales.</span></label>
        <div className={styles.buttons} style={{marginTop:16}}><button className={styles.primary} disabled={!!busy||!confirmed||!estimated} onClick={()=>void act("publish",publish)}>{schedule?<CalendarClock size={16}/>:<Send size={16}/>} {busy==='publish'?'Preparando…':schedule?'Programar campaña':'Enviar campaña'}</button>{id&&<button disabled={!!busy} onClick={()=>{setDraft(blank());setId("");draftId.current="";setAudience(null);setConfirmed(false);}}>Nueva campaña</button>}</div>
      </section>
      <section className={styles.card}><h2><BellRing size={18}/> Resultados con contexto</h2><p className={styles.muted}>Panel: aviso guardado en la cuenta. Push: aceptado por el servicio de notificaciones, sin garantía de visualización.</p><p className={styles.muted}>Las aperturas cuentan clientes que abren la página de campaña. Marcar un aviso como leído no cuenta como apertura.</p><p className={styles.muted}>Los envíos sin confirmación no se reintentan para evitar duplicados. Cancelar detiene los pendientes; no retira un push ya enviado.</p></section>
    </aside></fieldset>
    <section className={styles.card}><div className={styles.sectionTop}><h2><Megaphone size={18}/> Campañas recientes</h2><span className={styles.muted}>Últimas 100</span></div>
      {loading?<p className={styles.empty}>Cargando campañas…</p>:!campaigns.length?<div className={styles.empty}>Aún no hay campañas. Prepara la primera y revisa su audiencia antes de enviarla.</div>:<div className={styles.history}>{campaigns.map(c=><article className={styles.historyItem} key={c.id}><div className={styles.historyHeader}><h3>{c.title}</h3><span className={styles.badge}>{CAMPAIGN_STATUS[c.status]}</span></div><p className={styles.muted}>{dateLabel(c.scheduled_at)} · Caduca {dateLabel(c.expires_at)} · {c.channels.map(x=>x==='panel'?'Panel':'Push').join(' + ')}</p><div className={styles.historyStats}>{[['clients','Clientes'],['pending','Pendientes'],['panel_sent','Avisos guardados'],['push_sent','Push aceptados'],['failed','Fallidos'],['skipped','Omitidos'],['uncertain','Sin confirmar'],['opened','Aperturas']].map(([key,label])=><span key={key}><b>{c.results[key]||0}</b> {label}</span>)}</div><div className={styles.buttons}>
        {c.status==='draft'&&<button disabled={!!busy} onClick={()=>openDraft(c)}>Editar borrador</button>}
        <button disabled={!!busy} onClick={()=>void act('details',()=>deliveryDetails(c.id))}>Ver resultados</button>
        {['scheduled','running'].includes(c.status)&&<button disabled={!!busy||Date.parse(c.scheduled_at)>Date.now()} onClick={()=>void act('process',async()=>{const j=await api({action:'process',id:c.id});await load();setNotice(`Procesados ${j.processed} envíos de esta campaña.`);})}>Procesar pendientes</button>}
        {c.results.failed>0&&c.status!=='cancelled'&&Date.parse(c.expires_at)>Date.now()&&<button disabled={!!busy} onClick={()=>void act('retry',async()=>{await api({action:'retry',id:c.id});await load();setNotice('Los rechazos confirmados vuelven a la cola.');})}>Reintentar fallidos</button>}
        {c.status!=='cancelled'&&<button disabled={!!busy} onClick={()=>{if(window.confirm('¿Cancelar los envíos pendientes y retirar la campaña del panel? Los push ya enviados no pueden retirarse.'))void act('cancel',async()=>{await api({action:'cancel',id:c.id});await load();});}}>Cancelar campaña</button>}
      </div>{detail?.id===c.id&&<><div className={styles.tableWrap}><table><thead><tr><th>Cliente</th><th>Canal</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>{detail.rows.map(r=><tr key={r.id}><td>{[r.crm_clientes?.nombre,r.crm_clientes?.apellido].filter(Boolean).join(' ')||'Cuenta eliminada'}</td><td>{r.channel==='panel'?'Panel':'Push'}</td><td>{CAMPAIGN_STATUS[r.state]}{r.opened_at?' · Abierta':''}</td><td>{r.error|| (r.sent_at?dateLabel(r.sent_at):'En espera')}</td></tr>)}</tbody></table></div><div className={styles.buttons}><button disabled={!!busy||!detail.offset} onClick={()=>void act('details',()=>deliveryDetails(c.id,detail.offset-50))}>Anterior</button><span className={styles.muted}>{detail.total} envíos</span><button disabled={!!busy||detail.offset+50>=detail.total} onClick={()=>void act('details',()=>deliveryDetails(c.id,detail.offset+50))}>Siguiente</button><button onClick={()=>setDetail(null)}>Cerrar resultados</button></div></>}</article>)}</div>}
    </section>
  </div>;
}
