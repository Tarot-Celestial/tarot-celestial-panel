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

export default function ManualPurchaseButton({ children = "LLAMAR A LA CENTRAL", className }: ManualPurchaseButtonProps) {
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
      <p className={styles.maintenanceNotice}>Pagos web temporalmente en mantenimiento<br /><span>Para realizar tu compra, llama a nuestra central e indica el código <strong>CLIENTE</strong>.</span></p>
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
                <span className={styles.eyebrow}>COMPRA POR TELÉFONO</span>
                <h2 id={titleId}>Pagos web temporalmente en mantenimiento</h2>
                <p className={styles.intro}>
                  Para realizar tu compra, llama a nuestra central e indica el código “CLIENTE”.
                </p>

                <div className={styles.codeBox}>
                  <Tag />
                  <div>
                    <span>CÓDIGO</span>
                    <strong>{CLIENT_WEB_PURCHASE_CODE}</strong>
                    <p>Indícalo al comenzar la llamada para registrar tu compra.</p>
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

                <p className={styles.footerNote}>Nuestro equipo registrará tu compra y tus beneficios directamente en tu cuenta.</p>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
