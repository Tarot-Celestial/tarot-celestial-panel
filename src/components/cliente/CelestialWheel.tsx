"use client";
import { useId, type CSSProperties } from "react";
import { RotateCw, Diamond, Crown, Moon, Sun, Flame, LockKeyhole } from "lucide-react";
import { type RouletteLevel, type RoulettePrize } from "@/lib/ruleta";
import RouletteRewardArt from "./RouletteRewardArt";
import styles from "./CelestialWheel.module.css";
export const WHEEL_SPIN_MS = 7200;
const NAMES = { 1:"Bronce Celestial", 2:"Plata Celestial", 3:"Corona Astral", 4:"Especial", 5:"Diamante" };
const EMBLEMS = { 1:Sun, 2:Moon, 3:Crown, 4:Flame, 5:Diamond };
function point(radius:number, angle:number) { return [500 + radius*Math.sin(angle),500-radius*Math.cos(angle)]; }
function capsule(index:number, count:number) {
  const step=2*Math.PI/count, gap=Math.min(.025,step*.08), start=index*step+gap, end=(index+1)*step-gap;
  const corner=Math.min(22,step*90), outer=463, inner=250, large=end-start>Math.PI?1:0;
  const at=(r:number,t:number)=>point(r,t).join(",");
  return "M"+at(outer-corner,start)+" Q"+at(outer,start)+" "+at(outer,start+corner/outer)
    +" A463,463 0 "+large+" 1 "+at(outer,end-corner/outer)+" Q"+at(outer,end)+" "+at(outer-corner,end)
    +" L"+at(inner+corner,end)+" Q"+at(inner,end)+" "+at(inner,end-corner/inner)
    +" A250,250 0 "+large+" 0 "+at(inner,start+corner/inner)+" Q"+at(inner,start)+" "+at(inner+corner,start)+" Z";
}
function value(prize:RoulettePrize) {
  if(prize.reward_type==="minutes") return [String(prize.reward_value),"MIN"];
  if(prize.reward_type==="coins") return [String(prize.reward_value),"COINS"];
  if(prize.reward_type==="oracle_credits") return [String(prize.reward_value),"ORÁCULO"];
  if(prize.reward_type==="streak_minutes") return [String(prize.meta?.daily_minutes || prize.reward_value),"MIN × "+String(prize.meta?.days_total || 7)+" DÍAS"];
  if(prize.reward_type==="rank") return [String(prize.meta?.rank || "Rango"),"RANGO"];
  return [prize.reward_type==="ritual"?"Ritual":"Extra","PREMIO"];
}
type Props = { prizes:RoulettePrize[]; level:RouletteLevel; rotation:number; busy:boolean; spinning:boolean; pending:boolean; disabled:boolean; available:number|null; winner?:string; onSpin:()=>void };
export default function CelestialWheel({prizes,level,rotation,busy,spinning,pending,disabled,available,winner,onSpin}:Props) {
  const id=useId().replace(/:/g, ""), Emblem=EMBLEMS[level];
  const count=prizes.length, dense=count>9, title=level<4?"Nivel "+level:NAMES[level];
  return <div className={styles.experience} data-level={level} data-busy={busy} data-spinning={spinning} style={{"--spin-time":WHEEL_SPIN_MS+"ms"} as CSSProperties}>
    <div className={styles.heading}><span>EL CÍRCULO DE LOS TESOROS</span><h3>{NAMES[level]}</h3><p>{available ?? "—"} {available===1?"giro disponible":"giros disponibles"}</p></div>
    <div className={styles.orbit} data-dense={dense} data-empty={!count}>
      <div className={styles.halo} aria-hidden="true"/>
      <div className={styles.pointer} aria-hidden="true"/>
      <div className={styles.rotor} style={{transform:"rotate("+rotation+"deg)"}} aria-hidden="true">
        <svg className={styles.glass} viewBox="0 0 1000 1000" focusable="false">
          <defs>
            <linearGradient id={id+"glass"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--glass-light)" stopOpacity=".8"/><stop offset=".18" stopColor="var(--glass-light)" stopOpacity=".32"/><stop offset=".55" stopColor="var(--glass-dark)"/><stop offset="1" stopColor="var(--glass-light)" stopOpacity=".45"/></linearGradient>
            <linearGradient id={id+"edge"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff"/><stop offset=".4" stopColor="var(--accent)"/><stop offset=".7" stopColor="var(--glass-light)"/><stop offset="1" stopColor="var(--accent)"/></linearGradient>
          </defs>
          <circle cx="500" cy="500" r="490" fill="none" stroke={"url(#"+id+"edge)"} strokeWidth="2" opacity=".8"/>
          <circle cx="500" cy="500" r="477" fill="none" stroke="var(--accent)" strokeWidth="1" opacity=".3"/>
          {prizes.map((p,i)=><g key={p.id} data-winner={winner===p.id} className={styles.capsule}>
            <path d={capsule(i,count)} fill={"url(#"+id+"glass)"} stroke={"url(#"+id+"edge)"} strokeWidth="3" strokeLinejoin="round"/>
            {level===5 && <path d={"M"+point(445,(i+.5)*2*Math.PI/count).join(",")+" L"+point(274,(i+.08)*2*Math.PI/count).join(",")+" L"+point(274,(i+.92)*2*Math.PI/count).join(",")+" Z"} fill="#bcecff" opacity=".08"/>}
            {level===5 && <path d={capsule(i,count)} transform="translate(500 500) scale(.965) translate(-500 -500)" fill="none" stroke="#c8f9ff" strokeWidth="2" opacity=".22"/>}
          </g>)}
          {Array.from({length:12},(_,i)=>{const [x,y]=point(490,i*Math.PI/6);return <circle key={i} cx={x} cy={y} r={i%3===0?6:3} fill="var(--accent)"/>;})}
        </svg>
        {prizes.map((prize,i)=>{
          const angle=(i+.5)*2*Math.PI/count, [main,sub]=value(prize);
          return <span key={prize.id} className={styles.treasure} data-winner={winner===prize.id} data-long={main.length>5} style={{left:(50+35.5*Math.sin(angle))+"%",top:(50-35.5*Math.cos(angle))+"%",width:Math.min(17,155/count)+"%",transform:"translate(-50%,-50%) rotate("+(-rotation)+"deg)"}}>
            <RouletteRewardArt type={prize.reward_type}/><b>{main}</b><small>{sub}</small>
          </span>;
        })}
      </div>
      <button type="button" className={styles.center} disabled={disabled} onClick={onSpin} data-leo-anchor={pending?"roulette-recovery":undefined}
        aria-label={pending?"Comprobar giro pendiente":!count?"No hay premios configurados para este nivel":available?"Girar ruleta "+title:"No hay giros disponibles"}>
        {busy?<RotateCw/>:disabled?<LockKeyhole/>:level===5?<RouletteRewardArt type="perk" className={styles.emblemArt}/>:level===3?<RouletteRewardArt type="rank" className={styles.emblemArt}/>:<Emblem/>}
        <strong>{busy?(spinning?"GIRANDO":"PREPARANDO"):pending?"COMPROBAR":!count?"SIN PREMIOS":available?"GIRAR":"SIN GIROS"}</strong>
        <small>{title}</small>
      </button>
    </div>
    <div className={styles.status} role="status" aria-live="polite">{busy?(spinning?"La rueda está revelando tu premio…":"Confirmando tu giro…"):winner?"Tu premio ya está listo":pending?"Recupera tu resultado sin gastar otro giro":available?"Pulsa GIRAR en el centro · Usa 1 giro":"Consulta los premios de esta ruleta"}</div>
  </div>;
}

