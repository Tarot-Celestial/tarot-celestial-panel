"use client";

import Link from "next/link";
import { Eye, EyeOff, Sparkles, Volume2, VolumeX } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  isLeoCelestialEventDetail, LEO_CELESTIAL_EVENT,
  type LeoCelestialEventDetail, type LeoCelestialReaction,
} from "@/lib/leo-celestial-events";
import { leoContextForPath, type LeoPersonalizedRecommendation } from "@/lib/leo-celestial-intelligence";
import {
  getLeoContextTips, getLeoMessageVariants,
  type LeoPersonalityMessage, type LeoPose,
} from "@/lib/leo-celestial-personality";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./LeoCelestialGuide.module.css";

const STORAGE_KEY = "tc-leo-celestial-v1";
const MESSAGE_ROTATION_KEY = "tc-leo-message-rotation-v1";
const TIP_ROTATION_KEY = "tc-leo-tip-rotation-v1";
const PROMOTION_ANCHOR = "[data-leo-anchor='promotion-featured'], [data-leo-anchor='active-promotion']";
const DESKTOP_QUERY = "(min-width: 900px)";
const IDLE_DELAY = 45_000;
const BUBBLE_VISIBLE_MS = 7_000;

type Props = { promoActive: boolean };
type AnchorPosition = { left: number; top: number };
type JourneyPhase = "idle" | "departing" | "travelling" | "arrived";
type LeoSignal = {
  action: "visit" | "interaction" | "preference";
  pathname: string;
  context?: string;
  hidden?: boolean;
  muted?: boolean;
};

const REACTION_LABELS: Record<LeoCelestialReaction, string> = {
  purchase: "BENEFICIOS ACREDITADOS", roulette: "PREMIO CONFIRMADO",
  coins: "CANJE COMPLETADO", oracle: "EL ORÁCULO HA HABLADO",
  gift: "REGALO CELESTIAL", promotion: "NOVEDAD ACTIVA",
};

function reactionMood(reaction: LeoCelestialReaction): LeoPersonalityMessage["mood"] {
  if (reaction === "oracle") return "oracle";
  if (reaction === "promotion") return "promo";
  return "reward";
}

function reactionPose(reaction: LeoCelestialReaction): LeoPose {
  if (reaction === "oracle") return "oracle";
  if (reaction === "promotion") return "guide";
  return "proud";
}

function nextSessionIndex(storageKey: string, itemKey: string, length: number) {
  if (length <= 1) return 0;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey) || "{}") as Record<string, number>;
    const previous = Number(stored[itemKey]);
    const next = Number.isInteger(previous) ? (previous + 1) % length : 0;
    stored[itemKey] = next;
    window.sessionStorage.setItem(storageKey, JSON.stringify(stored));
    return next;
  } catch { return 0; }
}

function LeoHologram() {
  return (
    <svg className={styles.hologramLion} viewBox="0 0 96 96" role="img" aria-label="Leo Celestial">
      <g className={styles.holoBody}>
        <path className={styles.holoTail} d="M68 55c13-4 16 7 9 13-3 3-7 2-8-1" />
        <path d="M31 52c5-9 28-11 38 0 5 6 3 17-3 21H34c-8-5-9-14-3-21Z" />
        <path className={styles.holoLegBack} d="M38 68v14m-5 0h10" />
        <path className={styles.holoLegFront} d="M61 68v14m-5 0h10" />
      </g>
      <g className={styles.holoHead}>
        <path className={styles.holoMane} d="M27 30c-1-10 8-19 21-19s23 9 22 20c5 5 4 14-2 18-2 9-10 15-20 15S30 58 28 49c-7-4-7-14-1-19Z" />
        <path className={styles.holoEar} d="M33 24 27 15c8-1 12 3 13 8m23 1 6-9c-8-1-12 3-13 8" />
        <path className={styles.holoFace} d="M37 28c5-5 17-5 22 0 5 5 4 18-1 23-5 5-15 5-20 0-6-6-6-17-1-23Z" />
        <path className={styles.holoEyes} d="M40 36h4m8 0h4" />
        <path className={styles.holoMuzzle} d="m45 43 3 2 3-2m-3 2v5m-5 0c3 3 7 3 10 0" />
      </g>
      <path className={styles.holoScan} d="M17 39h62M22 50h54M27 61h44" />
    </svg>
  );
}

export default function LeoCelestialGuide({ promoActive }: Props) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [attention, setAttention] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const [anchor, setAnchor] = useState<AnchorPosition | null>(null);
  const [roamPosition, setRoamPosition] = useState<AnchorPosition | null>(null);
  const [journey, setJourney] = useState<JourneyPhase>("idle");
  const [activeEvent, setActiveEvent] = useState<LeoCelestialEventDetail | null>(null);
  const [contextTip, setContextTip] = useState<LeoPersonalityMessage | null>(null);
  const [personalizedGuide, setPersonalizedGuide] = useState<LeoPersonalizedRecommendation | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(true);
  const [routeGuide, setRouteGuide] = useState<LeoPersonalityMessage>(() => getLeoMessageVariants(pathname, promoActive)[0]);
  const [expression, setExpression] = useState<"neutral" | "survey" | "curious">("neutral");
  const [pageVisible, setPageVisible] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [finePointer, setFinePointer] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const guideRef = useRef<HTMLElement>(null);
  const movementTimers = useRef<number[]>([]);
  const eventTimer = useRef<number | null>(null);
  const eventAttentionTimer = useRef<number | null>(null);
  const lastEventId = useRef("");
  const effectivePosition = anchor || roamPosition;
  const guide = useMemo<LeoPersonalityMessage>(() => activeEvent ? {
    title: activeEvent.title, message: activeEvent.message,
    mood: reactionMood(activeEvent.reaction), pose: reactionPose(activeEvent.reaction),
    href: activeEvent.href, actionLabel: activeEvent.actionLabel,
  } : contextTip || personalizedGuide || routeGuide, [activeEvent, contextTip, personalizedGuide, routeGuide]);

  const clearMovementTimers = useCallback(() => {
    movementTimers.current.forEach(window.clearTimeout);
    movementTimers.current = [];
  }, []);

  const sendSignal = useCallback(async (signal: LeoSignal) => {
    try {
      const { data } = await supabaseClienteBrowser().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      const response = await fetch("/api/cliente/leo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(signal),
      });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  }, []);

  const locatePromotion = useCallback((force = false, animate = false) => {
    if (pathname !== "/cliente/precios-ofertas" || !promoActive || !window.matchMedia(DESKTOP_QUERY).matches) {
      setAnchor(null);
      return;
    }
    const target = document.querySelector<HTMLElement>(PROMOTION_ANCHOR);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const visible = rect.bottom > 96 && rect.top < window.innerHeight - 72;
    if (!visible && !force) { setAnchor(null); setJourney("idle"); return; }
    const next = {
      left: Math.round(Math.min(Math.max(238, rect.left + rect.width / 2 - 32), window.innerWidth - 76)),
      top: Math.round(Math.min(Math.max(90, rect.top - 78), window.innerHeight - 96)),
    };
    const place = () => setAnchor((current) => current && Math.abs(current.left - next.left) < 2 && Math.abs(current.top - next.top) < 2 ? current : next);
    if (!animate || !motionEnabled) { place(); return; }
    clearMovementTimers();
    setJourney("departing");
    movementTimers.current.push(window.setTimeout(() => { setJourney("travelling"); place(); }, 170));
    movementTimers.current.push(window.setTimeout(() => setJourney("arrived"), 1_850));
    movementTimers.current.push(window.setTimeout(() => setJourney("idle"), 2_450));
  }, [clearMovementTimers, motionEnabled, pathname, promoActive]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as { hidden?: boolean; minimized?: boolean; muted?: boolean };
      setHidden(Boolean(stored.hidden ?? stored.minimized));
      setMuted(Boolean(stored.muted));
    } catch { /* El almacenamiento local es opcional. */ }
    setReady(true);
  }, []);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const pointerQuery = window.matchMedia("(pointer: fine)");
    const compactQuery = window.matchMedia("(max-width: 480px), (max-height: 560px)");
    const syncPreferences = () => {
      setMotionEnabled(motionQuery.matches);
      setFinePointer(pointerQuery.matches);
      setCompactViewport(compactQuery.matches);
    };
    const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
    syncPreferences(); syncVisibility();
    motionQuery.addEventListener("change", syncPreferences);
    pointerQuery.addEventListener("change", syncPreferences);
    compactQuery.addEventListener("change", syncPreferences);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      motionQuery.removeEventListener("change", syncPreferences);
      pointerQuery.removeEventListener("change", syncPreferences);
      compactQuery.removeEventListener("change", syncPreferences);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sendSignal({ action: "visit", pathname, context: leoContextForPath(pathname) }).then((payload) => {
      if (cancelled || !payload?.ok) return;
      if (payload.profile) {
        const next = { hidden: Boolean(payload.profile.hidden), muted: Boolean(payload.profile.muted) };
        setHidden(next.hidden); setMuted(next.muted);
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* optional */ }
      }
      setPersonalizedGuide(payload.recommendation || null);
    });
    return () => { cancelled = true; };
  }, [pathname, sendSignal]);

  useEffect(() => {
    const variants = getLeoMessageVariants(pathname, promoActive, new Date().getHours());
    const key = `${pathname}:${promoActive ? "promo" : "standard"}`;
    setRouteGuide(variants[nextSessionIndex(MESSAGE_ROTATION_KEY, key, variants.length)]);
    setContextTip(null);
  }, [pathname, promoActive]);

  useEffect(() => {
    setAttention(true);
    setBubbleOpen(true);
    const timer = window.setTimeout(() => setAttention(false), 2_400);
    const bubbleTimer = window.setTimeout(() => setBubbleOpen(false), BUBBLE_VISIBLE_MS);
    return () => { window.clearTimeout(timer); window.clearTimeout(bubbleTimer); };
  }, [pathname, promoActive]);

  useEffect(() => {
    const react = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isLeoCelestialEventDetail(detail) || (detail.id && detail.id === lastEventId.current)) return;
      lastEventId.current = detail.id || "";
      if (eventTimer.current) window.clearTimeout(eventTimer.current);
      if (eventAttentionTimer.current) window.clearTimeout(eventAttentionTimer.current);
      setSleeping(false); setContextTip(null); setActiveEvent(detail); setAttention(true); setBubbleOpen(true);
      eventAttentionTimer.current = window.setTimeout(() => setAttention(false), 2_400);
      eventTimer.current = window.setTimeout(() => { setActiveEvent(null); setBubbleOpen(false); }, Math.min(12_000, Math.max(4_000, Number(detail.duration) || 7_000)));
    };
    window.addEventListener(LEO_CELESTIAL_EVENT, react);
    return () => {
      window.removeEventListener(LEO_CELESTIAL_EVENT, react);
      if (eventTimer.current) window.clearTimeout(eventTimer.current);
      if (eventAttentionTimer.current) window.clearTimeout(eventAttentionTimer.current);
    };
  }, []);

  useEffect(() => {
    if (activeEvent || sleeping || muted || hidden || !pageVisible) return;
    const tips = getLeoContextTips(pathname, promoActive);
    if (!tips.length) return;
    const routeKey = `${pathname}:${promoActive ? "promo" : "standard"}`;
    const timer = window.setTimeout(() => {
      setContextTip(tips[nextSessionIndex(TIP_ROTATION_KEY, routeKey, tips.length)]);
      setAttention(true);
      setBubbleOpen(true);
    }, 12_000);
    const attentionTimer = window.setTimeout(() => setAttention(false), 14_400);
    const dismissTimer = window.setTimeout(() => { setContextTip(null); setBubbleOpen(false); }, 20_000);
    return () => { window.clearTimeout(timer); window.clearTimeout(attentionTimer); window.clearTimeout(dismissTimer); };
  }, [activeEvent, hidden, muted, pageVisible, pathname, promoActive, sleeping]);

  useEffect(() => {
    if (activeEvent || sleeping || journey !== "idle" || !motionEnabled || !pageVisible) { setExpression("neutral"); return; }
    let expressionTimer = 0;
    let resetTimer = 0;
    let nextExpression: "survey" | "curious" = "survey";
    const schedule = () => {
      expressionTimer = window.setTimeout(() => {
        setExpression(nextExpression);
        nextExpression = nextExpression === "survey" ? "curious" : "survey";
        resetTimer = window.setTimeout(() => { setExpression("neutral"); schedule(); }, 2_200);
      }, 8_800);
    };
    schedule();
    return () => { window.clearTimeout(expressionTimer); window.clearTimeout(resetTimer); };
  }, [activeEvent, journey, motionEnabled, pageVisible, pathname, sleeping]);

  useEffect(() => {
    if (!pageVisible) { clearMovementTimers(); setJourney("idle"); return; }
    const initialTimer = window.setTimeout(() => locatePromotion(false, true), 260);
    let frame = 0;
    const refresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; locatePromotion(); });
    };
    const target = document.querySelector<HTMLElement>(PROMOTION_ANCHOR);
    const observer = target && "ResizeObserver" in window ? new ResizeObserver(refresh) : null;
    if (target && observer) observer.observe(target);
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      window.clearTimeout(initialTimer);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      clearMovementTimers();
    };
  }, [clearMovementTimers, locatePromotion, pageVisible]);

  useEffect(() => {
    if (!motionEnabled || !finePointer || !pageVisible || hidden || activeEvent) { setRoamPosition(null); return; }
    let point = 0;
    const move = () => {
      const points = [
        { left: Math.max(238, window.innerWidth - 82), top: Math.max(92, window.innerHeight - 104) },
        { left: Math.max(238, Math.round(window.innerWidth * .58)), top: Math.max(110, Math.round(window.innerHeight * .62)) },
        { left: Math.max(238, window.innerWidth - 104), top: 112 },
        { left: Math.max(238, Math.round(window.innerWidth * .4)), top: Math.max(130, Math.round(window.innerHeight * .38)) },
      ];
      const next = points[point % points.length];
      point += 1;
      clearMovementTimers(); setAnchor(null); setBubbleOpen(false); setJourney("departing");
      movementTimers.current.push(window.setTimeout(() => { setJourney("travelling"); setRoamPosition(next); }, 170));
      movementTimers.current.push(window.setTimeout(() => setJourney("arrived"), 1_850));
      movementTimers.current.push(window.setTimeout(() => setJourney("idle"), 2_450));
    };
    const initial = window.setTimeout(move, 3_500);
    const interval = window.setInterval(move, 9_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); clearMovementTimers(); };
  }, [activeEvent, clearMovementTimers, finePointer, hidden, motionEnabled, pageVisible, pathname]);

  useEffect(() => {
    if (!pageVisible) { setSleeping(true); return; }
    let idleTimer = 0;
    const wake = () => {
      setSleeping(false); window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setSleeping(true), IDLE_DELAY);
    };
    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, wake, { passive: true }));
    wake();
    return () => { window.clearTimeout(idleTimer); activityEvents.forEach((eventName) => window.removeEventListener(eventName, wake)); };
  }, [pageVisible, pathname]);

  useEffect(() => {
    if (!pageVisible || !motionEnabled || !finePointer || hidden) return;
    let frame = 0; let pointerX = 0; let pointerY = 0;
    const followPointer = (event: PointerEvent) => {
      pointerX = event.clientX; pointerY = event.clientY;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const element = guideRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const x = Math.min(2.2, Math.max(-2.2, (pointerX - (rect.left + rect.width * .82)) / 140));
        const y = Math.min(1.5, Math.max(-1.5, (pointerY - (rect.top + rect.height * .24)) / 170));
        element.style.setProperty("--leo-gaze-x", `${x.toFixed(2)}px`);
        element.style.setProperty("--leo-gaze-y", `${y.toFixed(2)}px`);
      });
    };
    window.addEventListener("pointermove", followPointer, { passive: true });
    return () => { if (frame) window.cancelAnimationFrame(frame); window.removeEventListener("pointermove", followPointer); };
  }, [finePointer, hidden, motionEnabled, pageVisible]);

  function saveState(next: { hidden: boolean; muted: boolean }) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* La preferencia sigue en esta sesión. */ }
  }

  function setVisibility(nextHidden: boolean) {
    setHidden(nextHidden); saveState({ hidden: nextHidden, muted });
    void sendSignal({ action: "preference", pathname, context: leoContextForPath(pathname), hidden: nextHidden, muted });
  }

  function toggleMuted() {
    const next = !muted;
    setMuted(next); saveState({ hidden, muted: next });
    void sendSignal({ action: "preference", pathname, context: leoContextForPath(pathname), hidden, muted: next });
  }

  function registerGuideInteraction(targetPath = pathname) {
    void sendSignal({ action: "interaction", pathname: targetPath, context: leoContextForPath(targetPath) });
  }

  function focusPromotion() {
    registerGuideInteraction("/cliente/precios-ofertas");
    const target = document.querySelector<HTMLElement>(PROMOTION_ANCHOR);
    if (!target) return;
    setSleeping(false);
    target.scrollIntoView({ behavior: motionEnabled ? "smooth" : "auto", block: "center" });
    window.setTimeout(() => locatePromotion(true, true), 650);
  }

  if (hidden) {
    return (
      <button type="button" className={`${styles.restore} ${ready ? styles.ready : ""}`}
        data-reaction={activeEvent?.reaction || "none"} data-paused={!pageVisible || !motionEnabled ? "true" : "false"}
        onClick={() => setVisibility(false)} aria-label="Mostrar a Leo Celestial">
        <span className={styles.miniAura} aria-hidden="true" />
        <span className={styles.miniLion} aria-hidden="true"><LeoHologram /></span>
        {activeEvent ? <span className={styles.miniEventDot} aria-hidden="true" /> : null}
        <span>Mostrar Leo</span><Eye size={14} aria-hidden="true" />
      </button>
    );
  }

  return (
    <aside ref={guideRef} className={`${styles.guide} ${ready ? styles.ready : ""}`}
      data-mood={guide.mood} data-attention={attention ? "true" : "false"}
      data-anchored={anchor ? "true" : "false"} data-roaming={!anchor && roamPosition ? "true" : "false"}
      data-journey={journey} data-sleeping={sleeping ? "true" : "false"}
      data-reaction={activeEvent?.reaction || "none"} data-pose={guide.pose} data-expression={expression}
      data-compact={compactViewport ? "true" : "false"} data-paused={!pageVisible || !motionEnabled ? "true" : "false"}
      style={effectivePosition ? ({ "--leo-left": `${effectivePosition.left}px`, "--leo-top": `${effectivePosition.top}px` } as CSSProperties) : undefined}
      aria-label="Leo Celestial, guía inteligente del panel">
      {bubbleOpen && !muted ? (
        <div className={styles.bubble} aria-live="polite" aria-atomic="true">
          <div className={styles.bubbleTop}>
            <span><Sparkles size={12} /> LEO CELESTIAL</span>
            <div className={styles.controls}>
              <button type="button" onClick={toggleMuted} aria-label="Silenciar mensajes de Leo" title="Silenciar mensajes" aria-pressed={false}><Volume2 size={14} /></button>
              <button type="button" className={styles.hideButton} onClick={() => setVisibility(true)} aria-label="Ocultar a Leo Celestial"><EyeOff size={13} /> Ocultar</button>
            </div>
          </div>
          {activeEvent ? <span className={styles.reactionBadge}>{REACTION_LABELS[activeEvent.reaction]}</span> : null}
          {!activeEvent && contextTip ? <span className={styles.tipBadge}><Sparkles size={9} /> SUGERENCIA DEL GUÍA</span> : null}
          <strong>{guide.title}</strong><p>{guide.message}</p>
          {guide.href && guide.actionLabel ? <Link href={guide.href} onClick={() => registerGuideInteraction(guide.href!)}>{guide.actionLabel}</Link> : null}
          {!guide.href && guide.actionLabel ? <button type="button" className={styles.action} onClick={focusPromotion}>{guide.actionLabel}</button> : null}
        </div>
      ) : bubbleOpen ? (
        <div className={styles.silentControls}>
          <button type="button" onClick={toggleMuted} aria-label="Activar mensajes de Leo" title="Activar mensajes" aria-pressed={true}><VolumeX size={14} /></button>
          <button type="button" className={styles.hideButton} onClick={() => setVisibility(true)} aria-label="Ocultar a Leo Celestial"><EyeOff size={13} /> Ocultar</button>
        </div>
      ) : null}
      <button type="button" className={styles.character} onClick={() => { registerGuideInteraction(); setBubbleOpen((current) => !current); }} aria-label={bubbleOpen ? "Cerrar mensaje de Leo" : "Hablar con Leo Celestial"}>
        <span className={styles.travelTrail} /><span className={styles.aura} />
        <span className={`${styles.spark} ${styles.sparkOne}`} /><span className={`${styles.spark} ${styles.sparkTwo}`} /><span className={`${styles.spark} ${styles.sparkThree}`} />
        <div className={styles.lionBody} aria-hidden="true">
          <LeoHologram />
        </div>
      </button>
    </aside>
  );
}
