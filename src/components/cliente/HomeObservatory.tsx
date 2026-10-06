"use client";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Crown, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { RouletteSummary } from "@/lib/ruleta";
import RouletteRewardArt from "./RouletteRewardArt";
import ClientNavIcon from "./ClientNavIcon";
import styles from "./HomeObservatory.module.css";
type Props={name:string;rank:string;minutes:number;free:number;normal:number;coins:number;oracleCredits:number;oracleFree:boolean;oracleCountdown:string;roulette:RouletteSummary|null;highlight:string;benefits:string[];rankProgress:{next_label?:string|null;progress_percent:number;status_text?:string}|null;overrideLabel?:string;children:ReactNode};
export default function HomeObservatory(p:Props){
 const counts=p.roulette?[p.roulette.level_1_spins,p.roulette.level_2_spins,p.roulette.level_3_spins,p.roulette.level_4_spins,p.roulette.level_5_spins]:null;
 const names=["Nivel 1","Nivel 2","Nivel 3","Especial","Diamante"];
 const total=counts?.reduce((sum,n)=>sum+Math.max(0,Number(n)||0),0);
 const target=counts?.findIndex((n,i)=>n>0 && (i!==4 || p.roulette?.diamond_access));
 const wheelHref=target!=null && target>=0?"/cliente/ruleta?nivel="+(target+1):"/cliente/ruleta";
 return <div className={styles.home}>
  <section className={styles.hero}>
   <span className={styles.destination}>INICIO · NEPTUNO</span>
   <Link className={styles.rankBadge} href="/cliente/rangos"><Crown size={15}/> Rango {p.rank}</Link>
   <h1>Tu universo<br/>empieza aquí</h1><p>Hola, {p.name}. Todo tu espacio celestial, conectado.</p>
   <div className={styles.actions}><Link className={styles.primary} href="/cliente/tarotistas">Ver tarotistas <ArrowRight size={17}/></Link><Link className={styles.secondary} href="/cliente/precios-ofertas">Comprar minutos</Link></div>
  </section>
  <section className={styles.wallet} aria-label="Tus saldos disponibles">
   <article id="saldo-minutes" className={styles.resource} data-highlight={p.highlight==="minutes"}><RouletteRewardArt type="minutes"/><div><span>MINUTOS DISPONIBLES</span><strong>{p.minutes} <small>min</small></strong><p>{p.free} gratis · {p.normal} normales</p><Link href="/cliente/tarotistas">Usar mis minutos <ArrowRight size={13}/></Link></div></article>
   <article id="saldo-coins" className={styles.resource} data-highlight={p.highlight==="coins"}><RouletteRewardArt type="coins"/><div><span>TUS RECOMPENSAS</span><strong>{p.coins.toLocaleString("es-ES")} <small>Coins</small></strong><a href="#canjear-coins">Canjear <ArrowRight size={13}/></a></div></article>
   <article className={styles.resource}><span className={styles.wheelArt}><ClientNavIcon name="roulette"/></span><div><span>GIROS DE RULETA</span><strong>{total ?? "—"} <small>{total===1?"giro":"giros"}</small></strong><p>{counts?counts.map((n,i)=>n>0?names[i]+": "+n+(i===4&&!p.roulette?.diamond_access?" (sin acceso)":""):null).filter(Boolean).join(" · ")||"No tienes giros pendientes":"Consulta tus giros en Ruleta"}</p><Link href={wheelHref}>Ver mi ruleta <ArrowRight size={13}/></Link></div></article>
   <article className={styles.resource}><RouletteRewardArt type="oracle_credits"/><div><span>ORÁCULO</span><strong>{p.oracleCredits+(p.oracleFree?1:0)} <small>tiradas</small></strong><p>{p.oracleFree?"1 gratis disponible": "Gratis en "+p.oracleCountdown} · {p.oracleCredits} compradas</p><Link href="/cliente/oraculo">Abrir Oráculo <ArrowRight size={13}/></Link></div></article>
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
 </div>;
}
