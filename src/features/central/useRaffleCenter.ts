"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {supabaseBrowser} from "@/lib/supabase-browser";
import type {RaffleCenterState,CenterEntry} from "./raffle-center";

export function useRaffleCenter(raffleId:string, locked:React.MutableRefObject<boolean>, busy:boolean){
 const [data,setData]=useState<RaffleCenterState|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[live,setLive]=useState(false);
 const alive=useRef(true), running=useRef(false), pending=useRef(false), epoch=useRef(0);
 const controllers=useRef(new Set<AbortController>());
 const deferred=useRef<ReturnType<typeof setTimeout>|null>(null);
 const request=useCallback(async(action?:string,values:Record<string,unknown>={})=>{
  const c=new AbortController();controllers.current.add(c);
  const timeout=setTimeout(()=>c.abort(),20000);
  try{
   const token=(await supabaseBrowser().auth.getSession()).data.session?.access_token;
   if(!token) throw new Error("Vuelve a iniciar sesión.");
   const response=await fetch(action?"/api/central/raffle/prizes":`/api/central/raffle/prizes?raffle_id=${raffleId}`,{
    method:action?"POST":"GET",cache:"no-store",signal:c.signal,
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    ...(action?{body:JSON.stringify({...values,action,raffle_id:raffleId})}:{})
   });
   const json=await response.json();
   if(!response.ok||!json.ok) throw new Error(json.error||"No se pudo cargar el centro de ganadores.");
   return json as RaffleCenterState&{spinEntries?:CenterEntry[]};
  }finally{clearTimeout(timeout);controllers.current.delete(c);}
 },[raffleId]);
 const refresh=useCallback(async():Promise<void>=>{
  if(!alive.current) return;
  if(locked.current||running.current||document.visibilityState!=="visible"){pending.current=true;return;}
  running.current=true;pending.current=false;const generation=epoch.current;
  try{
   const result=await request();
   if(alive.current&&generation===epoch.current){setData(result);setError("");}
  }catch(e){if(alive.current&&generation===epoch.current)setError(e instanceof Error?e.message:"No se pudo actualizar.");}
  finally{
   running.current=false;
   if(alive.current)setLoading(false);
   if(alive.current&&pending.current&&!locked.current&&document.visibilityState==="visible"){
    if(deferred.current)clearTimeout(deferred.current);
    deferred.current=setTimeout(()=>{deferred.current=null;void refresh();},350);
   }
  }
 },[locked,request]);
 const mutate=useCallback(async(action:string,values:Record<string,unknown>)=>{
  epoch.current++;setError("");
  const result=await request(action,values);
  if(alive.current){setData(result);setLoading(false);}
  return result;
 },[request]);
 useEffect(()=>{
  alive.current=true;
  const sb=supabaseBrowser();let timer:ReturnType<typeof setTimeout>|undefined;
  function schedule(){pending.current=true;if(timer)clearTimeout(timer);timer=setTimeout(()=>void refresh(),350);}
  function visible(){if(document.visibilityState==="visible")schedule();}
  void refresh();
  const channel=sb.channel(`raffle:center:${raffleId}`)
   .on("postgres_changes",{event:"*",schema:"public",table:"raffle_prizes",filter:`raffle_id=eq.${raffleId}`},schedule)
   .on("postgres_changes",{event:"*",schema:"public",table:"raffle_entries",filter:`raffle_id=eq.${raffleId}`},schedule)
   .on("postgres_changes",{event:"UPDATE",schema:"public",table:"raffles",filter:`id=eq.${raffleId}`},schedule)
   .subscribe(status=>{if(!alive.current)return;setLive(status==="SUBSCRIBED");if(status==="SUBSCRIBED")schedule();});
  window.addEventListener("focus",visible);document.addEventListener("visibilitychange",visible);
  return()=>{alive.current=false;epoch.current++;if(timer)clearTimeout(timer);if(deferred.current)clearTimeout(deferred.current);controllers.current.forEach(c=>c.abort());void sb.removeChannel(channel);window.removeEventListener("focus",visible);document.removeEventListener("visibilitychange",visible);};
 },[raffleId,refresh]);
 useEffect(()=>{if(!busy&&pending.current)void refresh();},[busy,refresh]);
 return{data,error,setError,loading,live,refresh,mutate};
}
