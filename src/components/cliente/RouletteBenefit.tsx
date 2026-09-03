"use client";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import type { RouletteSummary } from "@/lib/ruleta";
import styles from "./RouletteBenefit.module.css";

export default function RouletteBenefit({ amount, summary }: { amount: number; summary: RouletteSummary | null }) {
  if (!summary) return <Link className={styles.benefit} href="/cliente/ruleta">Consultar beneficios de Ruleta <ArrowRight size={14}/></Link>;
  const level = amount >= Number(summary.level_2_from) ? 2 : 1;
  const prizes = summary.catalogue.filter(p => p.nivel === level);
  const minutes = Math.max(0, ...prizes.filter(p => p.reward_type === "minutes").map(p => p.reward_value));
  const coins = Math.max(0, ...prizes.filter(p => p.reward_type === "coins").map(p => p.reward_value));
  return <div className={styles.benefit} data-premium={level === 2}>
    <strong><Sparkles size={15}/> INCLUYE 1 GIRO NIVEL {level}</strong>
    <span>Premios de hasta +{minutes} minutos o {coins} Coins</span>
    <Link href={"/cliente/ruleta?nivel=" + level}>Ver ruleta <ArrowRight size={13}/></Link>
    <small>Se activa cuando tu compra queda confirmada.</small>
  </div>;
}
