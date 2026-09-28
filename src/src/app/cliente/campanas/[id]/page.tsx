"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { safeCampaignUrl } from "@/lib/campaigns";
import styles from "@/components/cliente/Campaigns.module.css";
function CampaignView({id}:{id:string}) {
  const search=useSearchParams();const delivery=search.get('delivery');
  const [campaign,setCampaign]=useState<any>(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;let track:(()=>void)|undefined;setCampaign(null);setError('');
    (async()=>{
      const {data}=await supabaseClienteBrowser().auth.getSession();
      if(!data.session)throw new Error('Inicia sesión con tu cuenta de cliente para ver esta promoción.');
      const headers={Authorization:`Bearer ${data.session.access_token}`};
      const url=`/api/cliente/campaigns/${encodeURIComponent(id)}${delivery?'?delivery='+encodeURIComponent(delivery):''}`;
      const res=await fetch(url,{headers,cache:'no-store'});const json=await res.json();
      if(!res.ok||!json.ok)throw new Error(json.error);
      if(!active)return;
      setCampaign(json.campaign);
      let recorded=false;
      track=()=>{if(!active||document.hidden||recorded)return;recorded=true;fetch(url,{method:'POST',headers}).then(r=>{if(r.ok)window.dispatchEvent(new Event('tc-client-notifications-change'));else recorded=false;}).catch(()=>{recorded=false;});};
      track();document.addEventListener('visibilitychange',track);
    })().catch(e=>active&&setError(e.message));
    return()=>{active=false;if(track)document.removeEventListener('visibilitychange',track);};
  },[id,delivery]);
  // Recheck expiry while the page stays open; never leave an expired CTA active.
  const [now,setNow]=useState(Date.now());useEffect(()=>{const t=window.setInterval(()=>setNow(Date.now()),15000);return()=>window.clearInterval(t);},[]);
  const expired=campaign&&Date.parse(campaign.expires_at)<=now;
  let image='',href='';try{image=safeCampaignUrl(campaign?.image_url,true);href=safeCampaignUrl(campaign?.action_url);}catch{}
  return <ClienteLayout title="Promociones" subtitle="Novedades para tu cuenta" summaryItems={[]}><article className={styles.campaign}>
    {error||expired?<div className={styles.body}><h1>Promoción no disponible</h1><p role="alert">{error||'Esta promoción ha caducado.'}</p><Link className={styles.back} href="/cliente/login">Acceder a mi cuenta</Link><Link className={styles.back} href="/cliente/notificaciones">Volver a notificaciones</Link></div>:campaign?<>
      {image&&<img src={image} alt="" referrerPolicy="no-referrer"/>}<div className={styles.body}><span className={styles.eyebrow}>Tarot Celestial · Para ti</span><h1>{campaign.title}</h1><p>{campaign.message}</p><small>Disponible hasta {new Date(campaign.expires_at).toLocaleString('es-ES')}</small>{href&&<a className={styles.link} href={href} rel="noopener noreferrer">Ver promoción →</a>}<Link href="/cliente/notificaciones" className={styles.back}>Notificaciones y preferencias de promociones</Link></div>
    </>:<div className={styles.body}><p>Cargando promoción…</p></div>}
  </article></ClienteLayout>;
}
export default function CampaignPage({params}:{params:{id:string}}){return <Suspense fallback={<p>Cargando promoción…</p>}><CampaignView id={params.id}/></Suspense>;}
