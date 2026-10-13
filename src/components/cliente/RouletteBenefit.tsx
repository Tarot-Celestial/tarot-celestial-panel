"use client";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import type { RouletteLevel, RouletteSummary } from "@/lib/ruleta";
import styles from "./RouletteBenefit.module.css";

export default function RouletteBenefit({ level, summary, spins = 1, rewardCoins = 0, oracleCredits = 0 }: { level: RouletteLevel; summary: RouletteSummary | null; spins?: number; rewardCoins?: number; oracleCredits?: number }) {
  const prizes = summary?.catalogue.filter(p => p.nivel === level) ?? [];
  const catalogueMinutes = Math.max(0, ...prizes.filter(p => p.reward_type === "minutes").map(p => p.reward_value));
  const catalogueCoins = Math.max(0, ...prizes.filter(p => p.reward_type === "coins").map(p => p.reward_value));
  const prizesText = [catalogueMinutes > 0 ? `Hasta +${catalogueMinutes} min` : null, catalogueCoins > 0 ? `Hasta ${catalogueCoins.toLocaleString("es-ES")} Coins` : null].filter(Boolean).join(" · ");
  const confirmed = [rewardCoins > 0 ? `+${rewardCoins.toLocaleString("es-ES")} Coins` : null, oracleCredits > 0 ? `+${oracleCredits} ${oracleCredits === 1 ? "tirada" : "tiradas"} Oráculo` : null].filter(Boolean).join(" · ");
  if (spins <= 0 && !confirmed) return null;
  return <div className={styles.benefit} data-premium={level >= 2} data-level={level}>
    <span className={styles.eyebrow}>TU COMPRA INCLUYE</span>
    {spins > 0 ? <strong><Sparkles size={15}/> {spins} {spins === 1 ? "GIRO" : "GIROS"} NIVEL {level}</strong> : null}
    {confirmed ? <span className={styles.confirmed}>Al confirmar: {confirmed}</span> : null}
    {spins > 0 ? <><span className={styles.prizes}>{prizesText || "Consulta los premios disponibles en esta ruleta."}</span><Link href={"/cliente/ruleta?nivel=" + level}>Ver ruleta <ArrowRight size={13}/></Link></> : null}
    <small>Se activa cuando tu compra queda confirmada.</small>
  </div>;
}
