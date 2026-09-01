"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, MoreVertical, RotateCcw, X } from "lucide-react";
import styles from "./NavigationVisibilityMenu.module.css";

type VisibilityItem = {
  key: string;
  label: string;
};

export function useHiddenNavigation(storageKey: string) {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) : [];
      setHiddenKeys(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
    } catch {
      setHiddenKeys([]);
    }
  }, [storageKey]);

  const save = useCallback((next: string[]) => {
    setHiddenKeys(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // La navegación sigue funcionando aunque el navegador bloquee el almacenamiento local.
    }
  }, [storageKey]);

  const toggleHidden = useCallback((key: string) => {
    setHiddenKeys((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Mantiene la preferencia durante la sesión actual.
      }
      return next;
    });
  }, [storageKey]);

  const resetHidden = useCallback(() => save([]), [save]);

  return { hiddenKeys, toggleHidden, resetHidden };
}

type NavigationVisibilityMenuProps = {
  items: readonly VisibilityItem[];
  hiddenKeys: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
  panelName: string;
};

export default function NavigationVisibilityMenu({ items, hiddenKeys, onToggle, onReset, panelName }: NavigationVisibilityMenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const hiddenSet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);

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
      <button
        type="button"
        className={styles.trigger}
        aria-label={`Personalizar navegación de ${panelName}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MoreVertical />
      </button>

      {mounted && open
        ? createPortal(
            <div className={styles.backdrop} onMouseDown={() => setOpen(false)}>
              <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`navigation-visibility-${panelName}`}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <span>PERSONALIZAR NAVEGACIÓN</span>
                    <h2 id={`navigation-visibility-${panelName}`}>Pestañas de {panelName}</h2>
                    <p>Oculta lo que no necesites. No se elimina información ni se modifican permisos.</p>
                  </div>
                  <button type="button" className={styles.close} aria-label="Cerrar" onClick={() => setOpen(false)}><X /></button>
                </header>

                <div className={styles.list}>
                  {items.map((item) => {
                    const hidden = hiddenSet.has(item.key);
                    return (
                      <button
                        type="button"
                        key={item.key}
                        className={`${styles.item} ${hidden ? styles.itemHidden : ""}`}
                        onClick={() => onToggle(item.key)}
                        aria-pressed={!hidden}
                      >
                        <span className={styles.itemIcon}>{hidden ? <EyeOff /> : <Eye />}</span>
                        <span><b>{item.label}</b><small>{hidden ? "Oculta" : "Visible"}</small></span>
                        <span className={styles.switch} aria-hidden="true"><i /></span>
                      </button>
                    );
                  })}
                </div>

                <footer>
                  <button type="button" className={styles.reset} onClick={onReset} disabled={hiddenKeys.length === 0}>
                    <RotateCcw /> Mostrar todas
                  </button>
                  <button type="button" className={styles.done} onClick={() => setOpen(false)}>Listo</button>
                </footer>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
