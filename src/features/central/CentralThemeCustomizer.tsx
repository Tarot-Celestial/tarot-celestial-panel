"use client";

import { Check, Palette, RotateCcw, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CENTRAL_THEMES, type CentralThemeId } from "./CentralTheme";
import styles from "./CentralThemeCustomizer.module.css";

type Props = {
  value: CentralThemeId;
  onChange: (theme: CentralThemeId) => void;
  onReset: () => void;
};

export default function CentralThemeCustomizer({ value, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  const groups = [
    { key: "original", label: "Identidad principal" },
    { key: "dark", label: "Constelaciones oscuras" },
    { key: "light", label: "Constelaciones claras" },
  ] as const;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-label="Configurar apariencia"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Configurar apariencia"
      >
        <Settings2 size={19} />
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Cambiar tema del panel">
          <div className={styles.popoverHeader}>
            <div className={styles.titleWrap}>
              <span className={styles.titleIcon}><Palette size={17} /></span>
              <div><strong>Cambiar tema</strong><small>Tu estilo personal del panel</small></div>
            </div>
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Cerrar"><X size={17} /></button>
          </div>

          <div className={styles.scrollArea}>
            {groups.map((group) => (
              <section className={styles.group} key={group.key}>
                <div className={styles.groupTitle}>{group.label}</div>
                <div className={styles.themeGrid}>
                  {CENTRAL_THEMES.filter((theme) => theme.family === group.key).map((theme) => {
                    const active = theme.id === value;
                    return (
                      <button
                        type="button"
                        key={theme.id}
                        className={`${styles.themeCard} ${active ? styles.themeCardActive : ""}`}
                        onClick={() => { onChange(theme.id); setOpen(false); }}
                        aria-pressed={active}
                      >
                        <span className={styles.preview} style={{ background: `linear-gradient(135deg, ${theme.colors[0]} 8%, ${theme.colors[1]} 64%, ${theme.colors[2]})` }}>
                          <span className={styles.previewRail} />
                          <span className={styles.previewCards}><i /><i /><i /></span>
                          {active && <span className={styles.activeCheck}><Check size={12} /></span>}
                        </span>
                        <span className={styles.themeName}>{theme.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <button type="button" className={styles.reset} onClick={() => { onReset(); setOpen(false); }}>
            <RotateCcw size={15} /> Restaurar Celestial Original
          </button>
        </div>
      )}
    </div>
  );
}
