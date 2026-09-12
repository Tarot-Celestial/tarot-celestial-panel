"use client";

import Image from "next/image";
import { ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ClientAuthShell.module.css";

type ClientAuthShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export default function ClientAuthShell({ eyebrow, title, subtitle, children, footer }: ClientAuthShellProps) {
  return (
    <main className={styles.shell}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.orbGold} />
        <span className={styles.orbViolet} />
        <span className={styles.lightSweep} />
      </div>

      <section className={styles.card} aria-labelledby="client-auth-title">
        <div className={styles.cardShine} aria-hidden="true" />

        <header className={styles.brand}>
          <div className={styles.logoStage} aria-hidden="true">
            <span className={styles.logoOrbit} />
            <span className={`${styles.particle} ${styles.particleOne}`} />
            <span className={`${styles.particle} ${styles.particleTwo}`} />
            <span className={`${styles.particle} ${styles.particleThree}`} />
            <span className={`${styles.particle} ${styles.particleFour}`} />
            <div className={styles.logoHalo}>
              <Image
                src="/Nuevo-logo-tarot.png"
                alt=""
                width={92}
                height={92}
                className={styles.logo}
                priority
              />
            </div>
          </div>

          <div className={styles.eyebrow}><Sparkles size={13} /> {eyebrow}</div>
          <h1 id="client-auth-title">{title}</h1>
          <p>{subtitle}</p>
        </header>

        <div className={styles.content}>{children}</div>

        <div className={styles.trustRow} aria-label="Información de seguridad">
          <span><ShieldCheck size={14} /> Acceso protegido</span>
          <span>Tarot Celestial</span>
        </div>

        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </section>
    </main>
  );
}
