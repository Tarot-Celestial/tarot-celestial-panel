"use client";
import {useCallback,useEffect,useState} from "react";
import {supabaseBrowser} from "@/lib/supabase-browser";
import {backgroundFetch} from "@/lib/background-fetch";
const sb=supabaseBrowser();
export type StoreReward={id:string;name:string;description:string;category:string;coin_cost:number;icon_key:string|null;image_url:string|null;featured:boolean;active:boolean;display_order:number;stock:number|null;required_level:number|null};
export type StoreData={worker:{id:string;name:string};balance:number;level:number;rewards:StoreReward[];claims:Array<{id:string;reward_name:string;category:StoreReward["category"];coin_cost:number;status:string;status_note:string|null;reward_image_url:string|null;created_at:string}>};
export function useCentralStore(){const[data,setData]=useState<StoreData|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState("");
 const load=useCallback(async(silent=false)=>{if(!silent)setBusy(true);try{const token=(await sb.auth.getSession()).data.session?.access_token;if(!token)throw new Error("Sesión no disponible");const url=`/api/central/store?t=${Date.now()}`;const init={headers:{Authorization:`Bearer ${token}`},cache:"no-store" as const};const r=silent?await backgroundFetch(url,init,{key:"GET:/api/central/store"}):await fetch(url,init);const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||"No se pudo abrir la Tienda");setData(j);try{const key=`central-store-pending:${j.worker.id}`;const pending=JSON.parse(sessionStorage.getItem(key)||"null");if(pending&&(j.claims||[]).some((c:any)=>c.id===pending.operation_id))sessionStorage.removeItem(key);}catch{}setError("");return true}catch(e:any){if(!silent)setError(e.message);return false}finally{if(!silent)setBusy(false)}},[]);
 useEffect(()=>{void load();const refreshVisible=()=>{if(document.visibilityState==="visible")void load(true)};const timer=window.setInterval(refreshVisible,300000);document.addEventListener("visibilitychange",refreshVisible);window.addEventListener("focus",refreshVisible);const channel=sb.channel("central-store").on("postgres_changes",{event:"*",schema:"public",table:"worker_coin_wallets"},refreshVisible).on("postgres_changes",{event:"*",schema:"public",table:"worker_store_rewards"},refreshVisible).on("postgres_changes",{event:"*",schema:"public",table:"worker_store_claims"},refreshVisible).subscribe();return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",refreshVisible);window.removeEventListener("focus",refreshVisible);void sb.removeChannel(channel)}},[load]);
 const claim=useCallback(async(rewardId:string,operationId:string,expectedCost:number)=>{
  const token=(await sb.auth.getSession()).data.session?.access_token;
  if(!token||!data?.worker.id)throw new Error("Sesión no disponible");
  const key=`central-store-pending:${data.worker.id}`;
  let request={reward_id:rewardId,operation_id:operationId,expected_cost:expectedCost};
  try {const raw=sessionStorage.getItem(key);if(raw){const previous=JSON.parse(raw);if(previous.reward_id!==rewardId)throw new Error("Comprueba primero el canje anterior para evitar otra solicitud.");request=previous;}sessionStorage.setItem(key,JSON.stringify(request));} catch(e){if(e instanceof Error && e.message.startsWith("Comprueba"))throw e;}
  const r=await fetch("/api/central/store",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({op:"claim_reward",...request})});
  const j=await r.json();
  if(!r.ok||!j.ok){
   const messages:Record<string,string>={PRICE_CHANGED:"El precio ha cambiado. Revisa el producto y vuelve a confirmar.",INSUFFICIENT_COINS:"No tienes Coins suficientes.",REWARD_UNAVAILABLE:"La recompensa ya no está disponible.",REWARD_OUT_OF_STOCK:"La recompensa está agotada.",LEVEL_REQUIRED:"Todavía no alcanzas el nivel requerido.",OPERATION_ID_CONFLICT:"La operación necesita revisión."};
   if(messages[j.error]){try{sessionStorage.removeItem(key);}catch{}await load(true);}
   throw new Error(messages[j.error]||"No se pudo confirmar el canje. Reintenta el mismo producto para comprobarlo.");
  }
  try{sessionStorage.removeItem(key);}catch{}
  window.dispatchEvent(new Event("tc-worker-wallet-changed"));
  await load(true);return j.claim;
 },[data?.worker.id,load]);return{data,busy,error,load,claim};}
