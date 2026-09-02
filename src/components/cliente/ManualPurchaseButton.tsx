"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BadgeAlert, PhoneCall, Tag, X } from "lucide-react";
import styles from "./ManualPurchaseButton.module.css";
import { CLIENT_PURCHASE_CALL_OPTIONS, CLIENT_WEB_PURCHASE_CODE } from "@/lib/client-purchase-maintenance";

type ManualPurchaseButtonProps = {
  children?: ReactNode;
  className?: string;
};

export default function ManualPurchaseButton({ children = "COMPRAR", className }: ManualPurchaseButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button, a[href]");
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button ref={triggerRef} type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {children}
      </button>

      {mounted && open
        ? createPortal(
            <div className={styles.backdrop} onMouseDown={() => setOpen(false)}>
              <section
                ref={dialogRef}
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Cerrar aviso">
                  <X />
                </button>

                <div className={styles.alertIcon}><BadgeAlert /></div>
                <span className={styles.eyebrow}>AVISO IMPORTANTE</span>
                <h2 id={titleId}>Compra web temporalmente en mantenimiento</h2>
                <p className={styles.intro}>
                  Mientras solucionamos el servicio de pago, los cobros se realizarán manualmente por teléfono.
                </p>

                <div className={styles.codeBox}>
                  <Tag />
                  <div>
                    <span>CÓDIGO PARA CONSERVAR EL PRECIO DE LA WEB</span>
                    <strong>{CLIENT_WEB_PURCHASE_CODE}</strong>
                    <p>Indícalo al comenzar la llamada para que te apliquen las tarifas más bajas publicadas en el panel.</p>
                  </div>
                </div>

                <div className={styles.callArea}>
                  <strong>Elige tu país para llamar a Tarot Celestial</strong>
                  <div className={styles.callGrid}>
                    {CLIENT_PURCHASE_CALL_OPTIONS.map((option) => (
                      <a key={option.country} href={option.href} className={styles.callButton}>
                        <span className={styles.flag} aria-hidden="true">{option.flag}</span>
                        <span><b>{option.country}</b><small>{option.number}</small></span>
                        <PhoneCall />
                      </a>
                    ))}
                  </div>
                </div>

                <p className={styles.footerNote}>El cobro y la activación de la tarifa se completarán manualmente durante la llamada.</p>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
