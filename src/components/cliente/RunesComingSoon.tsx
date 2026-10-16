"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, Gem, Sun } from "lucide-react";
import styles from "./RunesComingSoon.module.css";

export default function RunesComingSoon() {
  const [illuminated, setIlluminated] = useState(false);

  return (
    <section className={styles.panel} aria-labelledby="runes-coming-soon-title">
      <div className={styles.exhibit}>
        <span className={styles.artLabel}>Una nueva colección celestial</span>
        <div className={styles.art}>
          <div className={illuminated ? styles.illuminated : styles.light} aria-hidden="true" />
          <Image
            className={styles.relic}
            src="/images/runas/runa-celestial-v1.webp"
            alt="Runa de cristal oscuro con un símbolo dorado, luz amatista y una base de obsidiana."
            width={800}
            height={1200}
            sizes="(max-width: 680px) 240px, (max-width: 1000px) 32vw, 360px"
            priority
          />
        </div>
        <button className={styles.previewButton} type="button" aria-pressed={illuminated} onClick={() => setIlluminated(value => !value)}>
          <Sun size={17} aria-hidden="true" /> Iluminar runa
          <span>Vista previa</span>
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.eyebrow}>
          <span>Coleccionables con ventajas</span>
          <span className={styles.badge}>Próximamente</span>
        </div>
        <h2 id="runes-coming-soon-title" className={styles.title}>
          Tu próxima <span>reliquia celestial.</span>
        </h2>
        <p className={styles.description}>
          Una runa para tu colección. Una nueva forma de disfrutar de Tarot Celestial.
        </p>

        <div className={styles.benefit}>
          <span className={styles.benefitIcon}><BookOpen size={25} aria-hidden="true" /></span>
          <div>
            <span className={styles.benefitLabel}>La ventaja de esta runa</span>
            <h3>Acceso a una lectura especial</h3>
            <p>Con una tarotista, mediante reserva.</p>
          </div>
        </div>

        <div className={styles.details}>
          <span><Gem size={19} aria-hidden="true" /> Runa coleccionable</span>
          <span><CalendarDays size={19} aria-hidden="true" /> Reserva previa</span>
        </div>

        <Link href="/cliente/sorteo" className={styles.link}>
          Ver el sorteo
          <ArrowRight size={19} aria-hidden="true" />
        </Link>
        <p className={styles.availability}>
          Muy pronto anunciaremos cómo conseguirla, la disponibilidad de la lectura y sus condiciones.
        </p>
      </div>
    </section>
  );
}
