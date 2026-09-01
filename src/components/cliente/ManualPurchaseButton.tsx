"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BadgeAlert, PhoneCall, Tag, X } from "lucide-react";
import styles from "./ManualPurchaseButton.module.css";

const CALL_OPTIONS = [
  { country: "Puerto Rico", flag: "🇵🇷", number: "+1 787 945 0710", href: "tel:+17879450710" },
  { country: "Estados Unidos", flag: "🇺🇸", number: "+1 786 539 4750", href: "tel:+17865394750" },
  { country: "España", flag: "🇪🇸", number: "93 050 25 86", href: "tel:+34930502586" },
] as const;

type ManualPurchaseButtonProps = {
  children?: ReactNode;
  className?: string;
};

export default function ManualPurchaseButton({ children = "COMPRAR", className }: ManualPurchaseButtonProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>

      {mounted && open
        ? createPortal(
            <div className={styles.backdrop} onMouseDown={() => setOpen(false)}>
              <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="manual-purchase-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Cerrar aviso">
                  <X />
                </button>

                <div className={styles.alertIcon}><BadgeAlert /></div>
                <span className={styles.eyebrow}>AVISO IMPORTANTE</span>
                <h2 id="manual-purchase-title">Compra web temporalmente desactivada</h2>
                <p className={styles.intro}>
                  Mientras solucionamos el servicio de pago, los cobros se realizarán manualmente por teléfono.
                </p>

                <div className={styles.codeBox}>
                  <Tag />
                  <div>
                    <span>CÓDIGO PARA CONSERVAR EL PRECIO DE LA WEB</span>
                    <strong>Cliente web</strong>
                    <p>Indícalo al comenzar la llamada para que te apliquen las tarifas más bajas publicadas en el panel.</p>
                  </div>
                </div>

                <div className={styles.callArea}>
                  <strong>Elige tu país para llamar a Tarot Celestial</strong>
                  <div className={styles.callGrid}>
                    {CALL_OPTIONS.map((option) => (
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
