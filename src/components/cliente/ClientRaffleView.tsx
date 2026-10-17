"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { CircleAlert, Clock3, LoaderCircle, RefreshCw, Ticket, TicketCheck } from "lucide-react";
import styles from "@/app/cliente/sorteo/sorteo.module.css";

export type ClientRaffleNumber = { id: string; number: number; assigned_at: string };

export type ClientRaffleViewProps = {
  numbers: ClientRaffleNumber[];
  title: string;
  loading: boolean;
  message: string;
  onRefresh: () => void;
  children?: ReactNode;
};

function assignedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Fecha de asignación no disponible" : `Asignado el ${date.toLocaleString("es-ES")}`;
}

export default function ClientRaffleView({ numbers, title, loading, message, onRefresh, children }: ClientRaffleViewProps) {
  const hasNumbers = numbers.length > 0;
  const isStale = Boolean(message && hasNumbers);

  return (
    <div className={styles.root}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>TAROT CELESTIAL · TU PARTICIPACIÓN</span>
          <h2>Sorteo de <span>Halloween</span></h2>
          <p>Tus números, en un lugar especial. Cuando tu central te los asigne, los encontrarás aquí.</p>
          <div className={styles.raffleTitle}>
            <Ticket aria-hidden="true" />
            <span>{loading && !hasNumbers ? "Consultando sorteo…" : title}</span>
          </div>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <Image
            src="/images/raffle/halloween-pumpkins.webp"
            alt=""
            width={850}
            height={680}
            sizes="(max-width: 700px) 190px, 310px"
            priority
          />
        </div>
      </header>

      <section className={styles.numbersSection} aria-labelledby="client-raffle-numbers-title" aria-busy={loading}>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionIcon}><TicketCheck aria-hidden="true" /></span>
            <div>
              <h2 id="client-raffle-numbers-title">Tus números de la suerte</h2>
              <p>Asignados por tu central y vinculados a tu cuenta.</p>
            </div>
          </div>
          <div className={styles.sectionActions}>
            {hasNumbers || (!loading && !message) ? (
              <span className={styles.count}>
                <strong>{numbers.length}</strong> {numbers.length === 1 ? "número" : "números"}
              </span>
            ) : null}
            <button className={styles.refresh} type="button" onClick={onRefresh} disabled={loading}>
              <RefreshCw aria-hidden="true" className={loading ? styles.spin : undefined} />
              {loading ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
        </div>

        {message ? (
          <div className={styles.message} role="alert">
            <CircleAlert aria-hidden="true" />
            <div>
              <strong>{hasNumbers ? "No hemos podido actualizar tus números" : "No hemos podido consultar tus números"}</strong>
              <p>{message}</p>
              {hasNumbers ? <p>Mostramos la última información recibida. Pulsa «Actualizar» para comprobarla.</p> : null}
            </div>
          </div>
        ) : null}

        {hasNumbers ? (
          <>
            {isStale || loading ? (
              <p className={styles.updateStatus} role="status">
                <Clock3 aria-hidden="true" />
                {isStale ? "Últimos números recibidos · pendientes de actualizar" : "Comprobando tus números. Conservamos la última información recibida."}
              </p>
            ) : null}
            <div className={styles.ticketGrid}>
              {numbers.map((entry) => (
                <article key={entry.id} className={styles.ticket} aria-label={`Número de sorteo ${entry.number}`}>
                  <div className={styles.ticketMain}>
                    <div className={styles.ticketTop}><TicketCheck aria-hidden="true" /><span>TU NÚMERO</span></div>
                    <strong className={styles.ticketNumber}>{entry.number}</strong>
                    <span className={styles.ticketCaption}>SORTEO DE HALLOWEEN</span>
                  </div>
                  <div className={styles.ticketStub}>
                    <span className={styles.assigned}><span aria-hidden="true" />Número asignado</span>
                    <p>{assignedDate(entry.assigned_at)}</p>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : loading ? (
          <div className={styles.loading} role="status">
            <span className={styles.stateIcon}><LoaderCircle className={styles.spin} aria-hidden="true" /></span>
            <h3>Consultando tus números</h3>
            <p>Estamos comprobando la información de tu sorteo.</p>
          </div>
        ) : !message ? (
          <div className={styles.empty}>
            <span className={styles.stateIcon}><Ticket aria-hidden="true" /></span>
            <span className={styles.emptyEyebrow}>TU ESPACIO ESTÁ PREPARADO</span>
            <h3>Esperando tu número de la suerte</h3>
            <p>Cuando tu central te asigne un número, aparecerá aquí.</p>
          </div>
        ) : null}
      </section>

      {children}
    </div>
  );
}
