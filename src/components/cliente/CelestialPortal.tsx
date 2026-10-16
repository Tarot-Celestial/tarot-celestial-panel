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

// Use the supplied nebula as a responsive, lightweight image; motion is CSS-only.
const SCENERY = <div className={styles.scene} data-portal-scene="nebula">
  <img className={styles.nebulaImage} src="/images/portal/client-nebula.webp" alt=""
    width={720} height={1280} decoding="async" loading="eager" draggable={false} />
</div>;

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

// Sparse branded meteors stay behind the UI and never receive pointer events.
const METEORS = [
  { top: "13%", duration: "34s", delay: "1s", size: "30px" },
  { top: "54%", duration: "43s", delay: "14s", size: "23px" },
  { top: "30%", duration: "53s", delay: "27s", size: "26px" },
];
const DECORATIONS = <>
  <div className={styles.stars}>{STARS.map((style, index) => <i key={index} className={styles.star} style={style} />)}</div>
  <div className={styles.meteors}>{METEORS.map((meteor, index) =>
    <div key={index} className={styles.brandMeteor} data-portal-meteor="" style={{
      top: meteor.top, "--meteor-duration": meteor.duration, "--meteor-delay": meteor.delay,
      "--meteor-size": meteor.size,
    } as CSSProperties}>
      <span className={styles.meteorTrail} />
      <img src="/images/portal/brand-meteor.webp" alt="" width={40} height={40} decoding="async" draggable={false} />
    </div>
  )}</div>
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
        {SCENERY}
        <div className={styles.skyMotion}>{DECORATIONS}</div>
      </div>
      <div className={styles.shade} />
    </div>
    {children}
  </MotionContext.Provider>;
}
