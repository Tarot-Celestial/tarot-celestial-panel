"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { pointerTarget, scrollProgress, universeDestination } from "./universe-motion";
import type { UniverseController } from "./universe-renderer";
import TarotAtmosphere from "./TarotAtmosphere";
import styles from "./CelestialUniverse.module.css";

export { universeDestination } from "./universe-motion";
const MOTION_KEY = "tc-universe-motion";
const MotionContext = createContext<{ paused: boolean; available: boolean; toggle: () => void } | null>(null);

/** Keep the control in the page's existing modal/mascot stacking context. */
export function UniverseMotionControl() {
  const preference = useContext(MotionContext);
  if (!preference?.available) return null;
  return <button type="button" className={styles.motionControl} onClick={preference.toggle} aria-pressed={preference.paused} aria-label={preference.paused ? "Reanudar universo" : "Pausar universo"} title={preference.paused ? "Reanudar el movimiento del fondo" : "Pausar el movimiento del fondo"}>
    <span aria-hidden="true">{preference.paused ? "▷" : "Ⅱ"}</span><span>{preference.paused ? "Universo en pausa" : "Universo vivo"}</span>
  </button>;
}

export default function CelestialUniverse({ pathname, children }: { pathname: string; children?: ReactNode }) {
  const destination = universeDestination(pathname);
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<UniverseController | null>(null);
  const latest = useRef(destination);
  latest.current = destination;
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState<"loading" | "webgl" | "fallback">("loading");
  const motion = useRef(false);
  motion.current = preferencesReady && !reduced && !paused;

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const syncReduced = () => setReduced(preference.matches);
    const syncStored = () => { try { setPaused(localStorage.getItem(MOTION_KEY) === "paused"); } catch { /* Storage may be unavailable. */ } };
    syncReduced(); syncStored(); setPreferencesReady(true);
    preference.addEventListener("change", syncReduced);
    window.addEventListener("storage", syncStored);
    return () => { preference.removeEventListener("change", syncReduced); window.removeEventListener("storage", syncStored); };
  }, []);

  useEffect(() => {
    if (!preferencesReady || !host.current) return;
    const abort = new AbortController();
    const element = host.current;
    setStatus("loading");
    const measureScroll = () => controller.current?.setScroll(scrollProgress(window.scrollY, document.documentElement.scrollHeight, innerHeight));
    const resize = () => { controller.current?.resize(); measureScroll(); };
    const fine = matchMedia("(pointer: fine)");
    const pointer = (event: PointerEvent) => {
      if (!motion.current || !fine.matches || event.pointerType === "touch") return;
      const target = pointerTarget(event.clientX, event.clientY, innerWidth, innerHeight);
      controller.current?.setPointer(target.x, target.y);
    };
    const resetPointer = () => controller.current?.setPointer(0, 0);
    const visibility = () => {
      const shown = !document.hidden;
      setVisible(shown);
      controller.current?.setVisible(shown);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureScroll);
    observer?.observe(document.body);
    window.addEventListener("scroll", measureScroll, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", pointer, { passive: true });
    window.addEventListener("blur", resetPointer);
    document.addEventListener("visibilitychange", visibility);
    void import("./universe-renderer").then(({ createUniverseRenderer }) => {
      if (abort.signal.aborted) return null;
      return createUniverseRenderer({ host: element, destination: latest.current, motion: motion.current, signal: abort.signal, onStatus: ready => { if (!abort.signal.aborted) setStatus(ready ? "webgl" : "fallback"); } });
    }).then(instance => {
      if (!instance || abort.signal.aborted) return;
      controller.current = instance;
      instance.setDestination(latest.current);
      instance.setMotion(motion.current);
      visibility(); measureScroll();
    }).catch(() => { if (!abort.signal.aborted) setStatus("fallback"); });
    return () => {
      abort.abort(); controller.current = null; observer?.disconnect();
      window.removeEventListener("scroll", measureScroll); window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointer); window.removeEventListener("blur", resetPointer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [preferencesReady]);

  useEffect(() => { controller.current?.setDestination(destination); }, [destination]);
  useEffect(() => { controller.current?.setMotion(preferencesReady && !reduced && !paused); }, [preferencesReady, reduced, paused]);

  function toggleMotion() {
    const next = !paused;
    setPaused(next);
    try { localStorage.setItem(MOTION_KEY, next ? "paused" : "enabled"); } catch { /* Session preference still works. */ }
  }

  return <MotionContext.Provider value={{ paused, available: preferencesReady && !reduced && status !== "fallback", toggle: toggleMotion }}>
    <div className={styles.universe} data-celestial-universe="" data-destination={destination.name} data-renderer={status} data-motion={motion.current && visible && status === "webgl" ? "running" : "paused"} style={{ "--planet-glow": destination.color } as CSSProperties} aria-hidden="true">
      <div className={styles.sky} />
      <div className={styles.fallback} style={{ backgroundPosition: `${(destination.index % 4) * 100 / 3}% ${Math.floor(destination.index / 4) * 50}%` }} />
      <div ref={host} className={styles.canvas} />
      <TarotAtmosphere index={destination.index} />
      <div className={styles.shade} />
    </div>
    {children}
  </MotionContext.Provider>;
}
