"use client";

import Image from "next/image";
import Link from "next/link";
import { Maximize2, Minus, Sparkles, Volume2, VolumeX } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./LeoCelestialGuide.module.css";

const STORAGE_KEY = "tc-leo-celestial-v1";

type Props = {
  promoActive: boolean;
};

type GuideState = {
  title: string;
  message: string;
  mood: "welcome" | "promo" | "oracle" | "reward" | "calm";
  href?: string;
  actionLabel?: string;
};

type AnchorPosition = {
  left: number;
  top: number;
};

type JourneyPhase = "idle" | "departing" | "travelling" | "arrived";

const PROMOTION_ANCHOR = "[data-leo-anchor='promotion-featured'], [data-leo-anchor='active-promotion']";
const DESKTOP_QUERY = "(min-width: 900px)";
const IDLE_DELAY = 45_000;

function getGuideState(pathname: string, promoActive: boolean): GuideState {
  if (pathname === "/cliente/precios-ofertas") {
    return promoActive
      ? { title: "Hay magia activa", message: "Mira la promoción de hoy. He venido a enseñarte dónde está.", mood: "promo", actionLabel: "Ver promoción" }
      : { title: "Precios claros", message: "Aquí encontrarás tus opciones de compra y las próximas promociones.", mood: "calm" };
  }
  if (pathname === "/cliente/oraculo") return { title: "Escucha tu intuición", message: "El Oráculo está preparado. Tómate un momento y elige tu pregunta con calma.", mood: "oracle" };
  if (pathname === "/cliente/ruleta") return { title: "Tu premio te espera", message: "Cada giro disponible tiene recompensa. Yo me quedaré cerca mientras descubres la tuya.", mood: "reward" };
  if (pathname === "/cliente/sorteo") return { title: "Destino y fortuna", message: "Aquí puedes consultar los sorteos activos y tus oportunidades.", mood: "reward" };
  if (pathname === "/cliente/notificaciones") return { title: "Nada se te escapa", message: "Revisa aquí tus novedades, regalos y movimientos importantes.", mood: "calm" };
  if (pathname === "/cliente/perfil") return { title: "Tu espacio", message: "Puedes mantener tus datos y preferencias al día desde esta sección.", mood: "calm" };
  if (pathname === "/cliente/tarotistas") return { title: "Elige con confianza", message: "Conoce a las profesionales y encuentra la energía que mejor conecte contigo.", mood: "oracle" };
  if (pathname === "/cliente/resenas") return { title: "Experiencias reales", message: "Las reseñas te ayudan a descubrir cómo viven otras personas Tarot Celestial.", mood: "calm" };
  if (promoActive) return { title: "Tengo algo que mostrarte", message: "Hoy hay una promoción activa. ¿Quieres que te acompañe a verla?", mood: "promo", href: "/cliente/precios-ofertas", actionLabel: "Ver la promo" };
  return { title: "Bienvenida a tu viaje", message: "Soy Leo Celestial. Estaré aquí para ayudarte a descubrir tu panel paso a paso.", mood: "welcome" };
}

export default function LeoCelestialGuide({ promoActive }: Props) {
  const pathname = usePathname();
  const [minimized, setMinimized] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [attention, setAttention] = useState(false);
  const [sleeping, setSleeping] = useState(false);
  const [anchor, setAnchor] = useState<AnchorPosition | null>(null);
  const [journey, setJourney] = useState<JourneyPhase>("idle");
  const guideRef = useRef<HTMLElement>(null);
  const movementTimers = useRef<number[]>([]);
  const guide = useMemo(() => getGuideState(pathname, promoActive), [pathname, promoActive]);

  const clearMovementTimers = useCallback(() => {
    movementTimers.current.forEach(window.clearTimeout);
    movementTimers.current = [];
  }, []);

  const locatePromotion = useCallback((force = false, animate = false) => {
    if (pathname !== "/cliente/precios-ofertas" || !promoActive || !window.matchMedia(DESKTOP_QUERY).matches) {
      setAnchor(null);
      setJourney("idle");
      return;
    }

    const target = document.querySelector<HTMLElement>(PROMOTION_ANCHOR);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const visible = rect.bottom > 96 && rect.top < window.innerHeight - 72;
    if (!visible && !force) {
      setAnchor(null);
      setJourney("idle");
      return;
    }

    const guideWidth = Math.min(470, window.innerWidth - 24);
    const lionCenterOffset = guideWidth - 84;
    const next = {
      left: Math.round(Math.min(Math.max(12, rect.left + rect.width / 2 - lionCenterOffset), window.innerWidth - guideWidth - 12)),
      top: Math.round(Math.min(Math.max(12, rect.top - 220), window.innerHeight - 308)),
    };

    const place = () => setAnchor((current) => {
      if (current && Math.abs(current.left - next.left) < 2 && Math.abs(current.top - next.top) < 2) return current;
      return next;
    });

    if (!animate) {
      place();
      return;
    }

    clearMovementTimers();
    setJourney("departing");
    movementTimers.current.push(window.setTimeout(() => {
      setJourney("travelling");
      place();
    }, 170));
    movementTimers.current.push(window.setTimeout(() => setJourney("arrived"), 850));
    movementTimers.current.push(window.setTimeout(() => setJourney("idle"), 1_500));
  }, [clearMovementTimers, pathname, promoActive]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as { minimized?: boolean; muted?: boolean };
      setMinimized(Boolean(stored.minimized));
      setMuted(Boolean(stored.muted));
    } catch {
      // Si el almacenamiento está bloqueado, Leo mantiene la configuración inicial.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    setAttention(true);
    const timer = window.setTimeout(() => setAttention(false), 2400);
    return () => window.clearTimeout(timer);
  }, [pathname, promoActive]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => locatePromotion(false, true), 260);
    let frame = 0;
    const refresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        locatePromotion();
      });
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
  }, [clearMovementTimers, locatePromotion]);

  useEffect(() => {
    let idleTimer = 0;
    const wake = () => {
      setSleeping(false);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setSleeping(true), IDLE_DELAY);
    };
    const activityEvents: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, wake, { passive: true }));
    wake();
    return () => {
      window.clearTimeout(idleTimer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, wake));
    };
  }, [pathname]);

  useEffect(() => {
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const followPointer = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
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
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", followPointer);
    };
  }, []);

  function saveState(next: { minimized: boolean; muted: boolean }) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // La preferencia sigue funcionando durante la sesión actual.
    }
  }

  function toggleMinimized() {
    const next = !minimized;
    setMinimized(next);
    saveState({ minimized: next, muted });
  }

  function toggleMuted() {
    const next = !muted;
    setMuted(next);
    saveState({ minimized, muted: next });
  }

  function focusPromotion() {
    const target = document.querySelector<HTMLElement>(PROMOTION_ANCHOR);
    if (!target) return;
    setSleeping(false);
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => locatePromotion(true, true), 650);
  }

  if (minimized) {
    return (
      <button
        type="button"
        className={`${styles.minimized} ${ready ? styles.ready : ""}`}
        onClick={toggleMinimized}
        aria-label="Abrir a Leo Celestial"
      >
        <span className={styles.miniAura} aria-hidden="true" />
        <Image src="/leo-celestial.webp" alt="" width={76} height={114} className={styles.miniLion} />
        <Maximize2 size={15} aria-hidden="true" />
      </button>
    );
  }

  return (
    <aside
      ref={guideRef}
      className={`${styles.guide} ${ready ? styles.ready : ""}`}
      data-mood={guide.mood}
      data-attention={attention ? "true" : "false"}
      data-anchored={anchor ? "true" : "false"}
      data-journey={journey}
      data-sleeping={sleeping ? "true" : "false"}
      style={anchor ? ({ "--leo-left": `${anchor.left}px`, "--leo-top": `${anchor.top}px` } as CSSProperties) : undefined}
      aria-label="Leo Celestial, guía del panel"
    >
      {!muted ? (
        <div className={styles.bubble} aria-live="polite">
          <div className={styles.bubbleTop}>
            <span><Sparkles size={12} /> LEO CELESTIAL</span>
            <div className={styles.controls}>
              <button type="button" onClick={toggleMuted} aria-label="Silenciar mensajes de Leo" title="Silenciar mensajes"><Volume2 size={15} /></button>
              <button type="button" onClick={toggleMinimized} aria-label="Minimizar a Leo Celestial" title="Minimizar"><Minus size={16} /></button>
            </div>
          </div>
          <strong>{guide.title}</strong>
          <p>{guide.message}</p>
          {guide.href && guide.actionLabel ? <Link href={guide.href}>{guide.actionLabel}</Link> : null}
          {!guide.href && guide.actionLabel ? <button type="button" className={styles.action} onClick={focusPromotion}>{guide.actionLabel}</button> : null}
        </div>
      ) : (
        <div className={styles.silentControls}>
          <button type="button" onClick={toggleMuted} aria-label="Activar mensajes de Leo" title="Activar mensajes"><VolumeX size={15} /></button>
          <button type="button" onClick={toggleMinimized} aria-label="Minimizar a Leo Celestial" title="Minimizar"><Minus size={16} /></button>
        </div>
      )}

      <div className={styles.character} aria-hidden="true">
        <span className={styles.travelTrail} />
        <span className={styles.aura} />
        <span className={`${styles.spark} ${styles.sparkOne}`} />
        <span className={`${styles.spark} ${styles.sparkTwo}`} />
        <span className={`${styles.spark} ${styles.sparkThree}`} />
        <div className={styles.lionBody}>
          <Image
            src="/leo-celestial.webp"
            alt=""
            width={640}
            height={960}
            sizes="(max-width: 480px) 112px, 172px"
            className={styles.lion}
            priority={pathname === "/cliente/dashboard"}
          />
          <span className={`${styles.eyeGlint} ${styles.eyeGlintLeft}`} />
          <span className={`${styles.eyeGlint} ${styles.eyeGlintRight}`} />
        </div>
      </div>
    </aside>
  );
}
