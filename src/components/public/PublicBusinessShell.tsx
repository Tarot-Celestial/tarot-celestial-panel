import Link from "next/link";
import type { ReactNode } from "react";
import { BUSINESS, PUBLIC_LINKS } from "@/lib/public-business";
import styles from "./PublicBusiness.module.css";

type PublicBusinessShellProps = {
  children: ReactNode;
  activePath: string;
};

export default function PublicBusinessShell({ children, activePath }: PublicBusinessShellProps) {
  return (
    <div className={styles.site}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/informacion-comercial" aria-label="Tarot Celestial, información comercial">
            <span className={styles.brandMark} aria-hidden="true"><i>✦</i></span>
            <span><strong>TAROT CELESTIAL</strong><small>Consultas privadas por teléfono</small></span>
          </Link>
          <nav className={styles.nav} aria-label="Navegación pública">
            <Link href="/informacion-comercial" aria-current={activePath === "/informacion-comercial" ? "page" : undefined}>Servicios y precios</Link>
            <Link href="/terminos" aria-current={activePath === "/terminos" ? "page" : undefined}>Condiciones</Link>
            <Link href="/privacidad" aria-current={activePath === "/privacidad" ? "page" : undefined}>Privacidad</Link>
            <a className={styles.panelLink} href="/cliente/login">Panel Cliente</a>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div>
            <Link className={styles.footerBrand} href="/informacion-comercial">Tarot Celestial</Link>
            <p>Consultas privadas de tarot y orientación mediante llamada telefónica.</p>
          </div>
          <div>
            <h2>Información legal</h2>
            <nav aria-label="Enlaces legales">
              {PUBLIC_LINKS.slice(1).map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
            </nav>
          </div>
          <address>
            <h2>Datos del titular</h2>
            <strong>{BUSINESS.legalName}</strong>
            <span>NIF/NIE: {BUSINESS.taxId}</span>
            {BUSINESS.addressLines.map((line) => <span key={line}>{line}</span>)}
            <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
            <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phoneDisplay}</a>
          </address>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} Tarot Celestial</span>
          <span>Servicio de entretenimiento y orientación personal. No sustituye asesoramiento profesional.</span>
        </div>
      </footer>
    </div>
  );
}

export function LegalDocument({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return (
    <div className={styles.legalWrap}>
      <header className={styles.legalHero}>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{intro}</p>
        <small>Última actualización: 8 de septiembre de 2026</small>
      </header>
      <article className={styles.legalDocument}>{children}</article>
    </div>
  );
}

export { styles as publicStyles };
