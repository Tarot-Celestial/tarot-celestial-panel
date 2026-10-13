"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ChevronLeft, ChevronRight, Crown, Heart, MoonStar, Orbit, Ticket, Users, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { usePortalMotion } from "./CelestialPortal";
import styles from "./ExperienceRail.module.css";

export type ExperienceRailProps = {
  ritualAccess: boolean;
  oracleFree: boolean;
  oracleCredits: number;
  oracleCountdown: string;
  rouletteHref: string;
  rouletteSpins: number | null;
  rank: string;
};

type Experience = {
  id: "oracle" | "ritual" | "benefits" | "raffle" | "roulette" | "readers";
  title: string;
  description: string;
  detail: string;
  href: string;
  color: string;
  Icon: LucideIcon;
};
type MouseDrag = { pointerId: number; x: number; y: number; scroll: number; dragging: boolean };
const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
const PARTICLES = [
  [16, 26, -.8], [35, 13, -2.4], [78, 25, -4.2], [62, 40, -1.7], [87, 10, -3.3], [25, 47, -5.1],
] as const;

function experiences(props: ExperienceRailProps): Experience[] {
  const credits = count(props.oracleCredits);
  const spins = props.rouletteSpins === null || !Number.isFinite(props.rouletteSpins) ? null : count(props.rouletteSpins);
  const oracleDetail = props.oracleFree
    ? `1 tirada gratis${credits > 0 ? ` · ${credits} adicionales` : " disponible"}`
    : credits > 0 ? `${credits} ${credits === 1 ? "tirada disponible" : "tiradas disponibles"}`
      : props.oracleCountdown.trim() ? `Gratis en ${props.oracleCountdown}` : "Abre tu oráculo";
  const cards: Experience[] = [{
    id: "oracle", title: "Tu carta de hoy", description: "Haz una pausa y escucha tu intuición.", detail: oracleDetail,
    href: "/cliente/oraculo", color: "#c5a6fa", Icon: MoonStar,
  }];
  if (props.ritualAccess) cards.push({
    id: "ritual", title: "Mi ritual", description: "Acompaña cada etapa de tu experiencia.", detail: "Tu espacio personal",
    href: "/cliente/ritual", color: "#8fdfbe", Icon: Heart,
  });
  cards.push(
    { id: "benefits", title: "Tus beneficios", description: "Conoce las ventajas de tu rango.", detail: props.rank.trim() ? `Rango ${props.rank}` : "Descubre tus beneficios", href: "/cliente/rangos", color: "#f2d28e", Icon: Crown },
    { id: "raffle", title: "Mi sorteo", description: "Consulta tus números y sorteos.", detail: "Ver mis participaciones", href: "/cliente/sorteo", color: "#e9aad1", Icon: Ticket },
    { id: "roulette", title: "Mi ruleta", description: "Encuentra aquí tus giros disponibles.", detail: spins === null ? "Consultar mis giros" : spins === 0 ? "Sin giros pendientes" : `${spins} ${spins === 1 ? "giro disponible" : "giros disponibles"}`, href: props.rouletteHref || "/cliente/ruleta", color: "#efc48c", Icon: Orbit },
    { id: "readers", title: "Tarotistas", description: "Encuentra con quién conectar.", detail: "Conocer tarotistas", href: "/cliente/tarotistas", color: "#b7b3f3", Icon: Users },
  );
  return cards;
}

function ExperienceCard({ card, index, running }: { card: Experience; index: number; running: boolean }) {
  const [art, setArt] = useState<"loading" | "ready" | "fallback">("loading");
  const Icon = card.Icon;
  return <li className={styles.item}>
    <Link href={card.href} className={styles.card} data-experience-card={card.id} data-running={running} style={{ "--experience-color": card.color } as CSSProperties} draggable={false}>
      <div className={styles.art} data-experience-art={card.id} data-art-status={art} aria-hidden="true">
        <div className={styles.artFallback}><Icon size={62} strokeWidth={1.1} /></div>
        {art !== "fallback" ? <Image src={`/images/portal/${card.id}.webp`} alt="" width={1536} height={1024} sizes="(max-width: 640px) 86vw, (max-width: 1000px) 46vw, 380px" loading={index < 3 ? "eager" : "lazy"} draggable={false} onLoad={() => setArt("ready")} onError={() => setArt("fallback")} /> : null}
      </div>
      <div className={styles.particles} aria-hidden="true">
        {PARTICLES.map(([x, y, delay], particle) => <span key={particle} className={styles.particle} data-particle={particle % 3} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}>
          {card.id === "benefits" ? ["✦", "✧", "⋄"][particle % 3] : card.id === "oracle" && particle % 3 !== 1 ? "✧" : card.id === "readers" ? "✦" : null}
        </span>)}
      </div>
      <div className={styles.content}>
        <span className={styles.detail}>{card.detail}</span>
        <h3>{card.title}</h3>
        <p>{card.description}</p>
        <span className={styles.enter}>Explorar <ArrowRight size={15} aria-hidden="true" /></span>
      </div>
    </Link>
  </li>;
}

export default function ExperienceRail(props: ExperienceRailProps) {
  const { running } = usePortalMotion();
  const titleId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<MouseDrag | null>(null);
  const suppressClick = useRef(false);
  const edges = useRef({ start: true, end: false });
  const [limits, setLimits] = useState(edges.current);
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  const cards = experiences(props);

  const measure = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
    const next = { start: element.scrollLeft <= 2, end: element.scrollLeft >= maximum - 2 };
    if (next.start !== edges.current.start || next.end !== edges.current.end) {
      edges.current = next;
      setLimits(next);
    }
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const size = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    size?.observe(element);
    window.addEventListener("resize", measure, { passive: true });
    // A viewport-rooted observer also sees clipping by the horizontal scroll container.
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      setVisible(previous => {
        const next = new Set(previous);
        let changed = false;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.experienceCard;
          if (!id) continue;
          const shown = entry.isIntersecting && entry.intersectionRatio >= .15;
          if (shown !== next.has(id)) { changed = true; if (shown) next.add(id); else next.delete(id); }
        }
        return changed ? next : previous;
      });
    }, { threshold: [0, .15] });
    element.querySelectorAll<HTMLElement>("[data-experience-card]").forEach(card => observer?.observe(card));
    return () => {
      element.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      size?.disconnect(); observer?.disconnect();
    };
  }, [props.ritualAccess, measure]);

  function move(direction: -1 | 1) {
    const element = viewport.current;
    if (!element) return;
    const left = element.scrollLeft;
    const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
    const origin = element.getBoundingClientRect().left + element.clientLeft;
    const positions = Array.from(element.querySelectorAll<HTMLElement>("[data-experience-card]"), card => card.getBoundingClientRect().left - origin + left);
    const destination = direction === 1 ? positions.find(position => position > left + 3) ?? maximum : positions.reverse().find(position => position < left - 3) ?? 0;
    element.scrollTo({ left: Math.max(0, Math.min(maximum, destination)), behavior: running ? "smooth" : "auto" });
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (event.pointerType !== "mouse" || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scroll: event.currentTarget.scrollLeft, dragging: false };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId || event.buttons !== 1) return;
    const delta = event.clientX - current.x;
    if (!current.dragging) {
      if (Math.abs(delta) < 8 || Math.abs(delta) <= Math.abs(event.clientY - current.y)) return;
      current.dragging = true;
      suppressClick.current = true;
      event.currentTarget.dataset.dragging = "true";
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = current.scroll - delta;
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function captureClick(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return <section className={styles.rail} data-experience-rail="" aria-labelledby={titleId}>
    <header className={styles.header}>
      <div><h2 id={titleId}>Explora tu universo</h2><p>Desliza y descubre tu siguiente experiencia</p></div>
      <div className={styles.controls}>
        <button type="button" onClick={() => move(-1)} disabled={limits.start} aria-label="Ver experiencias anteriores"><ChevronLeft size={20} aria-hidden="true" /></button>
        <button type="button" onClick={() => move(1)} disabled={limits.end} aria-label="Ver experiencias siguientes"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
    </header>
    <div ref={viewport} className={styles.viewport} dir="ltr" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onPointerLeave={() => { if (!drag.current?.dragging) drag.current = null; }} onClickCapture={captureClick} onDragStart={event => event.preventDefault()}>
      <ul className={styles.track}>
        {cards.map((card, index) => <ExperienceCard key={card.id} card={card} index={index} running={running && visible.has(card.id)} />)}
      </ul>
    </div>
  </section>;
}
