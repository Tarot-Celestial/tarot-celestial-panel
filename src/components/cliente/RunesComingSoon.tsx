import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./RunesComingSoon.module.css";

export default function RunesComingSoon() {
  return (
    <section className={styles.panel} aria-labelledby="runes-coming-soon-title">
      <div className={styles.emblem} aria-hidden="true">
        <svg viewBox="0 0 120 140" fill="none" focusable="false">
          <path
            d="M34 12 80 7 106 42 100 112 69 132 25 120 13 77 20 36Z"
            className={styles.stone}
          />
          <path d="m34 12 7 25-21-1m21 1 41-9-2-21m2 21 24 14m-24-14 7 65 11 19M25 120l15-20 29 32M13 77l27 23" className={styles.facets} />
          <path d="M59 43v55m0-55 19 18-19 16m0-15L43 78" className={styles.mark} />
        </svg>
      </div>

      <div className={styles.content}>
        <div className={styles.eyebrow}>
          <span>Tarot Celestial</span>
          <span className={styles.badge} aria-label="Nuevo apartado">New</span>
        </div>
        <h2 id="runes-coming-soon-title" className={styles.title}>Runas</h2>
        <p className={styles.status}>Próximamente</p>
        <p className={styles.description}>
          Estamos preparando esta nueva experiencia. Aquí encontrarás toda la información cuando esté lista.
        </p>
        <Link href="/cliente/sorteo" className={styles.link}>
          Ver el sorteo
          <ArrowRight size={19} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
