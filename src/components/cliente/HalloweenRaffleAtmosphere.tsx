"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "./HalloweenRaffleAtmosphere.module.css";

const MOTION_KEY = "tc-halloween-motion-paused-v1";
const BAT_PATH = "M60 26 54 17 52 28C43 16 25 8 5 11c11 9 17 17 18 27 7-5 14-4 19 5 6-5 11-4 14 4l4 8 4-8c3-8 8-9 14-4 5-9 12-10 19-5 1-10 7-18 18-27-20-3-38 5-47 17l-2-11Z";

type MotionPreference = { paused: boolean; reduced: boolean; ready: boolean; toggle: () => void };
const HalloweenMotion = createContext<MotionPreference | null>(null);

/** Kept in ClienteLayout so existing dialogs and the companion retain their stacking order. */
export function HalloweenRaffleMotionControl() {
  const motion = useContext(HalloweenMotion);
  if (!motion) return null;
  const label = motion.reduced ? "Movimiento reducido: fondo sin animación" : motion.paused ? "Reanudar ambiente de Halloween" : "Pausar ambiente de Halloween";
  return <button
    type="button"
    className={styles.motionControl}
    onClick={motion.toggle}
    disabled={!motion.ready || motion.reduced}
    aria-pressed={motion.paused || motion.reduced}
    aria-label={label}
    title={label}
  >
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      {motion.paused || motion.reduced ? <path d="m7 4 9 6-9 6Z" fill="currentColor" /> : <path d="M6 4v12M13 4v12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
    <span>{motion.reduced ? "Fondo en calma" : motion.paused ? "Reanudar ambiente" : "Pausar ambiente"}</span>
  </button>;
}

function Cobweb({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 240 240" fill="none" aria-hidden="true" focusable="false">
    <path d="M0 0v230M0 0l72 217M0 0l141 184M0 0l184 141M0 0l217 72M0 0h230" />
    <path d="M0 33q7-8 10-2 5-11 10-5 5-11 6-6 10-5 5-10 8-2 2-10M0 72q15-15 23-3 7-22 21-12 10-23 13-13 21-8 12-21 15-8 3-23M0 114q25-22 36-6 11-30 34-17 14-32 21-21 29-11 17-34 23-12 6-36M0 158q35-29 50-9 16-40 48-23 21-44 28-28 42-16 23-48 30-17 9-50M0 209q45-38 66-10 20-54 63-31 28-58 39-39 53-22 31-63 39-23 10-66" />
    <path d="M74 219 68 205M185 143l8 6M0 176l5 2" opacity=".4" />
  </svg>;
}

/** Decorative CSS-only scene: no timers, rendering loop, canvas, or gameplay state. */
export default function HalloweenRaffleAtmosphere({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReduced = () => setReduced(preference.matches);
    const syncVisibility = () => setDocumentVisible(!document.hidden);
    syncReduced();
    syncVisibility();
    try { setPaused(window.sessionStorage.getItem(MOTION_KEY) === "true"); } catch { /* Storage is optional. */ }
    setReady(true);
    preference.addEventListener("change", syncReduced);
    document.addEventListener("visibilitychange", syncVisibility);
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    }, { threshold: 0 }) : null;
    if (observer && host.current) observer.observe(host.current);
    else setVisible(true);
    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", syncReduced);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { window.sessionStorage.setItem(MOTION_KEY, String(paused)); } catch { /* Storage is optional. */ }
  }, [paused, ready]);
  const toggle = useCallback(() => setPaused(previous => !previous), []);
  const motion = useMemo(() => ({ paused, reduced, ready, toggle }), [paused, reduced, ready, toggle]);
  const running = ready && visible && documentVisible && !paused && !reduced;

  return <HalloweenMotion.Provider value={motion}>
    <div ref={host} className={styles.pageBackdrop} data-halloween-atmosphere="true" data-running={running} data-paused={paused} data-reduced={reduced}>
      <div className={styles.atmosphere} aria-hidden="true">
        <div className={styles.amberHalo} />
        <Cobweb className={`${styles.cobweb} ${styles.webLeft}`} />
        <Cobweb className={`${styles.cobweb} ${styles.webRight}`} />
        {[0, 1, 2, 3].map(index => <div className={styles.bat} data-halloween-bat={index + 1} key={index}>
          <svg viewBox="0 0 120 64" focusable="false" aria-hidden="true">
            <path d={BAT_PATH} className={styles.batBody} />
            <path d="M54 28 42 21 23 17M66 28l12-7 19-4M55 33 42 29 31 24M65 33l13-4 11-5" className={styles.batVeins} />
          </svg>
        </div>)}
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  </HalloweenMotion.Provider>;
}
