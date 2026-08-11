"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Award, BarChart3, ChevronRight, LockKeyhole, Medal, RefreshCw, Shield, Sparkles, Star, Trophy, Zap } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./CentralXpPanel.module.css";

const sb = supabaseBrowser();
const DAYS = ["L", "M", "X", "J", "V", "S", "D"];
const fmt = (v: any) => new Intl.NumberFormat("es-ES").format(Number(v) || 0);

export default function CentralXpPanel() {
  const [data, setData] = useState<any>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const previousLevel = useRef<number | null>(null); const [levelUp, setLevelUp] = useState<number | null>(null);
  const load = useCallback(async (silent=false) => { if(!silent)setBusy(true); try { const {data:s}=await sb.auth.getSession(); const token=s.session?.access_token; if(!token) throw new Error("Sesión no disponible"); const r=await fetch(`/api/central/xp-system?t=${Date.now()}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"}); const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||"No se pudo cargar XP"); setData((old:any)=>{ const oldLevel=old?.progress?.level ?? previousLevel.current; if(oldLevel && j.progress.level>oldLevel){setLevelUp(j.progress.level); window.setTimeout(()=>setLevelUp(null),3500);} previousLevel.current=j.progress.level; return j;}); setError(""); } catch(e:any){setError(e.message||"Error");} finally{if(!silent)setBusy(false);} },[]);
  useEffect(()=>{load(); const id=window.setInterval(()=>load(true),30000); const vis=()=>{if(document.visibilityState==="visible")load(true)}; document.addEventListener("visibilitychange",vis); return()=>{clearInterval(id);document.removeEventListener("visibilitychange",vis)}} ,[load]);
  const maxDay=useMemo(()=>Math.max(1,...(data?.weekly||[]).map((d:any)=>Number(d.xp)||0)),[data]);
  if(!data&&!error) return <div className={styles.loading}>Cargando tu progreso XP…</div>;
  if(!data) return <div className={styles.error}>{error}<button onClick={()=>load()}>Reintentar</button></div>;
  const p=data.progress; const percent=Math.min(100,Math.max(0,(p.level_xp/Math.max(1,p.level_span))*100));
  const comparison=p.previous_week_xp>0?Math.round(((p.xp_week-p.previous_week_xp)/p.previous_week_xp)*100):null;
  return <section className={styles.page}>
    {levelUp&&<div className={styles.levelUp}><Sparkles/> ¡SUBISTE DE NIVEL! <strong>NIVEL {levelUp}</strong></div>}
    <header className={styles.hero}>
      <div className={styles.medallion}><Shield/><span>{p.level}</span></div>
      <div className={styles.heroText}><span className={styles.eyebrow}>TU PROGRESIÓN PERSONAL</span><h1>Tu sistema XP</h1><p>Cada acción cuenta. Suma XP y sube de nivel.</p><div className={styles.levelLine}><b>Nivel {p.level}</b><span>Telefonista · {data.worker.name}</span></div></div>
      <button className={styles.refresh} onClick={()=>load()} disabled={busy}><RefreshCw size={16}/> {busy?"Actualizando…":"Actualizar"}</button>
      <div className={styles.progressBox}><div><span>XP ACTUAL</span><strong>{fmt(p.total_xp)} XP</strong></div><div><span>PRÓXIMO NIVEL</span><strong>Nivel {p.next_level}</strong></div><div className={styles.track}><i style={{width:`${percent}%`}}/></div><small>{fmt(p.level_xp)} / {fmt(p.level_span)} XP · faltan {fmt(p.remaining_xp)} XP</small></div>
    </header>

    <div className={styles.metrics}>{[["XP hoy",p.xp_today,Zap],["XP esta semana",p.xp_week,BarChart3],["XP este mes",p.xp_month,Star],["XP total",p.total_xp,Trophy]].map(([l,v,I]:any)=><article key={l}><I/><span>{l}</span><strong>{fmt(v)} XP</strong></article>)}</div>

    <div className={styles.grid}>
      <article className={styles.card}><div className={styles.cardTitle}><BarChart3/><div><span>ESTADÍSTICAS</span><h2>Tus XP esta semana</h2></div></div><div className={styles.weekSummary}><strong>{fmt(p.xp_week)} XP</strong>{comparison!==null&&<span className={comparison>=0?styles.positive:styles.negative}>{comparison>=0?"+":""}{comparison}% vs. semana anterior</span>}</div><div className={styles.chart}>{(data.weekly||[]).map((d:any,i:number)=><div className={styles.barCol} key={d.date}><span>{d.xp?`${fmt(d.xp)}`:"0"}</span><div className={styles.barRail}><i style={{height:`${Math.max(d.xp?8:2,(d.xp/maxDay)*100)}%`}}/></div><b>{DAYS[i]}</b></div>)}</div></article>
      <article className={styles.card}><div className={styles.cardTitle}><Trophy/><div><span>CLASIFICACIÓN</span><h2>Ranking</h2></div></div><div className={styles.ranking}>{data.ranking.map((r:any)=><div key={r.worker_id} className={r.is_me?styles.me:""}><b>#{r.position}</b><Medal size={18}/><span>{r.name}</span><small>Nivel {r.level}</small><strong>{fmt(r.xp)} XP</strong></div>)}</div></article>
    </div>

    <article className={styles.card}><div className={styles.cardTitle}><Sparkles/><div><span>CONFIGURADO POR ADMINISTRACIÓN</span><h2>Acciones que dan experiencia</h2></div></div><div className={styles.rules}>{data.rules.map((r:any)=><div className={styles.rule} key={r.action_key}><div className={styles.ruleIcon}>{r.integration_status==="connected"?<Zap/>:<LockKeyhole/>}</div><div><h3>{r.name}</h3><p>{r.description||"Acción de experiencia"}</p><small>{r.frequency||"Frecuencia configurada"}</small></div><strong>+{fmt(r.xp_reward)} XP</strong><span className={styles.lock}><LockKeyhole size={13}/>{r.integration_status==="connected"?"Solo lectura":"Próximamente"}</span></div>)}</div></article>

    <div className={styles.how}><h2>¿Cómo funciona?</h2>{[["1","Gana XP","Realiza acciones importantes con tus clientas y gana experiencia."],["2","Sube de nivel","Acumula XP para subir de nivel y desbloquear nuevas ventajas."],["3","Consigue recompensas","Tu progreso podrá darte acceso a Coins, bonos, misiones y otros beneficios."]].map(x=><article key={x[0]}><b>{x[0]}</b><h3>{x[1]}</h3><p>{x[2]}</p><ChevronRight/></article>)}</div>

    <div className={styles.grid}>
      <article className={styles.card}><div className={styles.cardTitle}><Award/><div><span>HISTORIAL REAL</span><h2>Actividad reciente</h2></div></div><div className={styles.activity}>{data.recent.length?data.recent.map((e:any)=><div key={e.id}><span>{new Date(e.created_at).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span><b>{e.reference_label||e.action_key.replaceAll("_"," ")}</b><strong className={Number(e.xp_amount)>=0?styles.positive:styles.negative}>{Number(e.xp_amount)>=0?"+":""}{fmt(e.xp_amount)} XP</strong></div>):<p>Sin actividad XP todavía.</p>}</div></article>
      <article className={`${styles.card} ${styles.next}`}><div className={styles.cardTitle}><LockKeyhole/><div><span>PRÓXIMO NIVEL</span><h2>Nivel {p.next_level}</h2></div></div><strong>Faltan {fmt(p.remaining_xp)} XP</strong><div className={styles.benefits}><LockKeyhole/><b>Beneficios del próximo nivel</b><span>Beneficios por definir · Próximamente</span></div></article>
    </div>
    {error&&<div className={styles.softError}>{error}</div>}
  </section>
}
