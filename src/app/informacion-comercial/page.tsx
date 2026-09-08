import type { Metadata } from "next";
import Link from "next/link";
import PublicBusinessShell from "@/components/public/PublicBusinessShell";
import styles from "@/components/public/PublicBusiness.module.css";
import { BUSINESS, PRICES } from "@/lib/public-business";

const canonical = `${BUSINESS.website}/informacion-comercial`;

export const metadata: Metadata = {
  title: "Tarot Celestial | Consultas privadas de tarot",
  description: "Información comercial, servicios, precios y condiciones de Tarot Celestial.",
  alternates: { canonical },
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: canonical,
    siteName: BUSINESS.commercialName,
    title: "Tarot Celestial | Consultas privadas de tarot",
    description: "Información comercial, servicios, precios y condiciones de Tarot Celestial.",
  },
};

const steps = [
  ["Selecciona", "Elige el paquete de minutos que mejor se adapte a tu consulta."],
  ["Realiza el pago", "Completa el pago mediante uno de los métodos disponibles."],
  ["Confirmación", "El pago autorizado queda confirmado y asociado a tu cuenta."],
  ["Consulta", "Utiliza tus minutos durante la consulta telefónica privada."],
  ["Soporte", "Contacta con Tarot Celestial si necesitas ayuda con el servicio."],
] as const;

export default function CommercialInformationPage() {
  return (
    <PublicBusinessShell activePath="/informacion-comercial">
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Información comercial oficial</span>
        <h1>Consultas privadas de tarot <em>por teléfono</em></h1>
        <p className={styles.heroLead}>Tarot Celestial ofrece consultas privadas de tarot mediante llamada telefónica, con paquetes de minutos y atención personalizada.</p>
        <div className={styles.heroActions}>
          <a className={styles.primaryButton} href="#precios">Consultar precios</a>
          <a className={styles.secondaryButton} href={`mailto:${BUSINESS.email}`}>Contactar</a>
        </div>
      </section>

      <section className={styles.trustGrid} aria-label="Características del servicio">
        <div><b>Servicio privado</b><span>Atención personalizada</span></div>
        <div><b>Precios transparentes</b><span>Siempre visibles en EUR</span></div>
        <div><b>Atención telefónica</b><span>Paquetes por minutos</span></div>
        <div><b>Pagos seguros</b><span>Proveedores autorizados</span></div>
      </section>

      <div className={styles.sectionAlt}>
        <section className={styles.section} id="servicios">
          <header className={styles.sectionHead}><span>Nuestros servicios</span><h2>Orientación personal, clara y privada</h2><p>El cliente adquiere un paquete de minutos y los utiliza durante una consulta telefónica con nuestro equipo.</p></header>
          <div className={styles.serviceGrid}>
            <article className={styles.serviceCard}><h3>Consulta telefónica</h3><p>Conversación privada durante el tiempo incluido en el paquete seleccionado, con atención personalizada.</p></article>
            <article className={styles.serviceCard}><h3>Alcance responsable</h3><p>El tarot se ofrece como <strong>entretenimiento y orientación personal</strong>. No garantiza resultados ni sustituye asistencia médica, psicológica, legal o financiera.</p></article>
          </div>
        </section>
      </div>

      <section className={styles.section} id="precios">
        <header className={styles.sectionHead}><span>Precios reales</span><h2>Elige la duración de tu consulta</h2><p>Todos los importes se muestran en euros e incluyen el servicio correspondiente a la duración contratada.</p></header>
        <div className={styles.priceGrid}>
          {PRICES.map((item) => <article className={styles.priceCard} key={item.minutes}><small>PAQUETE DE CONSULTA</small><h3>{item.minutes} minutos</h3><strong>{item.price}</strong><p>{item.description}</p></article>)}
        </div>
        <p className={styles.priceNote}>Moneda: EUR (€). Algunas compras pueden incluir beneficios o giros promocionales según las condiciones vigentes; estas ventajas no alteran el servicio ni el precio principal indicado.</p>
      </section>

      <div className={styles.sectionAlt}>
        <section className={styles.section} id="como-funciona">
          <header className={styles.sectionHead}><span>Cómo funciona</span><h2>De la selección a la consulta</h2><p>Un proceso sencillo y trazable para adquirir y utilizar tus minutos.</p></header>
          <div className={styles.steps}>{steps.map(([title, text]) => <article className={styles.step} key={title}><h3>{title}</h3><p>{text}</p></article>)}</div>
        </section>
      </div>

      <section className={styles.section} id="pago">
        <header className={styles.sectionHead}><span>Condiciones de pago</span><h2>Información antes de contratar</h2></header>
        <div className={styles.serviceGrid}>
          <article className={styles.serviceCard}><h3>Confirmación</h3><p>Los precios se muestran en euros (EUR). El pago se considera confirmado cuando el proveedor de pagos autoriza la operación. El cliente recibirá el servicio correspondiente al paquete adquirido.</p></article>
          <article className={styles.serviceCard}><h3>Métodos disponibles</h3><p>Tarot Celestial puede ofrecer distintos proveedores o métodos de pago en función de la disponibilidad y del país. Las condiciones aplicables se muestran antes de confirmar la compra.</p></article>
        </div>
      </section>

      <div className={styles.sectionAlt}>
        <section className={styles.section} id="empresa">
          <header className={styles.sectionHead}><span>Información empresarial</span><h2>Un negocio claramente identificado</h2><p>Datos públicos del titular responsable de Tarot Celestial.</p></header>
          <div className={styles.companyGrid}>
            <article className={styles.companyCard}>
              <h3>Datos registrados</h3>
              <dl>
                <div><dt>Nombre comercial</dt><dd>{BUSINESS.commercialName}</dd></div>
                <div><dt>Titular</dt><dd>{BUSINESS.legalName}</dd></div>
                <div><dt>NIF/NIE</dt><dd>{BUSINESS.taxId}</dd></div>
                <div><dt>País</dt><dd>{BUSINESS.country}</dd></div>
              </dl>
            </article>
            <article className={styles.companyCard} id="contacto">
              <h3>Contacto y dirección</h3>
              <address>{BUSINESS.addressLines.map((line) => <span key={line}>{line}</span>)}<a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a><a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phoneDisplay}</a></address>
            </article>
          </div>
        </section>
      </div>

      <section className={styles.section} id="legal">
        <header className={styles.sectionHead}><span>Transparencia</span><h2>Condiciones y políticas</h2><p>Consulta la información legal aplicable antes de contratar.</p></header>
        <div className={styles.legalCards}>
          <Link href="/terminos"><span>01</span><strong>Términos y condiciones</strong></Link>
          <Link href="/privacidad"><span>02</span><strong>Política de privacidad</strong></Link>
          <Link href="/aviso-legal"><span>03</span><strong>Aviso legal</strong></Link>
          <Link href="/reembolsos"><span>04</span><strong>Cancelaciones y reembolsos</strong></Link>
        </div>
        <p className={styles.disclaimer}>Tarot Celestial no presenta sus consultas como predicciones infalibles ni como garantía de un resultado concreto. Si necesitas asesoramiento sanitario, psicológico, jurídico o financiero, consulta con un profesional cualificado.</p>
      </section>
    </PublicBusinessShell>
  );
}
