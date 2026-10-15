"use client";

import { useId, type CSSProperties } from "react";
import { RotateCw, Diamond, Crown, Moon, Sun, Flame, LockKeyhole } from "lucide-react";
import { type RouletteLevel, type RoulettePrize } from "@/lib/ruleta";
import RouletteRewardArt from "./RouletteRewardArt";
import styles from "./CelestialWheel.module.css";

export const WHEEL_SPIN_MS = 7200;
const NAMES = { 1: "Bronce Celestial", 2: "Plata Celestial", 3: "Corona Astral", 4: "Especial", 5: "Diamante" };
const EMBLEMS = { 1: Sun, 2: Moon, 3: Crown, 4: Flame, 5: Diamond };

function point(radius: number, angle: number) {
  return [500 + radius * Math.sin(angle), 500 - radius * Math.cos(angle)];
}

function capsule(index: number, count: number) {
  const step = 2 * Math.PI / count;
  const gap = Math.min(.025, step * .08);
  const start = index * step + gap, end = (index + 1) * step - gap;
  const outer = 463, inner = 177;
  const corner = Math.min(22, step * inner * .3);
  const large = end - start > Math.PI ? 1 : 0;
  const at = (radius: number, angle: number) => point(radius, angle).join(",");
  return "M" + at(outer - corner, start) + " Q" + at(outer, start) + " " + at(outer, start + corner / outer)
    + " A463,463 0 " + large + " 1 " + at(outer, end - corner / outer) + " Q" + at(outer, end) + " " + at(outer - corner, end)
    + " L" + at(inner + corner, end) + " Q" + at(inner, end) + " " + at(inner, end - corner / inner)
    + " A177,177 0 " + large + " 0 " + at(inner, start + corner / inner) + " Q" + at(inner, start) + " " + at(inner + corner, start) + " Z";
}

function value(prize: RoulettePrize, dense: boolean) {
  if (prize.reward_type === "minutes") return [String(prize.reward_value), "min"];
  if (prize.reward_type === "coins") return [String(prize.reward_value), "Coins"];
  if (prize.reward_type === "oracle_credits") return [String(prize.reward_value), dense ? "tir." : "Oráculo"];
  if (prize.reward_type === "streak_minutes") return [String(prize.meta?.daily_minutes || prize.reward_value), dense ? "min/día" : "min × " + String(prize.meta?.days_total || 7) + " días"];
  if (prize.reward_type === "rank") return dense ? ["Rango", ""] : [String(prize.meta?.rank || "Rango"), "Rango"];
  return [prize.reward_type === "ritual" ? "Ritual" : "Extra", "Premio"];
}

type Props = {
  prizes: RoulettePrize[];
  level: RouletteLevel;
  rotation: number;
  busy: boolean;
  spinning: boolean;
  pending: boolean;
  disabled: boolean;
  available: number | null;
  winner?: string;
  unavailableReason?: string;
  onSpin: () => void;
};

export default function CelestialWheel({ prizes, level, rotation, busy, spinning, pending, disabled, available, winner, unavailableReason, onSpin }: Props) {
  const id = useId().replace(/:/g, ""), Emblem = EMBLEMS[level];
  const count = prizes.length, dense = count > 9, title = level < 4 ? "Nivel " + level : NAMES[level];
  const blocked = busy || disabled;
  const label = busy ? (spinning ? "GIRANDO" : "PREPARANDO") : pending ? "COMPROBAR" : !count ? "SIN PREMIOS" : !available ? "SIN GIROS" : disabled ? "NO DISPONIBLE" : "GIRAR";

  return <div className={styles.experience} data-level={level} data-busy={busy} data-spinning={spinning}
    style={{ "--spin-time": WHEEL_SPIN_MS + "ms" } as CSSProperties}>
    <div className={styles.heading}>
      <span>{level < 4 ? "RULETA NIVEL " + level : "RULETA " + NAMES[level].toUpperCase()}</span>
      <h3>{NAMES[level]}</h3>
      <p>{available ?? "—"} {available === 1 ? "giro disponible" : "giros disponibles"}</p>
    </div>

    <div className={styles.orbit} data-dense={dense} data-empty={!count}>
      <div className={styles.halo} aria-hidden="true" />
      <div className={styles.celestialOrbit} aria-hidden="true"><i /><i /></div>
      <img className={styles.pedestal} src="/images/roulette/orb-pedestal.webp" alt="" width="1400" height="467" decoding="async" aria-hidden="true" />

      <div className={styles.rotor} style={{ transform: "rotate(" + rotation + "deg)" }} aria-hidden="true">
        <svg className={styles.glass} viewBox="0 0 1000 1000" focusable="false">
          <defs>
            <radialGradient id={id + "glass"} cx=".4" cy=".15" r=".9">
              <stop stopColor="var(--glass-light)" stopOpacity=".92" />
              <stop offset=".45" stopColor="var(--glass-mid)" stopOpacity=".85" />
              <stop offset="1" stopColor="var(--glass-dark)" stopOpacity=".96" />
            </radialGradient>
            <linearGradient id={id + "edge"} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#fff6dd" /><stop offset=".27" stopColor="#c3a77b" />
              <stop offset=".5" stopColor="#fff1d3" /><stop offset=".76" stopColor="#a78b69" />
              <stop offset="1" stopColor="#f2dfbc" />
            </linearGradient>
            <pattern id={id + "stars"} width="173" height="179" patternUnits="userSpaceOnUse">
              <circle cx="19" cy="31" r="1.1" fill="#fff6e1" opacity=".7" />
              <circle cx="97" cy="12" r="1.8" fill="#e3d5ff" opacity=".65" />
              <circle cx="147" cy="92" r="1.1" fill="#b4deff" opacity=".85" />
              <circle cx="43" cy="132" r="1.4" fill="#fbecff" opacity=".55" />
              <circle cx="112" cy="156" r=".8" fill="#fff" opacity=".8" />
              <path d="M82 74v8m-4-4h8" stroke="#f4e4ff" strokeWidth=".8" opacity=".5" />
            </pattern>
          </defs>
          <circle cx="500" cy="500" r="493" fill="var(--glass-dark)" fillOpacity=".64" stroke={"url(#" + id + "edge)"} strokeWidth="3" />
          <circle cx="500" cy="500" r="479" fill="none" stroke="#d6ccff" strokeWidth="2" opacity=".65" />
          {prizes.map((prize, index) => <g key={prize.id} data-winner={winner === prize.id} className={styles.capsule}>
            <path d={capsule(index, count)} fill={"url(#" + id + "glass)"} stroke={"url(#" + id + "edge)"} strokeWidth="3.2" strokeLinejoin="round" />
            <path d={capsule(index, count)} fill={"url(#" + id + "stars)"} />
          </g>)}
          {Array.from({ length: 8 }, (_, index) => {
            const [x, y] = point(487, index * Math.PI / 4);
            return <path key={index} d={`M${x} ${y - 11} Q${x + 2} ${y - 2} ${x + 9} ${y} Q${x + 2} ${y + 2} ${x} ${y + 11} Q${x - 2} ${y + 2} ${x - 9} ${y} Q${x - 2} ${y - 2} ${x} ${y - 11}`} fill="#fff0cd" />;
          })}
        </svg>

        {prizes.map((prize, index) => {
          const angle = (index + .5) * 2 * Math.PI / count, [main, sub] = value(prize, dense);
          return <span key={prize.id} className={styles.treasure} data-winner={winner === prize.id} data-long={main.length > 5}
            style={{ left: (50 + 29.5 * Math.sin(angle)) + "%", top: (50 - 29.5 * Math.cos(angle)) + "%", width: Math.min(17, 155 / count) + "%", transform: "translate(-50%,-50%) rotate(" + (-rotation) + "deg)" }}>
            <RouletteRewardArt type={prize.reward_type} /><b>{main}</b><small>{sub}</small>
          </span>;
        })}
      </div>

      <img className={styles.shell} src="/images/roulette/orb-shell.webp" alt="" width="1100" height="1100" decoding="async" aria-hidden="true" />
      <div className={styles.reflection} aria-hidden="true" />
      <svg className={styles.pointer} viewBox="0 0 80 152" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id + "crystal"} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f9f2ff" /><stop offset=".4" stopColor="#c6adff" /><stop offset="1" stopColor="#6742b0" /></linearGradient>
        </defs>
        <path d="M40 3 75 58 40 148 5 58Z" fill={"url(#" + id + "crystal)"} stroke="#fff0db" strokeWidth="2" />
        <path d="m40 3-9 55 9 90 10-90Z" fill="#f8f0ff" fillOpacity=".72" />
        <path d="M5 58 40 77 75 58M40 3 40 148M31 58 40 77 50 58" fill="none" stroke="#f9f0ff" strokeWidth="1.4" />
        <path d="m40 3 35 55-25 0Z" fill="#6b49bd" fillOpacity=".55" />
      </svg>

      <button type="button" className={styles.center} disabled={blocked} onClick={onSpin} data-roulette-spin="center" data-leo-anchor={pending ? "roulette-recovery" : undefined}
        aria-busy={busy} aria-describedby={id + "status"}
        aria-label={busy ? "Confirmando giro de " + title : pending ? "Comprobar giro pendiente" : disabled ? (unavailableReason || "Ruleta no disponible") : "Girar ruleta " + title}>
        {busy ? <RotateCw /> : disabled ? <LockKeyhole /> : level === 5 ? <RouletteRewardArt type="perk" className={styles.emblemArt} /> : level === 3 ? <RouletteRewardArt type="rank" className={styles.emblemArt} /> : <Emblem />}
        <strong>{label}</strong>
        <small>{title}</small>
      </button>
    </div>

    <div id={id + "status"} className={styles.status} role="status" aria-live="polite">
      {busy ? (spinning ? "La rueda está revelando tu premio…" : "Confirmando tu giro…") : winner ? "Tu premio ya está listo" : pending ? "Recupera tu resultado sin gastar otro giro" : disabled ? (unavailableReason || "Consulta la disponibilidad de esta ruleta") : "Pulsa GIRAR en el centro · Usa 1 giro"}
    </div>
  </div>;
}
