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
  const tones = [
    "#6d28d9",
    "#17112f",
    "#8b46d7",
    "#26154f",
    "#a45ce0",
    "#321a68",
    "#9f7528",
  ];
  const segment = 360 / prizes.length;

  const jackpot = LEVEL_COPY[level].jackpot;
  return `conic-gradient(from ${-segment / 2}deg, ${prizes
    .map((prize, index) => {
      const tone = prize === jackpot ? "#9f7428" : tones[index % tones.length];
      return `${tone} ${index * segment}deg ${(index + 1) * segment}deg`;
    })
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
        const angle = index * (360 / prizes.length) + 360 / prizes.length / 2 - 90;
        const radians = (angle * Math.PI) / 180;
        return {
          prize,
          left: `${50 + Math.cos(radians) * 34}%`,
          top: `${50 + Math.sin(radians) * 34}%`,
        };
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
    <section className={styles.wrap} data-active={available > 0 ? "true" : "false"}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.ambientGlowOne} />
        <span className={styles.ambientGlowTwo} />
        <span className={styles.scanLine} />
        <span className={styles.starField} />
      </div>

      <div className={styles.topHud} aria-hidden="true">
        <span>CELESTIAL EXPERIENCE</span>
        <i />
        <b>ONLINE</b>
      </div>

      <div className={styles.head}>
        <div className={styles.headCopy}>
          <div className={styles.brandRow}>
            <span className={styles.brandOrb} aria-hidden="true"><i /></span>
            <div className={styles.kicker}>RULETA CELESTIAL</div>
          </div>
          <h2 className={styles.title}>Cada compra te regala 1 giro</h2>
          <p className={styles.copy}>
            El nivel del giro queda guardado con el pack comprado. Todos los giros tienen premio y los minutos ganados se añaden automáticamente a tu saldo.
          </p>
          <div className={styles.counter}>
            <span className={styles.counterIcon}>✦</span>
            <strong>{available}</strong>
            <span>{available === 1 ? "GIRO DISPONIBLE" : "GIROS DISPONIBLES"}</span>
          </div>
        </div>

        <div className={styles.orbitalHud} aria-hidden="true">
          <span className={styles.orbitOne} />
          <span className={styles.orbitTwo} />
          <span className={styles.orbitThree} />
          <strong>✦</strong>
        </div>
      </div>

      <div className={styles.levelGrid}>
        <div className={`${styles.levelCard} ${level === 1 && available > 0 ? styles.levelActive : ""}`}>
          <div className={styles.cardHudLine}><span>01</span><i /></div>
          <div className={styles.levelTitle}><span>✦</span><strong>NIVEL 1</strong></div>
          <span className={styles.levelMinutes}>10 · 20 · 30 min</span>
          <small>Premios +2, +3, +4, +5 · Premio especial +60 min</small>
          <em><i />{level1Spins} {level1Spins === 1 ? "giro pendiente" : "giros pendientes"}</em>
        </div>

        <div className={`${styles.levelCard} ${level === 2 && available > 0 ? styles.levelActive : ""}`}>
          <div className={styles.cardHudLine}><span>02</span><i /></div>
          <div className={styles.levelTitle}><span>✦</span><strong>NIVEL 2</strong></div>
          <span className={styles.levelMinutes}>40 · 50 · 60 min</span>
          <small>Premios +6, +8, +10, +12, +14, +16 · Premio especial +80 min</small>
          <em><i />{level2Spins} {level2Spins === 1 ? "giro pendiente" : "giros pendientes"}</em>
        </div>
      </div>

      <div className={styles.body}>
        <div className={`${styles.wheelStage} ${busy ? styles.wheelStageActive : ""}`}>
          <div className={styles.energyRail} aria-hidden="true">
            <span>ENERGÍA</span>
            <strong>{busy ? "100%" : available > 0 ? "86%" : "42%"}</strong>
            <i><b /></i>
          </div>

          <div className={styles.wheelHalo} aria-hidden="true">
            <span className={styles.haloOne} />
            <span className={styles.haloTwo} />
            <span className={styles.haloThree} />
          </div>

          <div className={styles.wheelBox}>
            <div className={styles.pointer}><i /></div>
            <div className={styles.wheelFrame} aria-hidden="true" />
            <div
              className={styles.wheel}
              style={{ transform: `rotate(${rotation}deg)`, background: wheelGradient(level) }}
            >
              <div className={styles.innerGrid} aria-hidden="true" />
              {labels.map(({ prize, left, top }) => (
                <span
                  key={prize}
                  className={styles.label}
                  style={{
                    left,
                    top,
                    transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
                  }}
                >
                  +{prize}
                </span>
              ))}
              <div className={styles.wheelCore} aria-hidden="true">
                <span>✦</span>
              </div>
            </div>
          </div>

          <div className={styles.platform} aria-hidden="true"><i /><b /></div>
        </div>

        <div className={styles.info}>
          <div className={styles.infoHudTop} aria-hidden="true">
            <span>PRÓXIMO EVENTO</span>
            <div><i /><i /><i /></div>
          </div>

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
                {prize === jackpot ? `✦ PREMIO ESPECIAL · +${prize} min` : `+${prize} min`}
              </span>
            ))}
          </div>

          <button
            className={styles.button}
            type="button"
            disabled={busy || available <= 0}
            onClick={() => void spin()}
          >
            <span>
              {busy
                ? "ACTIVANDO RULETA…"
                : available > 0
                  ? `GIRAR RULETA · NIVEL ${level}`
                  : "COMPRA PARA CONSEGUIR UN GIRO"}
            </span>
            <i aria-hidden="true">›</i>
          </button>

          {result ? (
            <div className={styles.result}>
              <span>✦</span>
              <div>
                <small>RECOMPENSA DESBLOQUEADA</small>
                Premio Nivel {result.level}: <strong>+{result.prize} minutos</strong>
                <p>Ya están añadidos automáticamente a tu cuenta.</p>
              </div>
            </div>
          ) : null}

          {message ? <div className={styles.message}>{message}</div> : null}

          <div className={styles.foot}>
            <span className={styles.securityDot} />
            Todos los giros tienen premio. Las recompensas se acreditan automáticamente en tu saldo al finalizar el giro.
          </div>
        </div>
      </div>

      <div className={styles.systemBar} aria-hidden="true">
        <span><i /> CELESTIAL OS <b>ONLINE</b></span>
        <span>SINCRONIZADO <i className={styles.pulseLine} /></span>
        <span>EXPERIENCIA SEGURA <b>ACTIVA</b></span>
      </div>
    </section>
  );
}
