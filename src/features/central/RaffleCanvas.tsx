"use client";
import {memo,useEffect,useRef} from "react";
import type {WheelEntry} from "./raffle-wheel";
import styles from "./CentralRaffleWheel.module.css";
const COLORS=["#69418f","#b58a3c","#28766b","#914a6e","#426694","#87682f"];
export default memo(function RaffleCanvas({entries,rotation,duration,spinning}:{entries:WheelEntry[];rotation:number;duration:number;spinning:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const size = 1000, center = size / 2, radius = 475;
    ctx.clearRect(0, 0, size, size);
    if (!entries.length) {
      ctx.fillStyle = "#2a2038";
      ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const step = Math.PI * 2 / entries.length;
    entries.forEach((entry, index) => {
      const start = -Math.PI / 2 + index * step;
      ctx.beginPath(); ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, start + step); ctx.closePath();
      ctx.fillStyle = COLORS[index % COLORS.length]; ctx.fill();
      if (entries.length <= 150) { ctx.strokeStyle = "#e4c77888"; ctx.lineWidth = 2; ctx.stroke(); }
      // Large pools retain equal sectors; the full, searchable list stays alongside.
      if (entries.length <= 100 || index % Math.ceil(entries.length / 80) === 0) {
        ctx.save(); ctx.translate(center, center); ctx.rotate(start + step / 2);
        ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff7de";
        ctx.font = `700 ${entries.length <= 20 ? 26 : entries.length <= 50 ? 18 : 12}px Arial`;
        const label = entries.length <= 50 ? `#${entry.number} · ${entry.name.slice(0, 14)}` : String(entry.number);
        ctx.fillText(label, radius - 20, 0, 300); ctx.restore();
      }
    });

 },[entries]);
 return <div className={styles.wheelFrame} data-spinning={spinning}>
  <div className={styles.pointer} aria-hidden="true"/>
  <canvas ref={canvas} width={1000} height={1000} role="img" aria-label={`Ruleta de ${entries.length} números elegibles`}
   style={{transform:`rotate(${rotation}deg)`,transition:`transform ${duration}ms cubic-bezier(.12,.75,.12,1)`,willChange:spinning?"transform":"auto"}}/>
  <div className={styles.hub} aria-hidden="true"><span>✦</span><small>CELESTIAL</small></div>
 </div>;
});

