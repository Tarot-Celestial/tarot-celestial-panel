"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, CheckCircle2, Clock3, FolderOpen, Instagram, LayoutDashboard, Link2, Megaphone, PlayCircle, Plus, RefreshCw, Send, Settings2, Sparkles, Trash2, Video } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./SocialChannelAdminPanel.module.css";

type Provider = "instagram" | "tiktok";
type Section = "resumen" | "crear" | "programadas" | "publicaciones" | "promociones" | "biblioteca" | "analitica" | "conexion";

type ContentItem = {
  id:string; provider:Provider; content_type:string; title?:string|null; caption?:string|null; media_urls?:string[]|null;
  scheduled_at?:string|null; status:string; error_message?:string|null; privacy_level?:string|null; publish_mode?:string|null;
  external_post_id?:string|null; external_publish_id?:string|null; created_at:string; published_at?:string|null; campaign_id?:string|null; settings?:Record<string,any>|null;
};
type Campaign = { id:string; name:string; objective?:string|null; status:string; starts_at?:string|null; ends_at?:string|null; notes?:string|null };
type LibraryItem = { id:string; label?:string|null; media_type:string; url:string; thumbnail_url?:string|null; created_at:string };
type Connection = { provider:Provider; username?:string|null; display_name?:string|null; avatar_url?:string|null; token_expires_at?:string|null } | null;

type Props = { provider: Provider };

const sections: Array<{key:Section;label:string;icon:any}> = [
  {key:"resumen",label:"Resumen",icon:LayoutDashboard},
  {key:"crear",label:"Crear",icon:Plus},
  {key:"programadas",label:"Programadas",icon:CalendarClock},
  {key:"publicaciones",label:"Publicaciones",icon:Send},
  {key:"promociones",label:"Promociones",icon:Megaphone},
  {key:"biblioteca",label:"Biblioteca",icon:FolderOpen},
  {key:"analitica",label:"Analítica",icon:Sparkles},
  {key:"conexion",label:"Conexión",icon:Settings2},
];

function toLocalInput(value?:string|null){
  if(!value)return ""; const d=new Date(value); if(!Number.isFinite(d.getTime()))return "";
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function fmt(value?:string|null){if(!value)return "—";const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"}):"—";}
function statusLabel(s:string){return ({draft:"Borrador",scheduled:"Programada",publishing:"Publicando",processing:"Procesando",published:"Publicada",failed:"Error",sent_to_inbox:"Enviada a TikTok"} as any)[s]||s;}

export default function SocialChannelAdminPanel({provider}:Props){
  const searchParams = useSearchParams();
  const [section,setSection]=useState<Section>("resumen");
  const [items,setItems]=useState<ContentItem[]>([]);
  const [campaigns,setCampaigns]=useState<Campaign[]>([]);
  const [library,setLibrary]=useState<LibraryItem[]>([]);
  const [connection,setConnection]=useState<Connection>(null);
  const [configured,setConfigured]=useState(false);
  const [analytics,setAnalytics]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  const [draft,setDraft]=useState<any>({id:"",content_type:provider==="instagram"?"post":"video",title:"",caption:"",media:"",scheduled_at:"",campaign_id:"",privacy_level:"SELF_ONLY",publish_mode:"direct",share_to_feed:true,disable_comment:false,disable_duet:false,disable_stitch:false,is_aigc:false});
  const [campaignDraft,setCampaignDraft]=useState<any>({name:"",objective:"",status:"active",starts_at:"",ends_at:"",notes:""});
  const [libraryDraft,setLibraryDraft]=useState<any>({label:"",media_type:"image",url:""});

  const brand=provider==="instagram"?{name:"Instagram",Icon:Instagram,tag:"Contenido, Reels y Stories"}:{name:"TikTok",Icon:Video,tag:"Vídeos, fotos y programación"};

  const accessToken=useCallback(async()=>{const {data}=await supabaseBrowser().auth.getSession();const t=data.session?.access_token;if(!t)throw new Error("Sesión de administrador no disponible");return t;},[]);
  const api=useCallback(async(path:string,init?:RequestInit)=>{const t=await accessToken();const res=await fetch(path,{...init,headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json",...(init?.headers||{})},cache:"no-store"});const json=await res.json().catch(()=>({}));if(!res.ok||json?.ok===false)throw new Error(json?.error||"Error de servidor");return json;},[accessToken]);

  const load=useCallback(async()=>{
    setLoading(true);
    try {
      // La conexión OAuth se carga de forma independiente. Un fallo en biblioteca,
      // campañas o analítica no puede hacer que una cuenta conectada aparezca como desconectada.
      const status = await api(`/api/admin/social-connections/status?t=${Date.now()}`);
      setConnection(status.connections?.[provider]||null);
      setConfigured(Boolean(status.configured?.[provider]));

      const results = await Promise.allSettled([
        api(`/api/admin/social-content?provider=${provider}&t=${Date.now()}`),
        api(`/api/admin/social-campaigns?provider=${provider}&t=${Date.now()}`),
        api(`/api/admin/social-library?provider=${provider}&t=${Date.now()}`),
        api(`/api/admin/social-analytics?provider=${provider}&t=${Date.now()}`),
      ]);
      const [c,p,l,a] = results;
      if (c.status === "fulfilled") setItems(c.value.items||[]);
      if (p.status === "fulfilled") setCampaigns(p.value.items||[]);
      if (l.status === "fulfilled") setLibrary(l.value.items||[]);
      if (a.status === "fulfilled") setAnalytics(a.value);

      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) setError(failed.reason?.message || "Algún módulo social no pudo cargar sus datos");
    } catch(e:any) {
      setError(e?.message||"No se pudo cargar el estado de conexión");
    } finally {
      setLoading(false);
    }
  },[api,provider]);
  useEffect(()=>{void load();},[load]);

  useEffect(()=>{
    const connected = searchParams?.get("social_connected");
    const oauthError = searchParams?.get("social_error");
    if (oauthError) {
      setError(oauthError);
      setMessage("");
      setSection("conexion");
    }
    if (connected === provider) {
      setMessage(`${brand.name} autorizado por OAuth. Comprobando conexión guardada…`);
      setError("");
      setSection("conexion");
      const verify = async()=>{
        try {
          const status = await api(`/api/admin/social-connections/status?t=${Date.now()}`);
          const current = status.connections?.[provider] || null;
          setConnection(current);
          setConfigured(Boolean(status.configured?.[provider]));
          if (current) {
            setError("");
            setMessage(`${brand.name} conectado correctamente.`);
          } else {
            const storage = status.storage || {};
            const recovery = status.recovery || {};
            const build = status.build ? ` · build ${status.build}` : "";
            const detail = recovery.error
              ? ` Recuperación: ${recovery.error}${build}`
              : storage.error
                ? ` Supabase: ${storage.error}${build}`
                : ` Tabla: ${storage.table || "tc_social_connections"} · filas: ${storage.rows ?? "?"} · proyecto: ${storage.project_ref || "?"}${build}.`;
            setError(`${brand.name} autorizó los permisos, pero la conexión no aparece en el panel.${detail}`);
          }
        } catch(e:any) {
          setError(e?.message || "No se pudo verificar la conexión después del OAuth");
        }
      };
      const timers = [250, 1000, 2500, 5000].map((ms)=>window.setTimeout(()=>void verify(),ms));
      return ()=>{timers.forEach((timer)=>window.clearTimeout(timer));};
    }
  },[searchParams,provider,api,brand.name]);
  useEffect(()=>{setDraft((v:any)=>({...v,id:"",content_type:provider==="instagram"?"post":"video",privacy_level:"SELF_ONLY",publish_mode:"direct"}));},[provider]);

  const scheduled=useMemo(()=>items.filter(x=>x.status==="scheduled"),[items]);
  const published=useMemo(()=>items.filter(x=>["published","processing","sent_to_inbox","failed"].includes(x.status)),[items]);
  const activeCampaigns=useMemo(()=>campaigns.filter(x=>x.status==="active").length,[campaigns]);

  function editContent(item:ContentItem){setDraft({id:item.id,content_type:item.content_type,title:item.title||"",caption:item.caption||"",media:(item.media_urls||[]).join("\n"),scheduled_at:toLocalInput(item.scheduled_at),campaign_id:item.campaign_id||"",privacy_level:item.privacy_level||"SELF_ONLY",publish_mode:item.publish_mode||"direct",share_to_feed:item.settings?.share_to_feed!==false,disable_comment:Boolean(item.settings?.disable_comment),disable_duet:Boolean(item.settings?.disable_duet),disable_stitch:Boolean(item.settings?.disable_stitch),is_aigc:Boolean(item.settings?.is_aigc)});setSection("crear");}
  async function saveContent(publishNow=false){setBusy("save-content");setError("");setMessage("");try{const body={...draft,provider,media_urls:String(draft.media||"").split(/\n|,/).map((v:string)=>v.trim()).filter(Boolean),scheduled_at:draft.scheduled_at||null,settings:{share_to_feed:Boolean(draft.share_to_feed),disable_comment:Boolean(draft.disable_comment),disable_duet:Boolean(draft.disable_duet),disable_stitch:Boolean(draft.disable_stitch),is_aigc:Boolean(draft.is_aigc),brand_organic_toggle:true}};const saved=await api("/api/admin/social-content",{method:"POST",body:JSON.stringify(body)});if(publishNow&&saved.item?.id){await api("/api/admin/social-publish",{method:"POST",body:JSON.stringify({id:saved.item.id})});setMessage("Contenido enviado a publicación.");}else setMessage(draft.scheduled_at?"Publicación programada.":"Borrador guardado.");setDraft({id:"",content_type:provider==="instagram"?"post":"video",title:"",caption:"",media:"",scheduled_at:"",campaign_id:"",privacy_level:"SELF_ONLY",publish_mode:"direct",share_to_feed:true,disable_comment:false,disable_duet:false,disable_stitch:false,is_aigc:false});await load();}catch(e:any){setError(e?.message||"No se pudo guardar");}finally{setBusy("");}}
  async function removeContent(id:string){if(!confirm("¿Eliminar este contenido?"))return;setBusy(id);try{await api("/api/admin/social-content",{method:"POST",body:JSON.stringify({action:"delete",id})});await load();}catch(e:any){setError(e?.message||"No se pudo eliminar");}finally{setBusy("");}}
  async function publish(id:string,action="publish"){setBusy(id);setError("");try{await api("/api/admin/social-publish",{method:"POST",body:JSON.stringify({id,action})});setMessage(action==="refresh-status"?"Estado actualizado.":"Publicación enviada.");await load();}catch(e:any){setError(e?.message||"No se pudo publicar");}finally{setBusy("");}}
  async function saveCampaign(){setBusy("campaign");try{await api("/api/admin/social-campaigns",{method:"POST",body:JSON.stringify({...campaignDraft,provider})});setCampaignDraft({name:"",objective:"",status:"active",starts_at:"",ends_at:"",notes:""});setMessage("Promoción guardada.");await load();}catch(e:any){setError(e?.message||"No se pudo guardar la promoción");}finally{setBusy("");}}
  async function removeCampaign(id:string){if(!confirm("¿Eliminar esta promoción?"))return;setBusy(id);try{await api("/api/admin/social-campaigns",{method:"POST",body:JSON.stringify({action:"delete",id})});await load();}catch(e:any){setError(e?.message||"No se pudo eliminar");}finally{setBusy("");}}
  async function saveLibrary(){setBusy("library");try{await api("/api/admin/social-library",{method:"POST",body:JSON.stringify({...libraryDraft,provider})});setLibraryDraft({label:"",media_type:"image",url:""});setMessage("Recurso añadido a la biblioteca.");await load();}catch(e:any){setError(e?.message||"No se pudo guardar");}finally{setBusy("");}}

  async function connect(){setBusy("connect");try{const r=await api("/api/admin/social-connections/connect",{method:"POST",body:JSON.stringify({provider})});if(r.auth_url)window.location.assign(r.auth_url);}catch(e:any){setError(e?.message||"No se pudo iniciar OAuth");setBusy("");}}
  async function disconnect(){if(!confirm(`¿Desconectar ${brand.name}?`))return;setBusy("disconnect");try{await api("/api/admin/social-connections/disconnect",{method:"POST",body:JSON.stringify({provider})});await load();}catch(e:any){setError(e?.message||"No se pudo desconectar");}finally{setBusy("");}}

  const ContentTable=({rows}:{rows:ContentItem[]})=><div className={styles.tableWrap}><table><thead><tr><th>Contenido</th><th>Tipo</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody>{rows.length?rows.map(item=><tr key={item.id}><td><b>{item.title||item.caption?.slice(0,54)||"Sin título"}</b>{item.error_message&&<small className={styles.errorText}>{item.error_message}</small>}</td><td>{item.content_type}</td><td><span className={`${styles.status} ${styles[`status_${item.status}`]||""}`}>{statusLabel(item.status)}</span></td><td>{fmt(item.scheduled_at||item.published_at||item.created_at)}</td><td><div className={styles.rowActions}><button onClick={()=>editContent(item)}>Editar</button>{!["published","processing","sent_to_inbox"].includes(item.status)&&<button className={styles.primaryTiny} disabled={busy===item.id} onClick={()=>publish(item.id)}><PlayCircle size={13}/>Publicar</button>}{provider==="tiktok"&&item.external_publish_id&&<button disabled={busy===item.id} onClick={()=>publish(item.id,"refresh-status")}>Estado</button>}<button className={styles.dangerTiny} disabled={busy===item.id} onClick={()=>removeContent(item.id)}><Trash2 size={13}/></button></div></td></tr>):<tr><td colSpan={5} className={styles.empty}>Todavía no hay contenido en esta sección.</td></tr>}</tbody></table></div>;

  const Icon=brand.Icon;
  return <div className={styles.page}>
    <section className={`${styles.hero} ${styles[provider]}`}><div className={styles.heroIcon}><Icon size={28}/></div><div><div className={styles.eyebrow}>REDES SOCIALES · TAROT CELESTIAL</div><h2>{brand.name}</h2><p>{brand.tag}. Gestión propia y adaptada a Tarot Celestial.</p></div><div className={`${styles.connectionBadge} ${connection?styles.connected:""}`}><span/>{connection?`@${connection.username||connection.display_name||"conectada"}`:"Sin conectar"}</div></section>

    <div className={styles.sectionNav}>{sections.map(({key,label,icon:NavIcon})=><button key={key} className={section===key?styles.sectionActive:""} onClick={()=>setSection(key)}><NavIcon size={15}/>{label}</button>)}</div>
    {(message||error)&&<div className={`${styles.notice} ${error?styles.noticeError:styles.noticeOk}`}>{error||message}</div>}

    {section==="resumen"&&<div className={styles.stack}><div className={styles.metrics}><article><span>Cuenta</span><strong>{connection?"Conectada":"Pendiente"}</strong><small>{configured?"Credenciales listas":"Faltan variables"}</small></article><article><span>Programadas</span><strong>{scheduled.length}</strong><small>pendientes de publicar</small></article><article><span>Publicadas</span><strong>{analytics?.totals?.published||0}</strong><small>registradas</small></article><article><span>Promociones</span><strong>{activeCampaigns}</strong><small>activas</small></article></div><div className={styles.twoCols}><section className={styles.card}><h3><Clock3 size={18}/> Próximas publicaciones</h3><ContentTable rows={scheduled.slice(0,5)}/></section><section className={styles.card}><h3><Sparkles size={18}/> Flujo de trabajo</h3><div className={styles.flow}><div><b>1</b><span>Crear contenido</span></div><div><b>2</b><span>Guardar o programar</span></div><div><b>3</b><span>Publicación server-side</span></div><div><b>4</b><span>Historial y estado real</span></div></div></section></div></div>}

    {section==="crear"&&<section className={styles.card}><div className={styles.cardTitle}><div><h3>Centro de contenido</h3><p>Crea una publicación, Reel/Story o vídeo y decide si sale ahora o queda programada.</p></div><span className={styles.pill}>{provider.toUpperCase()}</span></div><div className={styles.formGrid}><label>Tipo<select value={draft.content_type} onChange={e=>setDraft({...draft,content_type:e.target.value})}>{provider==="instagram"?<><option value="post">Publicación</option><option value="reel">Reel</option><option value="story">Story</option><option value="carousel">Carrusel</option></>:<><option value="video">Vídeo</option><option value="photo">Fotos</option></>}</select></label><label>Promoción<select value={draft.campaign_id} onChange={e=>setDraft({...draft,campaign_id:e.target.value})}><option value="">Sin promoción</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className={styles.full}>Título interno<input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="Ej. Promo último día"/></label><label className={styles.full}>Texto / caption<textarea rows={5} value={draft.caption} onChange={e=>setDraft({...draft,caption:e.target.value})} placeholder="Texto que acompañará la publicación…"/></label><label className={styles.full}>URLs públicas de imagen/vídeo<textarea rows={3} value={draft.media} onChange={e=>setDraft({...draft,media:e.target.value})} placeholder="Una URL por línea. Para carrusel/fotos puedes añadir varias."/><small>Meta y TikTok deben poder descargar el recurso desde Internet.</small></label><label>Programar para<input type="datetime-local" value={draft.scheduled_at} onChange={e=>setDraft({...draft,scheduled_at:e.target.value})}/></label>{provider==="tiktok"&&<><label>Modo<select value={draft.publish_mode} onChange={e=>setDraft({...draft,publish_mode:e.target.value})}><option value="direct">Publicación directa</option><option value="inbox">Enviar a bandeja TikTok</option></select></label><label>Privacidad<select value={draft.privacy_level} onChange={e=>setDraft({...draft,privacy_level:e.target.value})}><option value="SELF_ONLY">Solo yo / pruebas</option><option value="PUBLIC_TO_EVERYONE">Público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos mutuos</option><option value="FOLLOWER_OF_CREATOR">Seguidores</option></select></label></>}{provider==="instagram"&&<label className={styles.checkLabel}><input type="checkbox" checked={draft.share_to_feed} onChange={e=>setDraft({...draft,share_to_feed:e.target.checked})}/> Mostrar Reel también en el feed</label>}{provider==="tiktok"&&<div className={styles.checkGroup}><label><input type="checkbox" checked={draft.disable_comment} onChange={e=>setDraft({...draft,disable_comment:e.target.checked})}/> Desactivar comentarios</label><label><input type="checkbox" checked={draft.disable_duet} onChange={e=>setDraft({...draft,disable_duet:e.target.checked})}/> Desactivar duetos</label><label><input type="checkbox" checked={draft.disable_stitch} onChange={e=>setDraft({...draft,disable_stitch:e.target.checked})}/> Desactivar stitch</label><label><input type="checkbox" checked={draft.is_aigc} onChange={e=>setDraft({...draft,is_aigc:e.target.checked})}/> Contenido generado con IA</label></div>}</div><div className={styles.actions}><button className={styles.secondary} disabled={busy==="save-content"} onClick={()=>void saveContent(false)}>{draft.scheduled_at?<CalendarClock size={16}/>:<FolderOpen size={16}/>} {draft.scheduled_at?"Guardar y programar":"Guardar borrador"}</button><button className={styles.primary} disabled={busy==="save-content"||!connection} onClick={()=>void saveContent(true)}><Send size={16}/> Publicar ahora</button></div></section>}

    {section==="programadas"&&<section className={styles.card}><div className={styles.cardTitle}><div><h3>Calendario y programadas</h3><p>Todo lo que saldrá automáticamente mediante el worker.</p></div><button className={styles.secondary} onClick={()=>setSection("crear")}><Plus size={15}/>Nueva</button></div><ContentTable rows={scheduled}/></section>}
    {section==="publicaciones"&&<section className={styles.card}><div className={styles.cardTitle}><div><h3>Historial de publicaciones</h3><p>Publicadas, procesando, enviadas a bandeja y errores reales de API.</p></div><button className={styles.secondary} onClick={()=>void load()}><RefreshCw size={15}/>Actualizar</button></div><ContentTable rows={published}/></section>}

    {section==="promociones"&&<div className={styles.twoCols}><section className={styles.card}><h3><Megaphone size={18}/> Crear promoción</h3><div className={styles.formStack}><label>Nombre<input value={campaignDraft.name} onChange={e=>setCampaignDraft({...campaignDraft,name:e.target.value})} placeholder="Ej. Super Ruleta - Último día"/></label><label>Objetivo<input value={campaignDraft.objective} onChange={e=>setCampaignDraft({...campaignDraft,objective:e.target.value})} placeholder="Ventas, alcance, captación…"/></label><div className={styles.formGrid}><label>Inicio<input type="datetime-local" value={campaignDraft.starts_at} onChange={e=>setCampaignDraft({...campaignDraft,starts_at:e.target.value})}/></label><label>Fin<input type="datetime-local" value={campaignDraft.ends_at} onChange={e=>setCampaignDraft({...campaignDraft,ends_at:e.target.value})}/></label></div><label>Notas<textarea rows={4} value={campaignDraft.notes} onChange={e=>setCampaignDraft({...campaignDraft,notes:e.target.value})}/></label><button className={styles.primary} disabled={busy==="campaign"||!campaignDraft.name.trim()} onClick={()=>void saveCampaign()}><Plus size={16}/>Guardar promoción</button></div></section><section className={styles.card}><h3>Promociones creadas</h3><div className={styles.campaignList}>{campaigns.length?campaigns.map(c=><article key={c.id}><div><strong>{c.name}</strong><span>{c.objective||"Sin objetivo"}</span><small>{fmt(c.starts_at)} → {fmt(c.ends_at)}</small></div><button onClick={()=>void removeCampaign(c.id)}><Trash2 size={14}/></button></article>):<div className={styles.empty}>Todavía no hay promociones.</div>}</div></section></div>}

    {section==="biblioteca"&&<div className={styles.stack}><section className={styles.card}><div className={styles.cardTitle}><div><h3>Biblioteca multimedia</h3><p>Guarda URLs de imágenes y vídeos ya alojados para reutilizarlos en publicaciones.</p></div></div><div className={styles.libraryForm}><input value={libraryDraft.label} onChange={e=>setLibraryDraft({...libraryDraft,label:e.target.value})} placeholder="Nombre del recurso"/><select value={libraryDraft.media_type} onChange={e=>setLibraryDraft({...libraryDraft,media_type:e.target.value})}><option value="image">Imagen</option><option value="video">Vídeo</option></select><input value={libraryDraft.url} onChange={e=>setLibraryDraft({...libraryDraft,url:e.target.value})} placeholder="https://…"/><button className={styles.primary} disabled={busy==="library"||!libraryDraft.url.trim()} onClick={()=>void saveLibrary()}><Plus size={15}/>Añadir</button></div></section><div className={styles.libraryGrid}>{library.map(x=><article key={x.id} className={styles.mediaCard}>{x.media_type==="image"?<img src={x.thumbnail_url||x.url} alt=""/>:<div className={styles.videoThumb}><Video size={28}/></div>}<div><strong>{x.label||"Recurso"}</strong><span>{x.media_type}</span><button onClick={()=>{setDraft((v:any)=>({...v,media:v.media?`${v.media}\n${x.url}`:x.url}));setSection("crear");}}>Usar en contenido</button></div></article>)}</div></div>}

    {section==="analitica"&&<div className={styles.stack}><div className={styles.metrics}><article><span>Total contenido</span><strong>{analytics?.totals?.content||0}</strong><small>registrado</small></article><article><span>Publicadas</span><strong>{analytics?.totals?.published||0}</strong><small>confirmadas</small></article><article><span>Programadas</span><strong>{analytics?.totals?.scheduled||0}</strong><small>pendientes</small></article><article><span>Errores</span><strong>{analytics?.totals?.failed||0}</strong><small>requieren revisión</small></article></div><section className={styles.card}><h3>Distribución por formato</h3><div className={styles.barList}>{Object.entries(analytics?.byType||{}).map(([k,v]:any)=><div key={k}><span>{k}</span><b>{v}</b><i style={{width:`${Math.min(100,(Number(v)/(analytics?.totals?.content||1))*100)}%`}}/></div>)}</div><p className={styles.muted}>Esta analítica refleja datos reales del gestor interno. Las métricas nativas de alcance/engagement podrán ampliarse cuando estén aprobados los permisos de insights de cada plataforma.</p></section></div>}

    {section==="conexion"&&<section className={styles.card}><div className={styles.connectionPanel}><div className={styles.connectionIcon}><Icon size={32}/></div><div><h3>Conexión oficial de {brand.name}</h3><p>OAuth propio de Tarot Celestial. Las credenciales y tokens se guardan cifrados en servidor y nunca se exponen al navegador.</p></div><span className={`${styles.bigState} ${connection?styles.connected:""}`}>{connection?"CONECTADO":"SIN CONECTAR"}</span></div><div className={styles.connectionRows}><div><span>Variables de entorno</span><b>{configured?"Configuradas":"Pendientes"}</b></div><div><span>Cuenta</span><b>{connection?`@${connection.username||connection.display_name||"autorizada"}`:"—"}</b></div><div><span>Token</span><b>{connection?.token_expires_at?`Caduca ${fmt(connection.token_expires_at)}`:"—"}</b></div></div><div className={styles.actions}>{connection?<><button className={styles.secondary} onClick={()=>void connect()} disabled={busy==="connect"}><RefreshCw size={16}/>Reconectar</button><button className={styles.danger} onClick={()=>void disconnect()} disabled={busy==="disconnect"}>Desconectar</button></>:<button className={styles.primary} onClick={()=>void connect()} disabled={!configured||busy==="connect"}><Link2 size={16}/>Conectar {brand.name}</button>}</div></section>}
    {loading&&<div className={styles.loading}><RefreshCw className={styles.spin} size={18}/>Actualizando datos…</div>}
  </div>;
}
