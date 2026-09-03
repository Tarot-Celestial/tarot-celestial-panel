"use client";
import {useState} from "react";
import nextDynamic from "next/dynamic";
import {supabaseBrowser} from "@/lib/supabase-browser";
import type {RaffleCenterState} from "./raffle-center";
import styles from "./CentralRaffleWheel.module.css";
const Wheel=nextDynamic(()=>import("./CentralRaffleWheel"),{ssr:false});
export default function RaffleWinnerAdmin(){
 const [raffle,setRaffle]=useState<RaffleCenterState["raffle"]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function open(){
  if(busy)return;setBusy(true);setError("");
  try{
   const token=(await supabaseBrowser().auth.getSession()).data.session?.access_token;
   if(!token)throw new Error("Vuelve a iniciar sesión.");
   const response=await fetch("/api/central/raffle/prizes",{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
   const json=await response.json();
   if(!response.ok||!json.ok)throw new Error(json.error||"No se pudo abrir el sorteo.");
   if(!json.canManage)throw new Error("Solo administradores.");
   setRaffle(json.raffle);
  }catch(e){setError(e instanceof Error?e.message:"No se pudo abrir.");}finally{setBusy(false);}
 }
 return <section className={styles.adminEntry}><span className={styles.eyebrow}>SORTEO CELESTIAL · ADMINISTRACIÓN</span>
  <h2>Centro de selección de ganadores</h2><p>Premios existentes, selección aleatoria, pruebas identificadas y confirmación segura.</p>
  <button className={styles.spinButton} type="button" disabled={busy} onClick={()=>void open()}>{busy?"Comprobando sorteo…":"Elegir ganadores"}</button>
  {error?<p role="alert">{error}</p>:null}
  {raffle?<Wheel key={raffle.id} entries={[]} title={raffle.title} raffleId={raffle.id} onClose={()=>setRaffle(null)}/>:null}
 </section>;
}

