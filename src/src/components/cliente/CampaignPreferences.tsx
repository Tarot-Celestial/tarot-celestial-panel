"use client";
import { useEffect, useState } from "react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./Campaigns.module.css";

export default function CampaignPreferences() {
  const [enabled,setEnabled]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [supported,setSupported]=useState(false);
  const [deviceEnabled,setDeviceEnabled]=useState(false);
  const [permission,setPermission]=useState<NotificationPermission>("default");
  async function headers(){const {data}=await supabaseClienteBrowser().auth.getSession();if(!data.session)throw new Error("Inicia sesión para cambiar tus preferencias.");return {Authorization:`Bearer ${data.session.access_token}`,"Content-Type":"application/json"};}
  useEffect(()=>{
    let active=true;
    headers().then(h=>fetch('/api/cliente/campaign-preferences',{headers:h,cache:'no-store'})).then(r=>r.json()).then(j=>{if(!j.ok)throw new Error(j.error);if(active)setEnabled(j.enabled);}).catch(e=>active&&setError(e.message));
    const available='Notification' in window&&'serviceWorker' in navigator&&'PushManager' in window;
    setSupported(available);
    if(available){setPermission(Notification.permission);navigator.serviceWorker.getRegistration('/').then(r=>r?.pushManager.getSubscription()).then(s=>active&&setDeviceEnabled(Boolean(s))).catch(()=>{});}
    return()=>{active=false;};
  },[]);
  async function preference(value:boolean){setBusy(true);setError('');setMessage('');try{
    const res=await fetch('/api/cliente/campaign-preferences',{method:'POST',headers:await headers(),body:JSON.stringify({enabled:value})});const j=await res.json();if(!res.ok||!j.ok)throw new Error(j.error);setEnabled(j.enabled);setMessage(value?'Recibirás promociones en tu panel y, si lo activas, en este dispositivo.':'Has desactivado las promociones. Los avisos de tu cuenta siguen disponibles.');
  }catch(e:any){setError(e.message);}finally{setBusy(false);}}
  async function enableDevice(){setBusy(true);setError('');setMessage('');try{
    const key=process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if(!key)throw new Error('Las notificaciones móviles aún no están configuradas.');
    const grant=await Notification.requestPermission();setPermission(grant);
    if(grant!=='granted')throw new Error('Activa las notificaciones en los ajustes del navegador para continuar.');
    await navigator.serviceWorker.register('/sw.js');
    const registration=await navigator.serviceWorker.ready;
    const base64=key.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(key.length/4)*4,'=');
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
    const response=await fetch('/api/cliente/push/register',{method:'POST',headers:await headers(),body:JSON.stringify(subscription)});
    const json=await response.json();if(!response.ok||!json.ok)throw new Error(json.error);
    setDeviceEnabled(true);setMessage('Dispositivo registrado. Las promociones solo se enviarán si has activado la opción de recibirlas.');
  }catch(e:any){setError(e.message);}finally{setBusy(false);}}
  return <section className={styles.preferences} aria-labelledby="campaign-preferences-heading"><div><span className={styles.eyebrow}>Tú eliges</span><h2 id="campaign-preferences-heading">Promociones y novedades</h2><p>Elige si quieres recibir campañas de Tarot Celestial. Puedes darte de baja en cualquier momento.</p></div>
    <label className={styles.choice}><input type="checkbox" checked={enabled===true} disabled={enabled===null||busy} onChange={e=>void preference(e.target.checked)}/><span>Quiero recibir promociones en mi panel y en los dispositivos donde active las notificaciones.</span></label>
    <div className={styles.actions}><button type="button" disabled={busy||!supported||permission==='denied'} onClick={()=>void enableDevice()}>{deviceEnabled?'Actualizar registro de este dispositivo':'Activar avisos en este dispositivo'}</button><span>{deviceEnabled?'Dispositivo suscrito':permission==='denied'?'Permiso bloqueado en el navegador':!supported?'Notificaciones no disponibles en este navegador':''}</span></div>
    <p>En iPhone, añade la web a la pantalla de inicio y ábrela desde su icono para activar los avisos. Desactivar promociones no elimina los avisos de compras y reservas.</p>
    {message&&<div role="status" className={styles.message}>{message}</div>}{error&&<div role="alert" className={styles.error}>{error}</div>}
  </section>;
}
