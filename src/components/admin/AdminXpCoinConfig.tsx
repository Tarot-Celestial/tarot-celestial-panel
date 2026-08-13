"use client";
import { useEffect, useState } from "react";
import { Coins, Save } from "lucide-react";
import styles from "./AdminXpCoinConfig.module.css";

export default function AdminXpCoinConfig({value,busy,save}:{value:any;busy:boolean;save:(config:any)=>void}){
 const [config,setConfig]=useState(value?.config||{xp_units:100,coin_units:10,min_xp:100,enabled:true});
 useEffect(()=>{if(value?.config)setConfig(value.config)},[value]);
 return <article className={styles.card}><div><span><Coins size={15}/> ECONOMÍA DE TELEFONISTAS</span><h2>Canjear XP por Coins</h2><p>La relación se aplica solo a canjes futuros; no altera XP histórico, niveles ni conversiones anteriores.</p></div>{!value?.installed?<div className={styles.install}>Ejecuta SQL_NECESARIO.sql para activar esta configuración.</div>:<div className={styles.controls}><label>XP base<input type="number" min="1" value={config.xp_units} onChange={e=>setConfig({...config,xp_units:Number(e.target.value)})}/></label><label>Coins otorgadas<input type="number" min="1" value={config.coin_units} onChange={e=>setConfig({...config,coin_units:Number(e.target.value)})}/></label><label>Mínimo XP<input type="number" min="1" value={config.min_xp} onChange={e=>setConfig({...config,min_xp:Number(e.target.value)})}/></label><label className={styles.toggle}><input type="checkbox" checked={config.enabled} onChange={e=>setConfig({...config,enabled:e.target.checked})}/><span>{config.enabled?"Canje activo":"Canje desactivado"}</span></label><button disabled={busy} onClick={()=>save(config)}><Save size={15}/> Guardar relación</button></div>}</article>;
}
