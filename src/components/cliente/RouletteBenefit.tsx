"use client";
import Link from "next/link";
import { ArrowRight, CircleDotDashed, Coins, Gift, WandSparkles } from "lucide-react";
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
    <div className={styles.includedGrid}>
      <span className={styles.includedItem}>
        <i className={styles.wheelIcon}><CircleDotDashed /></i>
        <span><small>Ruleta incluida</small><b>{spins} {spins === 1 ? "giro" : "giros"} · Nivel {level}</b></span>
      </span>
      {rewardCoins > 0 ? <span className={styles.includedItem}>
        <i className={styles.coinIcon}><Coins /></i>
        <span><small>Coins por tu compra</small><b>+{rewardCoins.toLocaleString("es-ES")} Coins</b></span>
      </span> : null}
      {oracleCredits > 0 ? <span className={styles.includedItem}>
        <i className={styles.oracleIcon}><WandSparkles /></i>
        <span><small>Regalo Oráculo</small><b>+{oracleCredits} {oracleCredits === 1 ? "tirada" : "tiradas"}</b></span>
      </span> : null}
    </div>
    <span className={styles.prizes}><Gift /> En la ruleta puedes ganar hasta +{minutes} min o {coins.toLocaleString("es-ES")} Coins</span>
    <Link href={"/cliente/ruleta?nivel=" + level}>Ver ruleta <ArrowRight size={13}/></Link>
    <small>Se activa cuando tu compra queda confirmada.</small>
  </div>;
}

