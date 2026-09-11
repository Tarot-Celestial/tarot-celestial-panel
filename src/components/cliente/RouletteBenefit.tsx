"use client";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import type { RouletteLevel, RouletteSummary } from "@/lib/ruleta";
import styles from "./RouletteBenefit.module.css";

export default function RouletteBenefit({ level, summary, spins = 1, rewardCoins = 0, oracleCredits = 0 }: { level: RouletteLevel; summary: RouletteSummary | null; spins?: number; rewardCoins?: number; oracleCredits?: number }) {
  const prizes = summary?.catalogue.filter(p => p.nivel === level) ?? [];
  const catalogueMinutes = Math.max(0, ...prizes.filter(p => p.reward_type === "minutes").map(p => p.reward_value));
  const catalogueCoins = Math.max(0, ...prizes.filter(p => p.reward_type === "coins").map(p => p.reward_value));
  const minutes = catalogueMinutes || (level === 3 ? 100 : level === 2 ? 80 : 60);
  const coins = catalogueCoins || (level === 3 ? 2000 : level === 2 ? 1000 : 400);
  return <div className={styles.benefit} data-premium={level >= 2} data-level={level}>
    <span className={styles.eyebrow}>TU COMPRA INCLUYE</span>
    <strong><Sparkles size={15}/> {spins} {spins === 1 ? "GIRO" : "GIROS"} NIVEL {level}</strong>
    {rewardCoins > 0 ? <span className={styles.confirmed}>Al confirmar: +{rewardCoins.toLocaleString("es-ES")} Coins · +{oracleCredits} {oracleCredits === 1 ? "tirada" : "tiradas"} Oráculo</span> : null}
    <span className={styles.prizes}>✨ Hasta +{minutes} min <i/> 🪙 Hasta {coins.toLocaleString("es-ES")} Coins</span>
    <Link href={"/cliente/ruleta?nivel=" + level}>Ver ruleta <ArrowRight size={13}/></Link>
    <small>Se activa cuando tu compra queda confirmada.</small>
  </div>;
}
