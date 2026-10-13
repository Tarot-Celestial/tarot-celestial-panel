"use client";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CheckCircle2, Crown, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RouletteSummary } from "@/lib/ruleta";
import RouletteRewardArt from "./RouletteRewardArt";
import ExperienceRail from "./ExperienceRail";
import { useClientRitualAccess } from "./ClientPanelAccess";
import { usePortalMotion } from "./CelestialPortal";
import styles from "./HomeObservatory.module.css";
type Props={name:string;rank:string;minutes:number;free:number;normal:number;coins:number;oracleCredits:number;oracleFree:boolean;oracleCountdown:string;roulette:RouletteSummary|null;highlight:string;benefits:string[];rankProgress:{next_label?:string|null;progress_percent:number;status_text?:string}|null;overrideLabel?:string;children:ReactNode};
export default function HomeObservatory(p:Props){
 const ritualAccess=useClientRitualAccess();
 const {running}=usePortalMotion();
 const hero=useRef<HTMLElement>(null);
 const [heroVisible,setHeroVisible]=useState(false);
 useEffect(()=>{
  if(!hero.current||typeof IntersectionObserver==="undefined")return;
  const observer=new IntersectionObserver(([entry])=>setHeroVisible(entry.isIntersecting),{threshold:0});
  observer.observe(hero.current);
  return ()=>observer.disconnect();
 },[]);
 const counts=p.roulette?[p.roulette.level_1_spins,p.roulette.level_2_spins,p.roulette.level_3_spins,p.roulette.level_4_spins,p.roulette.level_5_spins]:null;
 const names=["Nivel 1","Nivel 2","Nivel 3","Especial","Diamante"];
 const total=counts?.reduce((sum,n)=>sum+Math.max(0,Number(n)||0),0);
 const target=counts?.findIndex((n,i)=>n>0 && (i!==4 || p.roulette?.diamond_access));
 const wheelHref=target!=null && target>=0?"/cliente/ruleta?nivel="+(target+1):"/cliente/ruleta";
 return <div className={styles.home} data-client-home="portal">
  <section ref={hero} className={styles.hero} data-running={running&&heroVisible} aria-labelledby="celestial-welcome">
   <div className={styles.emblem}>
    <div className={styles.aura} aria-hidden="true"/>
    <div className={styles.halo} aria-hidden="true"/>
    <Image src="/images/portal/logo.webp" alt="Tarot Celestial" width={180} height={180} sizes="(max-width: 700px) 110px, 132px" priority draggable={false}/>
   </div>
   <p className={styles.greeting}>Hola, {p.name}</p>
   <h1 id="celestial-welcome">Tu universo <em>empieza aquí</em></h1>
   <p className={styles.subtitle}>Un espacio para descubrir, conectar y continuar tu camino.</p>
   <div className={styles.actions}>
    <Link className={styles.primary} href="/cliente/tarotistas"><Sparkles size={17} aria-hidden="true"/> Encontrar tarotista <ArrowRight size={16} aria-hidden="true"/></Link>
    <Link className={styles.secondary} href={ritualAccess?"/cliente/ritual":"/cliente/rangos"}>{ritualAccess?"Continuar mi ritual":"Descubrir mis beneficios"} <ArrowRight size={13} aria-hidden="true"/></Link>
   </div>
  </section>
  <section className={styles.wallet} aria-label="Tus saldos y tu rango">
   <article id="saldo-minutes" className={styles.resource} data-highlight={p.highlight==="minutes"}><RouletteRewardArt type="minutes"/><div><strong>{p.minutes} <small>min</small></strong><p>{p.free} gratis · {p.normal} normales</p><Link href="/cliente/tarotistas">Usar mis minutos <ArrowRight size={12}/></Link></div></article>
   <article id="saldo-coins" className={styles.resource} data-highlight={p.highlight==="coins"}><RouletteRewardArt type="coins"/><div><strong>{p.coins.toLocaleString("es-ES")} <small>Coins</small></strong><p>Tus recompensas</p><a href="#canjear-coins">Canjear <ArrowRight size={12}/></a></div></article>
   <article className={styles.resource}><span className={styles.rankGem} aria-hidden="true"><Crown size={35} strokeWidth={1.2}/></span><div><strong className={styles.rankName}>{p.rank}</strong><p>Tu rango celestial</p><Link href="/cliente/rangos">Ver mis ventajas <ArrowRight size={12}/></Link></div></article>
  </section>
  <ExperienceRail ritualAccess={ritualAccess} oracleFree={p.oracleFree} oracleCredits={p.oracleCredits} oracleCountdown={p.oracleCountdown} rouletteHref={wheelHref} rouletteSpins={total??null} rank={p.rank}/>
  <div className={styles.details}>
   <section className={styles.quickBalances} aria-label="Tus tiradas y giros">
    <Link href="/cliente/oraculo"><Sparkles size={18} aria-hidden="true"/><div><strong>Oráculo · {p.oracleCredits+(p.oracleFree?1:0)} tiradas</strong><p>{p.oracleFree?"1 gratis disponible":"Gratis en "+p.oracleCountdown} · {p.oracleCredits} compradas</p></div><ArrowRight size={16}/></Link>
    <Link href={wheelHref}><Crown size={18} aria-hidden="true"/><div><strong>Ruleta · {total??"—"} {total===1?"giro":"giros"}</strong><p>{counts?counts.map((n,i)=>n>0?names[i]+": "+n+(i===4&&!p.roulette?.diamond_access?" (sin acceso)":""):null).filter(Boolean).join(" · ")||"No tienes giros pendientes":"Consulta tus giros en Ruleta"}</p></div><ArrowRight size={16}/></Link>
   </section>
   {p.children}
  <section className={styles.advantages} aria-label="Ventajas de tu rango">
   <div className={styles.rankArt}><RouletteRewardArt type={p.rank.toLowerCase()==="diamante"?"perk":"rank"}/></div>
   <div><span className={styles.eyebrow}>TU CAMINO CELESTIAL</span><h2>Tus ventajas {p.rank}</h2>{p.overrideLabel && <p>{p.overrideLabel}</p>}
    {p.rankProgress?.next_label && <div className={styles.progress}><span>{p.rank} → {p.rankProgress.next_label}</span><progress aria-label="Progreso al siguiente rango" max={100} value={Math.max(0,Math.min(100,p.rankProgress.progress_percent))}/><p>{p.rankProgress.status_text}</p></div>}
    <Link href="/cliente/rangos">Ver condiciones y todas las ventajas <ArrowRight size={14}/></Link></div>
   <ul>{p.benefits.slice(0,4).map(benefit=><li key={benefit}><CheckCircle2 size={16}/>{benefit}</li>)}{!p.benefits.length && <li>Consulta las ventajas disponibles para tu rango.</li>}</ul>
  </section>
  <section className={styles.shortcuts} aria-label="Más opciones"><Link href="/cliente/precios-ofertas"><RouletteRewardArt type="minutes"/><div><h2>¿Necesitas más minutos?</h2><p>Todos los paquetes, precios y beneficios.</p><span>Ver precios y ofertas →</span></div></Link><Link id="comprar-tiradas" href="/cliente/precios-ofertas#oraculo-packs"><RouletteRewardArt type="oracle_credits"/><div><h2>Explora tu Oráculo</h2><p>Consulta las opciones de tiradas.</p><span>Ver paquetes de Oráculo →</span></div></Link></section>
  </div>
 </div>;
}
