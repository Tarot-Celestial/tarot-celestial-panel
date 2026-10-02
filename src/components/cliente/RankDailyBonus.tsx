"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import CrystalEmblem from "@/components/benefits/CrystalEmblem";
import styles from "./RankDailyBonus.module.css";
const sb=supabaseClienteBrowser();
export default function RankDailyBonus() {
  const [state,setState]=useState<any>(null),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[success,setSuccess]=useState(false);
  const load=useCallback(async()=>{
    const token=(await sb.auth.getSession()).data.session?.access_token;
    if(!token){setState(null);return}
    const r=await fetch("/api/cliente/rank-benefits",{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
    const j=await r.json();if(r.ok&&j.ok)setState(j);else setState(null);
  },[]);
  useEffect(()=>{void load().catch(()=>setState(null))},[load]);
  useRouletteSignal(sb,state?.cliente_id,load);
  async function claim(id:string) {
    if(busy)return;
    setBusy(id);setMessage("");setSuccess(false);
    try {
      const token=(await sb.auth.getSession()).data.session?.access_token;
      const r=await fetch("/api/cliente/rank-benefits",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({promotion_id:id})});
      const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error);
      setState((s:any)=>({...s,bonuses:j.bonuses||[]}));
      setSuccess(true);setMessage("Bono recibido. Los beneficios ya están en tu cuenta.");
      window.dispatchEvent(new Event("tc-client-balances-changed"));
    }catch(e:any){setMessage(e.message||"No se pudo confirmar el bono. Puedes reintentar con seguridad.");}
    finally{setBusy("");void load().catch(()=>setState(null));}
  }
  if(!state?.bonuses?.length&&!message)return null;
  return <div className={styles.wrap}>
    {message&&<div role={success?"status":"alert"} className={styles.message} data-success={success}>{success&&<Check size={18}/>} {message}</div>}
    {(state?.bonuses||[]).map((b:any)=><section className={styles.card} key={b.id} aria-labelledby={`bonus-${b.id}`}>
      <div className={styles.art}>{b.image_url?<img src={b.image_url} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<CrystalEmblem size={184} tone={b.authorized_rank}/>}<span className={styles.artCaption}>TAROT CELESTIAL</span></div>
      <div className={styles.content}><span className={styles.eyebrow}>DESBLOQUEADO · RANGO {state.rank?.config?.label||b.authorized_rank}</span><h2 id={`bonus-${b.id}`}>{b.name}</h2><p>{b.description}</p>
        <div className={styles.benefits}>{Number(b.benefit?.coins)>0&&<span><i className={styles.coin}>✦</i><b>+{b.benefit.coins}</b> Coins</span>}{Number(b.benefit?.minutes)>0&&<span><b>+{b.benefit.minutes}</b> minutos FREE</span>}{Number(b.benefit?.oracle_credits)>0&&<span><b>+{b.benefit.oracle_credits}</b> tiradas Oráculo</span>}</div>
        <div className={styles.footer}><button onClick={()=>void claim(b.id)} disabled={!!busy}>{busy===b.id?"Aplicando tu bono…":"Utilizar mi bono"}<ArrowRight size={17}/></button><small>{b.max_uses_per_client===1?"Un uso por día":`${Math.max(0,b.max_uses_per_client-(b.uses_today||0))} uso(s) disponibles hoy`}{!b.active_until_disabled&&b.ends_at?` · Hasta ${new Date(b.ends_at).toLocaleString("es-ES",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}`:""}</small></div>
      </div><span className={styles.corner} aria-hidden="true"/>
    </section>)}
  </div>;
}
