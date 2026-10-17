"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, Gem } from "lucide-react";
import CrimsonRuneScene from "./CrimsonRuneScene";
import styles from "./RunesComingSoon.module.css";

export default function RunesComingSoon() {
  return (
    <section className={styles.panel} aria-labelledby="runes-coming-soon-title">
      <div className={styles.exhibit}>
        <CrimsonRuneScene />
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
