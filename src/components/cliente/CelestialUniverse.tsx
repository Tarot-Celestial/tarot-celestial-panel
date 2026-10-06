"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./CelestialUniverse.module.css";
const SCENES:Record<string,{name:string;index:number;color:string}>={
 dashboard:{name:"Neptuno",index:0,color:"#507cff"},oraculo:{name:"Urano",index:1,color:"#85e4e0"},ruleta:{name:"Saturno",index:2,color:"#eac17a"},sorteo:{name:"Júpiter",index:3,color:"#e5b297"},
 "precios-ofertas":{name:"Venus",index:4,color:"#e6c48a"},tarotistas:{name:"La Luna",index:5,color:"#d9d9f0"},perfil:{name:"Marte",index:6,color:"#dc9b84"},resenas:{name:"La Tierra",index:7,color:"#77bedf"},
 notificaciones:{name:"Mercurio",index:8,color:"#b4b5ca"},ritual:{name:"Plutón",index:9,color:"#ceacdf"},rangos:{name:"El Sol",index:10,color:"#f2cc70"}
};
export function universeDestination(pathname:string) { return SCENES[pathname.split('/')[2]] || {name:"Nebulosa celestial",index:11,color:"#bf9de7"}; }
const position=(index:number)=>({backgroundPosition:((index%4)*100/3)+"% "+(Math.floor(index/4)*50)+"%"});
export default function CelestialUniverse({pathname}:{pathname:string}) {
 const scene=universeDestination(pathname),ref=useRef<HTMLDivElement>(null),[previous,setPrevious]=useState<number|null>(null),[travel,setTravel]=useState(false);
 useEffect(()=>{
  let old:number|null=null;try {const stored=sessionStorage.getItem('tc-universe-destination');old=stored===null?null:Number(stored);sessionStorage.setItem('tc-universe-destination',String(scene.index));}catch{}
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduced && old!==null && Number.isInteger(old) && old>=0 && old<12 && old!==scene.index){setPrevious(old);setTravel(true);}else{setPrevious(null);setTravel(false);}
  const timer=setTimeout(()=>{setPrevious(null);setTravel(false);},850);
  return()=>clearTimeout(timer);
 },[scene.index]);
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(pointer:fine)');let frame=0,x=0,y=0;
  function paint(){frame=0;if(!node)return;const reduced=motion.matches,scroll=reduced?0:Math.min(window.scrollY,5000);node.style.setProperty('--depth-far',(-scroll*.025)+'px');node.style.setProperty('--depth-near',(-scroll*.08)+'px');node.style.setProperty('--pointer-x',(reduced?0:x)+'px');node.style.setProperty('--pointer-y',(reduced?0:y)+'px');if(reduced){setTravel(false);setPrevious(null);}}
  function schedule(){if(!frame && !document.hidden)frame=requestAnimationFrame(paint);}
  function move(event:PointerEvent){if(!fine.matches)return;x=(event.clientX/innerWidth-.5)*16;y=(event.clientY/innerHeight-.5)*12;schedule();}
  function reset(){x=0;y=0;schedule();}
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('pointermove',move,{passive:true});window.addEventListener('blur',reset);document.addEventListener('visibilitychange',schedule);motion.addEventListener('change',schedule);paint();
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('pointermove',move);window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',schedule);motion.removeEventListener('change',schedule);};
 },[]);
 return <div ref={ref} className={styles.universe} data-destination={scene.name} data-travel={travel} style={{"--planet-glow":scene.color} as CSSProperties} aria-hidden="true">
  <div className={styles.sky}/><div className={styles.stars}/>
  <div className={styles.depth}>
   {previous!==null && <div className={styles.departing} style={position(previous)}/>}
   <div key={scene.index} className={styles.arriving} data-travel={travel}><div className={styles.planet} style={position(scene.index)}/></div>
   <svg className={styles.constellation} viewBox="0 0 700 700" focusable="false"><g fill="none" stroke="#e2be76" strokeWidth=".65"><ellipse cx="350" cy="350" rx="315" ry="185" transform="rotate(-25 350 350)"/><ellipse cx="350" cy="350" rx="290" ry="250" transform="rotate(30 350 350)"/><path d="M95 235 280 80 510 170 590 435 310 620 95 235"/></g><g fill="#e9cb90">{[[95,235],[280,80],[510,170],[590,435],[310,620]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="3"/>)}</g><text x="72" y="222" fill="#e9cb90" fontSize="28">☾</text><text x="580" y="471" fill="#e9cb90" fontSize="28">✧</text></svg>
  </div><div className={styles.shade}/>
 </div>;
}
