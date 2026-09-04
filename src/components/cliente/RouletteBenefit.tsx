"use client";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import type { RouletteSummary } from "@/lib/ruleta";
import styles from "./RouletteBenefit.module.css";

export default function RouletteBenefit({ amount, summary }: { amount: number; summary: RouletteSummary | null }) {
  const level = amount >= Number(summary?.level_2_from ?? 27) ? 2 : 1;
  const prizes = summary?.catalogue.filter(p => p.nivel === level) ?? [];
  const catalogueMinutes = Math.max(0, ...prizes.filter(p => p.reward_type === "minutes").map(p => p.reward_value));
  const catalogueCoins = Math.max(0, ...prizes.filter(p => p.reward_type === "coins").map(p => p.reward_value));
  const minutes = catalogueMinutes || (level === 2 ? 80 : 60);
  const coins = catalogueCoins || (level === 2 ? 1000 : 400);
  return <div className={styles.benefit} data-premium={level === 2}>
    <span className={styles.eyebrow}>TU COMPRA INCLUYE</span>
    <strong><Sparkles size={15}/> 1 GIRO NIVEL {level}</strong>
    <span className={styles.prizes}>✨ Hasta +{minutes} min <i/> 🪙 Hasta {coins.toLocaleString("es-ES")} Coins</span>
    <Link href={"/cliente/ruleta?nivel=" + level}>Ver ruleta <ArrowRight size={13}/></Link>
    <small>Se activa cuando tu compra queda confirmada.</small>
  </div>;
}
