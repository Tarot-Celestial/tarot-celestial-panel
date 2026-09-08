import type { Metadata } from "next";
import PublicBusinessShell, { LegalDocument } from "@/components/public/PublicBusinessShell";
import styles from "@/components/public/PublicBusiness.module.css";
import { BUSINESS } from "@/lib/public-business";

export const metadata: Metadata = { title: "Aviso legal | Tarot Celestial", description: "Identificación del titular y condiciones de uso del sitio Tarot Celestial.", alternates: { canonical: `${BUSINESS.website}/aviso-legal` } };

export default function LegalNoticePage() {
  return <PublicBusinessShell activePath="/aviso-legal"><LegalDocument eyebrow="Titularidad del sitio" title="Aviso legal" intro="Información identificativa y condiciones generales de utilización de clientestarotcelestial.es.">
    <section><h2>1. Información del titular</h2><dl className={styles.dataList}><div><dt>Nombre comercial</dt><dd>{BUSINESS.commercialName}</dd></div><div><dt>Titular</dt><dd>{BUSINESS.legalName}</dd></div><div><dt>NIF/NIE</dt><dd>{BUSINESS.taxId}</dd></div><div><dt>País</dt><dd>{BUSINESS.country}</dd></div><div><dt>Domicilio</dt><dd>{BUSINESS.addressLines.join(", ")}</dd></div><div><dt>Contacto</dt><dd><a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a><br/><a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phoneDisplay}</a></dd></div></dl></section>
    <section><h2>2. Finalidad</h2><p>Este sitio facilita información comercial y legal sobre Tarot Celestial, permite el acceso al área de clientes y sirve de soporte a la contratación y utilización de consultas privadas de tarot por teléfono.</p></section>
    <section><h2>3. Condiciones de acceso y uso</h2><p>El usuario se compromete a utilizar el sitio de forma lícita, diligente y respetuosa. Queda prohibido intentar acceder a zonas restringidas sin autorización, introducir código malicioso, perjudicar la disponibilidad del servicio o utilizar contenidos y datos para fines ilícitos.</p></section>
    <section><h2>4. Propiedad intelectual</h2><p>Salvo indicación contraria, el diseño, identidad, textos y elementos propios del sitio pertenecen a su titular o se utilizan con autorización. Su acceso no concede derechos de explotación, reproducción o distribución fuera de los límites permitidos por la ley.</p></section>
    <section><h2>5. Disponibilidad y enlaces</h2><p>Se procura mantener la información y el sitio disponibles y actualizados. Pueden producirse interrupciones por mantenimiento, seguridad o causas técnicas. Los enlaces a servicios de terceros se ofrecen para facilitar funcionalidades o información; cada tercero responde de sus propios contenidos y condiciones.</p></section>
    <section><h2>6. Responsabilidad</h2><p>Las consultas de tarot tienen carácter de entretenimiento y orientación personal y no sustituyen consejo profesional. Nada en este aviso excluye responsabilidades que no puedan limitarse legalmente ni los derechos imperativos de consumidores y usuarios.</p></section>
    <section><h2>7. Contacto</h2><p>Para comunicar una incidencia relacionada con el sitio o con sus contenidos, escribe a <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>.</p></section>
  </LegalDocument></PublicBusinessShell>;
}
