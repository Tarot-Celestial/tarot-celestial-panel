"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./CelestialPortal.module.css";

const MOTION_KEY = "tc-universe-motion";
type PortalPreference = { running: boolean; paused: boolean; available: boolean; toggle: () => void };
const MotionContext = createContext<PortalPreference>({ running: false, paused: false, available: false, toggle: () => {} });
type ConnectionHints = EventTarget & { saveData?: boolean };
type NavigatorHints = Navigator & { deviceMemory?: number; connection?: ConnectionHints };

// Stable positions keep server markup and hydration identical, without random calls.
const STARS = Array.from({ length: 28 }, (_, index) => ({
  left: `${3 + (index * 37) % 94}%`,
  top: `${4 + (index * 19) % 82}%`,
  "--star-size": `${index % 7 === 0 ? 3 : 2}px`,
  "--star-duration": `${7 + index % 6}s`,
  "--star-delay": `${-index * 1.7}s`,
} as CSSProperties));

/** Shared with the home logo, which must follow the same visibility and motion policy. */
export function usePortalMotion(): { running: boolean } {
  const { running } = useContext(MotionContext);
  return { running };
}

/** Render in the content layer so dialogs and the mascot keep their normal stacking order. */
export function PortalMotionControl() {
  const { available, paused, toggle } = useContext(MotionContext);
  if (!available) return null;
  return <button type="button" className={styles.motionControl} onClick={toggle}
    aria-pressed={paused} aria-label={paused ? "Reanudar universo" : "Pausar universo"}
    title={paused ? "Reanudar el movimiento del portal" : "Pausar el movimiento del portal"}>
    <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>
    <span>{paused ? "Universo en pausa" : "Universo vivo"}</span>
  </button>;
}

function Galaxy() {
  return <svg viewBox="0 0 300 180" focusable="false" fill="none">
    <ellipse cx="150" cy="90" rx="78" ry="24" stroke="currentColor" strokeWidth="1.5" opacity=".5" />
    <ellipse cx="150" cy="90" rx="108" ry="36" stroke="currentColor" opacity=".18" />
    <path d="M150 90c-28-24-64-15-65 7-2 33 72 50 131 17 42-24 26-61-14-74M150 90c27 23 64 15 65-7 2-33-72-50-131-17-42 24-26 61 14 74" stroke="currentColor" strokeWidth="3" opacity=".35" />
    <ellipse cx="150" cy="90" rx="9" ry="5" fill="#f7dfad" opacity=".72" />
  </svg>;
}

function Constellation() {
  return <svg viewBox="0 0 240 200" focusable="false" fill="none">
    <path d="m24 122 52-76 55 33 61-44 25 110-86-66-27 96-80-53" stroke="currentColor" strokeWidth=".75" opacity=".48" />
    {[[24, 122], [76, 46], [131, 79], [192, 35], [217, 145], [104, 175]].map(([cx, cy]) =>
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" fill="currentColor" />)}
    <path d="M76 37v18m-9-9h18M192 28v14m-7-7h14" stroke="currentColor" strokeWidth=".8" />
  </svg>;
}

function ZodiacArch() {
  return <svg viewBox="0 0 1400 760" focusable="false" fill="none">
    <path d="M140 650a560 560 0 0 1 1120 0M158 650a542 542 0 0 1 1084 0" stroke="currentColor" strokeWidth=".7" opacity=".5" />
    <path d="M168 648a532 532 0 0 1 1064 0" stroke="currentColor" strokeWidth="3" strokeDasharray="1 45" opacity=".3" />
    <g stroke="currentColor" strokeWidth="1" opacity=".45">
      <path d="m190 450 10-17 10 17-10 17-10-17m101-180 12-20 12 20-12 20-12-20m182-127 12-15 12 15-12 15-12-15" />
      <path d="m1210 450-10-17-10 17 10 17 10-17m-101-180-12-20-12 20 12 20 12-20m-182-127-12-15-12 15 12 15 12-15" />
    </g>
  </svg>;
}

const DECORATIONS = <>
  <div className={`${styles.nebula} ${styles.nebulaLeft}`} />
  <div className={`${styles.nebula} ${styles.nebulaRight}`} />
  <div className={styles.stars}>{STARS.map((style, index) => <i key={index} className={styles.star} style={style} />)}</div>
  <div className={`${styles.galaxy} ${styles.galaxyLeft}`}><Galaxy /></div>
  <div className={`${styles.galaxy} ${styles.galaxyRight}`}><Galaxy /></div>
  <div className={`${styles.constellation} ${styles.constellationLeft}`}><Constellation /></div>
  <div className={`${styles.constellation} ${styles.constellationRight}`}><Constellation /></div>
  <div className={styles.zodiac}><ZodiacArch /></div>
  <div className={styles.moon}><div className={styles.moonShadow} /></div>
  <div className={`${styles.shootingStar} ${styles.shootingStarFirst}`} />
  <div className={`${styles.shootingStar} ${styles.shootingStarSecond}`} />
  <div className={styles.ship}>
    <svg viewBox="0 0 80 32" focusable="false" fill="none">
      <path d="m5 16 31-2" stroke="#a9dce8" strokeWidth="1" opacity=".48" />
      <path d="m20 16 19-1" stroke="#efddb6" strokeWidth="2" opacity=".45" />
      <path d="m33 16 10-7 28 7-28 7-10-7Z" fill="#b9c4d8" stroke="#f3d8a1" strokeWidth=".7" />
      <path d="m43 16-7-13 22 13-22 13 7-13Z" fill="#717f98" stroke="#d4c39c" strokeWidth=".6" />
      <path d="m47 16 13-2 11 2-11 2-13-2Z" fill="#f1ddae" />
    </svg>
  </div>
</>;

export default function CelestialPortal({ children }: { children?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [economy, setEconomy] = useState(false);
  const running = ready && !paused && !reduced && visible;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hints = navigator as NavigatorHints;
    const connection = hints.connection;
    const syncReduced = () => setReduced(preference.matches);
    const syncVisible = () => setVisible(!document.hidden);
    const syncStored = (event?: StorageEvent) => {
      if (event && event.key !== null && event.key !== MOTION_KEY) return;
      try { setPaused(window.localStorage.getItem(MOTION_KEY) === "paused"); } catch { /* Retain the in-memory preference when storage is unavailable. */ }
    };
    const syncEconomy = () => setEconomy(Boolean(connection?.saveData || (hints.deviceMemory && hints.deviceMemory < 4) || (hints.hardwareConcurrency && hints.hardwareConcurrency <= 2)));
    syncReduced(); syncVisible(); syncStored(); syncEconomy(); setReady(true);
    preference.addEventListener("change", syncReduced);
    document.addEventListener("visibilitychange", syncVisible);
    window.addEventListener("storage", syncStored);
    connection?.addEventListener?.("change", syncEconomy);
    return () => {
      preference.removeEventListener("change", syncReduced);
      document.removeEventListener("visibilitychange", syncVisible);
      window.removeEventListener("storage", syncStored);
      connection?.removeEventListener?.("change", syncEconomy);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !paused;
    setPaused(next);
    try { window.localStorage.setItem(MOTION_KEY, next ? "paused" : "enabled"); } catch { /* The session control still works without storage. */ }
  }, [paused]);

  useEffect(() => {
    const element = host.current;
    if (!running || economy || !element) return;
    const finePointer = window.matchMedia("(pointer: fine)");
    let frame: number | null = null;
    let x = 0;
    let y = 0;
    const paint = () => {
      frame = null;
      const scroll = Math.min(1, Math.max(0, window.scrollY / Math.max(1, window.innerHeight))) * 16;
      element.style.setProperty("--portal-x", `${x.toFixed(2)}px`);
      element.style.setProperty("--portal-y", `${y.toFixed(2)}px`);
      element.style.setProperty("--portal-scroll", `${scroll.toFixed(2)}px`);
    };
    // Coalesce events into one frame; paint never schedules another frame.
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(paint); };
    const pointer = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType === "touch") return;
      x = (Math.max(0, Math.min(1, event.clientX / Math.max(1, window.innerWidth))) - .5) * 12;
      y = (Math.max(0, Math.min(1, event.clientY / Math.max(1, window.innerHeight))) - .5) * 8;
      schedule();
    };
    const resetPointer = () => { x = 0; y = 0; schedule(); };
    window.addEventListener("pointermove", pointer, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("blur", resetPointer);
    schedule();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("blur", resetPointer);
    };
  }, [running, economy]);

  const context = useMemo(() => ({ running, paused, available: ready && !reduced, toggle }), [running, paused, ready, reduced, toggle]);
  return <MotionContext.Provider value={context}>
    <div ref={host} className={styles.portal} data-celestial-portal="" data-motion={running ? "running" : "paused"} data-quality={economy ? "economy" : "full"} aria-hidden="true">
      <div className={styles.parallax}>
        <div className={styles.sanctuary} />
        {DECORATIONS}
      </div>
      <div className={styles.shade} />
    </div>
    {children}
  </MotionContext.Provider>;
}
