"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { createRuneMotion, type RuneMotionController, type RuneMotionState } from "@/lib/rune-motion";
import styles from "./CrimsonRuneScene.module.css";

export default function CrimsonRuneScene({ className = "" }: { className?: string }) {
  const visual = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLCanvasElement>(null), front = useRef<HTMLCanvasElement>(null);
  const controller = useRef<RuneMotionController | null>(null);
  const [motion, setMotion] = useState<RuneMotionState>({ running: false, paused: false, reduced: false });
  const [touches, setTouches] = useState(0);
  const helpId = useId();

  useEffect(() => {
    if (!visual.current || !back.current || !front.current) return;
    const scene = createRuneMotion({
      host: visual.current, back: back.current, front: front.current,
      onState: next => setMotion(previous => previous.running === next.running && previous.paused === next.paused && previous.reduced === next.reduced ? previous : next),
    });
    controller.current = scene;
    return () => { scene.dispose(); controller.current = null; };
  }, []);

  return (
    <div className={`${styles.scene} ${className}`}>
      <div ref={visual} className={styles.visual} data-running="false" data-paused="false" data-reduced="false" data-motion="paused" data-particle-count="0">
        <div className={styles.halo} aria-hidden="true" />
        <div className={styles.groundLight} aria-hidden="true" />
        <div className={styles.base} aria-hidden="true">
          <Image src="/images/runas/obsidiana-carmesi-base.webp" alt="" fill sizes="(max-width: 600px) 280px, 400px" className={styles.art} />
        </div>
        <div className={styles.reflection} aria-hidden="true">
          <Image src="/images/runas/obsidiana-carmesi-stone.webp" alt="" fill sizes="(max-width: 600px) 100px, 150px" className={styles.art} />
        </div>
        <div className={styles.shadow} aria-hidden="true" />
        <canvas ref={back} className={styles.back} aria-hidden="true" />
        <button
          className={styles.stone}
          type="button"
          aria-label="Tocar la runa Obsidiana carmesí"
          aria-describedby={helpId}
          onClick={event => {
            const host = visual.current;
            if (!host) return;
            const bounds = host.getBoundingClientRect(), target = event.currentTarget.getBoundingClientRect();
            const x = event.detail === 0 ? target.left + target.width / 2 : event.clientX;
            const y = event.detail === 0 ? target.top + target.height / 2 : event.clientY;
            controller.current?.burst(x - bounds.left, y - bounds.top);
            setTouches(value => value + 1);
          }}
          onPointerMove={event => {
            if (event.pointerType !== "mouse") return;
            const bounds = event.currentTarget.getBoundingClientRect();
            controller.current?.tilt((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1);
          }}
          onPointerLeave={() => controller.current?.tilt(0, 0)}
        >
          <Image src="/images/runas/obsidiana-carmesi-stone.webp" alt="" fill sizes="(max-width: 600px) 190px, 280px" className={styles.art} priority draggable={false} />
        </button>
        <canvas ref={front} className={styles.front} aria-hidden="true" />
        <span className={styles.staticResponse} aria-hidden="true" />
      </div>
      <div className={styles.controls}>
        <p id={helpId}>Toca la runa<span className={styles.keyboardHelp}> o pulsa Intro o espacio</span></p>
        <button className={styles.pause} type="button" disabled={motion.reduced}
          aria-pressed={motion.paused} aria-label={motion.reduced ? "Movimiento reducido activado en tu dispositivo" : motion.paused ? "Reanudar animación de la runa" : "Pausar animación de la runa"}
          onClick={() => controller.current?.pause(!motion.paused)}>
          {motion.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          {motion.reduced ? "Movimiento reducido" : motion.paused ? "Reanudar" : "Pausar"}
        </button>
      </div>
      <p className={styles.response} role="status" aria-live="polite" aria-atomic="true">
        {touches > 0 ? <>La runa responde a tu toque.<span className={styles.keyboardHelp}> Interacción {touches}.</span></> : <span aria-hidden="true">&nbsp;</span>}
      </p>
    </div>
  );
}
