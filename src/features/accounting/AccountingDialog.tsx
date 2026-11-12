"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./accounting.module.css";

export default function AccountingDialog({ title, subtitle, busy, onClose, children }: {
  title: string; subtitle?: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialogRef.current;
    const focusables = () => Array.from(element?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []);
    (element?.querySelector<HTMLElement>("[data-initial-focus]") || focusables()[0])?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) closeRef.current();
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
      <div className={styles.dialogHeading}><div><h2 id={titleId}>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        <button type="button" className={styles.iconButton} aria-label="Cerrar ventana" onClick={onClose} disabled={busy}><X size={20} /></button>
      </div>
      {children}
    </div>
  </div>;
}
