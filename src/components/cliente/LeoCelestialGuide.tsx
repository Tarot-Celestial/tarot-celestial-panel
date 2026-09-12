"use client";

import Image from "next/image";
import Link from "next/link";
import { Maximize2, Minus, Sparkles, Volume2, VolumeX } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  const guide = useMemo(() => getGuideState(pathname, promoActive), [pathname, promoActive]);

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
    document.querySelector<HTMLElement>("[data-leo-anchor='active-promotion']")?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      className={`${styles.guide} ${ready ? styles.ready : ""}`}
      data-mood={guide.mood}
      data-attention={attention ? "true" : "false"}
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
