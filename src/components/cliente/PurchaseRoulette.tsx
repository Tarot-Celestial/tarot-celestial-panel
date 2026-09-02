"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./PurchaseRoulette.module.css";

type RouletteLevel = 1 | 2;

const PRIZES: Record<RouletteLevel, number[]> = {
  1: [2, 3, 4, 5, 60],
  2: [6, 8, 10, 12, 14, 16, 80],
};

const LEVEL_COPY: Record<RouletteLevel, { purchases: string; jackpot: number }> = {
  1: { purchases: "Compras de 10, 20 y 30 min", jackpot: 60 },
  2: { purchases: "Compras de 40, 50 y 60 min", jackpot: 80 },
};

const sb = supabaseClienteBrowser();

function wheelGradient(level: RouletteLevel) {
  const prizes = PRIZES[level];
  const tones = ["#5a2a86", "#23123f", "#7a3da8", "#2c184b", "#9150b7", "#35205c", "#bb8d35"];
  const segment = 360 / prizes.length;
  return `conic-gradient(from ${-segment / 2}deg, ${prizes
    .map((_, index) => `${tones[index % tones.length]} ${index * segment}deg ${(index + 1) * segment}deg`)
    .join(",")})`;
}

export default function PurchaseRoulette({ onReward }: { onReward?: () => void | Promise<void> }) {
  const [available, setAvailable] = useState(0);
  const [level1Spins, setLevel1Spins] = useState(0);
  const [level2Spins, setLevel2Spins] = useState(0);
  const [level, setLevel] = useState<RouletteLevel>(1);
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<{ prize: number; level: RouletteLevel } | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/cliente/ruleta", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      const nextAvailable = Number(json.available_spins || 0);
      setAvailable(nextAvailable);
      setLevel1Spins(Number(json.level_1_spins || 0));
      setLevel2Spins(Number(json.level_2_spins || 0));
      if (nextAvailable > 0) setLevel(Number(json.next_level || 1) === 2 ? 2 : 1);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const prizes = PRIZES[level];
  const labels = useMemo(
    () =>
      prizes.map((prize, index) => {
        const angle = index * (360 / prizes.length) + 360 / prizes.length / 2;
        return { prize, transform: `rotate(${angle}deg) translateX(32%) rotate(90deg)` };
      }),
    [prizes],
  );

  async function spin() {
    try {
      setBusy(true);
      setMessage("");
      setResult(null);
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión no válida");

      const res = await fetch("/api/cliente/ruleta", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        throw new Error(
          json?.error === "SIN_GIROS_DISPONIBLES"
            ? "No tienes giros pendientes."
            : json?.error || "No se pudo girar la ruleta",
        );
      }

      const prize = Number(json.prize_minutes);
      const awardedLevel: RouletteLevel = Number(json.spin_level || 1) === 2 ? 2 : 1;
      const spinPrizes = PRIZES[awardedLevel];
      const index = Math.max(0, spinPrizes.indexOf(prize));
      const segment = 360 / spinPrizes.length;
      const center = index * segment + segment / 2;

      if (level !== awardedLevel) setLevel(awardedLevel);
      setRotation((prev) => prev + 5 * 360 + (360 - center));
      setAvailable(Number(json.available_spins || 0));
      setLevel1Spins(Number(json.level_1_spins || 0));
      setLevel2Spins(Number(json.level_2_spins || 0));

      window.setTimeout(() => {
        setResult({ prize, level: awardedLevel });
        if (Number(json.available_spins || 0) > 0) {
          setLevel(Number(json.next_level || 1) === 2 ? 2 : 1);
          setRotation(0);
        }
        setBusy(false);
        void onReward?.();
      }, 4300);
    } catch (error: any) {
      setMessage(error?.message || "No se pudo girar la ruleta");
      setBusy(false);
      void load();
    }
  }

  const jackpot = LEVEL_COPY[level].jackpot;

  return (
    <section className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <div className={styles.kicker}>RULETA CELESTIAL</div>
          <h2 className={styles.title}>Cada compra te regala 1 giro</h2>
          <p className={styles.copy}>
            El nivel del giro queda guardado con el pack comprado. Todos los giros tienen premio y los minutos ganados se añaden automáticamente a tu saldo.
          </p>
        </div>
        <div className={styles.counter}>
          {available} {available === 1 ? "GIRO DISPONIBLE" : "GIROS DISPONIBLES"}
        </div>
      </div>

      <div className={styles.levelGrid}>
        <div className={`${styles.levelCard} ${level === 1 && available > 0 ? styles.levelActive : ""}`}>
          <strong>NIVEL 1</strong>
          <span>10 · 20 · 30 min</span>
          <small>Premios +2, +3, +4, +5 · Especial +60 min (5%)</small>
          <em>{level1Spins} {level1Spins === 1 ? "giro pendiente" : "giros pendientes"}</em>
        </div>
        <div className={`${styles.levelCard} ${level === 2 && available > 0 ? styles.levelActive : ""}`}>
          <strong>NIVEL 2</strong>
          <span>40 · 50 · 60 min</span>
          <small>Premios +6, +8, +10, +12, +14, +16 · Especial +80 min (5%)</small>
          <em>{level2Spins} {level2Spins === 1 ? "giro pendiente" : "giros pendientes"}</em>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.wheelBox}>
          <div className={styles.pointer} />
          <div
            className={styles.wheel}
            style={{ transform: `rotate(${rotation}deg)`, background: wheelGradient(level) }}
          >
            {labels.map(({ prize, transform }) => (
              <span key={prize} className={styles.label} style={{ transform }}>
                {prize}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.info}>
          <div className={styles.currentLevel}>
            <span>PRÓXIMO GIRO</span>
            <strong>Nivel {level}</strong>
            <small>{LEVEL_COPY[level].purchases}</small>
          </div>
          <div className={styles.prizes}>
            {prizes.map((prize) => (
              <span
                key={prize}
                className={`${styles.prize} ${prize === jackpot ? styles.prizeJackpot : ""}`}
              >
                +{prize} min{prize === jackpot ? " · ESPECIAL 5%" : ""}
              </span>
            ))}
          </div>
          <button
            className={styles.button}
            type="button"
            disabled={busy || available <= 0}
            onClick={() => void spin()}
          >
            {busy
              ? "GIRANDO…"
              : available > 0
                ? `GIRAR RULETA · NIVEL ${level}`
                : "COMPRA PARA CONSEGUIR UN GIRO"}
          </button>
          {result ? (
            <div className={styles.result}>
              ✨ Premio Nivel {result.level}: <strong>+{result.prize} minutos</strong>. Ya están añadidos a tu cuenta.
            </div>
          ) : null}
          {message ? <div className={styles.result}>{message}</div> : null}
          <div className={styles.foot}>
            El premio especial tiene un 5% real de probabilidad. El 95% restante se reparte por igual entre los premios normales de cada nivel.
          </div>
        </div>
      </div>
    </section>
  );
}
