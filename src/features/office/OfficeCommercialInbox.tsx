"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { InstagramThread } from "@/lib/instagram-inbox";
import { officeRequest, OfficeRequestError } from "./office-client";
import { OfficeCaptureThread } from "./OfficeCaptureThread";
import styles from "./OfficeCommercialInbox.module.css";

const Instagram=dynamic(()=>import("@/features/central/CentralInstagramPanel"),{ssr:false});
const WhatsApp=dynamic(()=>import("@/features/central/CentralWhatsAppPanel"),{ssr:false});
type Filter="active"|"open"|"mine"|"resolved"|"returned"|"all";
type Case={opportunity_id:string;state:"open"|"claimed"|"resolved"|"returned";reason:string;opened_at:string;updated_at:string;
  version:number;name:string|null;owner_id:string|null;owner_name:string|null;outcome:string|null;note:string|null;
  channel:"instagram"|"facebook"|"whatsapp"|"meta_form";kind:"message"|"comment"|"form";source_at:string;latest_inbound_at:string;capture_status:string;
  thread_id:string|null;lead_id:string|null;wa_account:string|null;wa_session:string|null;wa_peer:string|null};
type Cursor={at:string;id:string};
type Inbox={items:Case[];actor_id:string;is_admin:boolean;native_access:boolean;central_path:string;next:Cursor|null};
const endpoint="/api/central/comercial";
const channel={instagram:"Instagram",facebook:"Facebook",whatsapp:"WhatsApp",meta_form:"Formulario de Meta"};
const state={open:"Pendiente",claimed:"En atención",resolved:"Resuelto",returned:"Devuelto a Atlas"};
const outcomes:Record<string,string>={answered:"Consulta atendida",appointment:"Reserva acordada",no_interest:"Sin interés",unreachable:"Sin respuesta",other:"Otro resultado",purchased:"Compra registrada",opted_out:"Baja solicitada"};
const reasons:Record<string,string>={human_takeover:"Ya intervino una persona",already_answered:"La conversación ya recibió respuesta",comment_managed:"Comentario atendido anteriormente",
  whatsapp_consent_missing:"Falta autorización para contactar por WhatsApp",lead_managed:"La ficha tiene seguimiento previo",unverified_inbound:"Entrada por verificar",
  unverified_thread:"Identidad del hilo por verificar",source_removed:"Origen retirado",connection_changed:"Cambió la conexión del canal",autonomy_handoff:"Atención humana configurada",new_inbound:"El contacto ha vuelto a escribir",
  needs_personal_response:"La consulta requiere una respuesta personal",window_closed:"Plazo de respuesta cerrado",incomplete_history:"Historial incompleto",conversation_changed:"Hay actividad posterior en el chat",
  inbound_changed:"Hay un mensaje más reciente",recipient_unverified:"Destinatario por verificar",attribution_confirmed:"Vinculación con la ficha confirmada",
  attribution_unmatched:"Vinculación pendiente de verificar",commercial_intervention:"Seguimiento humano en curso",review_needed:"Revisión solicitada"};
const dt=new Intl.DateTimeFormat("es-ES",{timeZone:"Europe/Madrid",dateStyle:"short",timeStyle:"short"});
function elapsed(opened:string) {
  const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(opened))/60000));
  return minutes<60 ? minutes+" min" : minutes<1440 ? Math.floor(minutes/60)+" h" : Math.floor(minutes/1440)+" días";
}
type Props={opportunityId?:string|null;inCentral?:boolean;showSource?:boolean};
export default function OfficeCommercialInbox({opportunityId,inCentral=false,showSource=false}:Props) {
  return <InboxBody key={opportunityId || "all"} opportunityId={opportunityId} inCentral={inCentral} showSource={showSource}/>;
}
function InboxBody({opportunityId,inCentral,showSource}:Props) {
  const [focus,setFocus]=useState(opportunityId || null),[filter,setFilter]=useState<Filter>("active"),[pages,setPages]=useState<(Cursor|null)[]>([null]);
  const [revision,refresh]=useState(0),[result,setResult]=useState<{key:string;data:Inbox}|null>(null),[error,setError]=useState("");
  const cursor=pages.at(-1), query=new URLSearchParams({state:filter});
  if(focus) query.set("id",focus);
  if(cursor){query.set("before",cursor.at);query.set("after",cursor.id);}
  const key=query.toString(), data=result?.key===key ? result.data : null;
  useEffect(()=>{
    const controller=new AbortController();setError("");
    officeRequest<Inbox>(endpoint+"?"+key,{signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setResult({key,data:r});})
      .catch(e=>{if(!controller.signal.aborted){if(e instanceof OfficeRequestError && [401,403].includes(e.status))setResult(null);setError(e instanceof Error?e.message:"No se pudo cargar Comercial.");}});
    return ()=>controller.abort();
  },[key,revision]);
  useEffect(()=>{
    const tick=()=>{if(document.visibilityState==="visible") refresh(n=>n+1);};
    const t=window.setInterval(tick,60_000);window.addEventListener("focus",tick);
    return ()=>{window.clearInterval(t);window.removeEventListener("focus",tick);};
  },[]);
  return <section className={styles.inbox} aria-label="Bandeja de Comercial">
    <header><div><h2>Derivaciones a Comercial</h2><p>Las consultas más antiguas aparecen primero. Horario de Madrid.</p></div><button type="button" onClick={()=>refresh(n=>n+1)}>Actualizar</button></header>
    {focus ? <button type="button" onClick={()=>{setFocus(null);setPages([null]);}}>Ver toda la bandeja</button> :
      <label>Mostrar <select value={filter} onChange={e=>{setFilter(e.target.value as Filter);setPages([null]);}}>
        <option value="active">Pendientes y en atención</option><option value="open">Sin responsable</option><option value="mine">Mis casos en atención</option>
        <option value="resolved">Resueltos</option><option value="returned">Devueltos a Atlas</option><option value="all">Todos</option></select></label>}
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Consultando derivaciones…</p>}
    {data && !data.items.length && <p role="status">{focus?"Esta oportunidad no tiene una derivación en Comercial.":"No hay casos para este filtro."}</p>}
    {data?.items.map(item=><CaseCard key={item.opportunity_id} item={item} data={data} inCentral={!!inCentral}
      showSource={!!showSource && focus===item.opportunity_id} reload={()=>refresh(n=>n+1)}/>)}
    {data && (pages.length>1 || data.next) && <nav aria-label="Páginas de Comercial"><button type="button" disabled={pages.length===1} onClick={()=>setPages(p=>p.slice(0,-1))}>Anterior</button>
      <span>Página {pages.length}</span><button type="button" disabled={!data.next} onClick={()=>data.next && setPages(p=>[...p,data.next])}>Siguiente</button></nav>}
  </section>;
}
function CaseCard({item:v,data,inCentral,showSource,reload}:{item:Case;data:Inbox;inCentral:boolean;showSource:boolean;reload:()=>void}){
  const [note,setNote]=useState(""),[outcome,setOutcome]=useState("answered"),[source,setSource]=useState(showSource),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const pending=useRef<{key:string;id:string}|null>(null), lock=useRef(false);
  const mine=v.owner_id===data.actor_id,canManage=mine||data.is_admin, held=v.state==="claimed", native=data.native_access;
  const social=v.channel==="instagram"||v.channel==="facebook",wa=v.channel==="whatsapp" && v.wa_peer && v.wa_account && v.wa_session;
  const showNative=held && canManage && native && ((social && v.thread_id) || wa);
  async function change(action:"claim"|"release"|"resolve"|"return"){
    if(lock.current)return; lock.current=true;setBusy(true);setError("");setNotice("");
    const body={id:v.opportunity_id,action,version:v.version,outcome:action==="resolve"?outcome:null,note:action==="resolve"?note.trim():null};
    const key=JSON.stringify(body);
    if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
    try{
      await officeRequest(endpoint,{method:"POST",body:JSON.stringify({...body,request_id:pending.current.id})});
      pending.current=null;setNotice({claim:"Caso asignado.",release:"Caso disponible para el equipo.",resolve:"Resultado guardado.",return:"Devuelto a Atlas. Esperará una nueva consulta."}[action]);reload();
    } catch(e){setError(e instanceof Error?e.message:"No se ha podido guardar.");if(e instanceof OfficeRequestError && e.status===409)reload();}
    finally{lock.current=false;setBusy(false);}
  }
  return <article className={styles.case}>
    <header><div><h3>{v.name || "Contacto de "+channel[v.channel]}</h3><p>{channel[v.channel]} · {v.kind==="comment"?"Comentario":v.kind==="form"?"Formulario":"Mensaje privado"}</p></div><span className={styles.state}>{state[v.state]}</span></header>
    <dl><div><dt>Motivo</dt><dd>{reasons[v.reason.toLowerCase()] || "El canal requiere revisión"}{!reasons[v.reason.toLowerCase()] && /^[a-z0-9_]+$/i.test(v.reason) && <small> · {v.reason}</small>}</dd></div>
      <div><dt>Derivado</dt><dd><time dateTime={v.opened_at}>{dt.format(new Date(v.opened_at))}</time>{(held||v.state==="open") && " · hace "+elapsed(v.opened_at)}</dd></div>
      <div><dt>Responsable</dt><dd>{v.owner_name || "Sin asignar"}</dd></div>
      <div><dt>Última entrada</dt><dd><time dateTime={v.latest_inbound_at}>{dt.format(new Date(v.latest_inbound_at))}</time></dd></div>
      {v.outcome && <div><dt>Resultado</dt><dd>{outcomes[v.outcome]||v.outcome}{v.note && <p>{v.note}</p>}</dd></div>}
    </dl>
    {v.state==="open" && <button type="button" disabled={busy} onClick={()=>void change("claim")}>Tomar caso</button>}
    {v.lead_id && native && <a href={data.central_path+"?tab=captacion&lead="+encodeURIComponent(v.lead_id)}>Abrir ficha en Captación</a>}
    {native && social && v.thread_id && !(inCentral && source && showNative) && <OfficeCaptureThread channel={v.channel as "instagram"|"facebook"} id={v.thread_id}/>}
    {showNative && (inCentral ? <button type="button" aria-expanded={source} onClick={()=>setSource(!source)}>{source?"Cerrar conversación":"Abrir conversación"}</button>
      : <a href={data.central_path+"?tab=comercial&caso="+encodeURIComponent(v.opportunity_id)+"&origen=1"}>Abrir conversación en Central</a>)}
    {native && v.channel==="whatsapp" && !wa && <p>Este chat corresponde a otra sesión de WhatsApp.</p>}
    {inCentral && source && showNative && (social && v.thread_id ? <Instagram provider={v.channel as "instagram"|"facebook"} initialThread={{id:v.thread_id,kind:v.kind as InstagramThread["kind"],name:v.name||"",preview:"",updatedAt:v.latest_inbound_at}}/>
      : v.wa_peer && v.wa_account && v.wa_session && <WhatsApp initialContact={{peer:v.wa_peer,account:v.wa_account,session:v.wa_session}}/>)}
    {held && canManage && <details><summary>Registrar resultado</summary><form onSubmit={e=>{e.preventDefault();void change("resolve");}}>
      <label>Resultado<select value={outcome} onChange={e=>setOutcome(e.target.value)}>{Object.entries(outcomes).slice(0,5).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
      <label>Nota de atención<textarea maxLength={600} value={note} required={outcome==="other"} onChange={e=>setNote(e.target.value)}/></label>
      <button disabled={busy} type="submit">Resolver caso</button></form></details>}
    {held && canManage && <button type="button" disabled={busy} onClick={()=>void change("release")}>Liberar para otro operador</button>}
    {canManage && ["claimed","resolved"].includes(v.state) && !["purchased","opted_out","uncertain","dispatching"].includes(v.capture_status) && <details>
      <summary>Devolver a Atlas</summary><p>Atlas podrá atender la próxima entrada cuando el canal lo permita.</p><button type="button" disabled={busy} onClick={()=>void change("return")}>Confirmar devolución a Atlas</button></details>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </article>;
}
