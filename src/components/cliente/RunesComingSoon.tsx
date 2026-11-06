"use client";

import { Gem, LockKeyhole, Sparkles } from "lucide-react";
import CrimsonRuneScene from "./CrimsonRuneScene";
import styles from "./RunesComingSoon.module.css";

type Rune = { title: string; benefit: string; updated_at: string };

export default function RunesComingSoon({ rune }: { rune: Rune | null }) {
  return (
    <section className={styles.panel} aria-labelledby="client-rune-title">
      <div className={styles.exhibit}>
        <CrimsonRuneScene />
      </div>

      <div className={styles.content}>
        <div className={styles.eyebrow}>
          <span>Tu colección celestial</span>
          <span className={`${styles.badge} ${rune ? styles.activeBadge : ""}`}>
            {rune ? "Activada para ti" : "Sin activar"}
          </span>
        </div>
        <h2 id="client-rune-title" className={styles.title}>
          {rune ? rune.title : <>Tu próxima <span>reliquia celestial.</span></>}
        </h2>
        <p className={styles.description}>
          {rune ? "Esta runa forma parte de tu colección. Aquí puedes consultar la ventaja que tienes asignada."
            : "Aún no tienes una runa activada. Cuando el equipo te asigne una, aparecerá aquí con su ventaja."}
        </p>

        {rune ? <div className={styles.benefit}>
          <span className={styles.benefitIcon}><Sparkles size={25} aria-hidden="true" /></span>
          <div>
            <span className={styles.benefitLabel}>La ventaja de tu runa</span>
            <p className={styles.benefitText}>{rune.benefit}</p>
          </div>
        </div> : <p className={styles.availability}><LockKeyhole size={16} aria-hidden="true" /> Activación personal por el equipo de Tarot Celestial.</p>}

        <div className={styles.details}>
          <span><Gem size={19} aria-hidden="true" /> {rune ? "Tu runa personal" : "Runa coleccionable"}</span>
        </div>

      </div>
    </section>
  );
}
