"use client";

import { AlertTriangle, Check, Minus, Palette, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { accessibleText, CENTRAL_THEMES, contrastRatio, useCentralTheme, type GlassIntensity, type PanelPreset } from "./CentralTheme";
import styles from "./CentralThemeCustomizer.module.css";

const TEXT_PRESETS = [["Blanco", "#ffffff"], ["Blanco cálido", "#fff7e8"], ["Gris claro", "#d8d6dc"], ["Gris oscuro", "#404047"], ["Negro", "#15121b"], ["Dorado", "#e7c77c"], ["Lavanda", "#cdb7ff"], ["Azul hielo", "#bcecff"]] as const;
const PANEL_PRESETS: Array<[PanelPreset, string, string]> = [["theme", "Del tema", "#6f3ea8"], ["dark", "Oscuro", "#12101b"], ["violet", "Violeta", "#221233"], ["blue", "Azul", "#0d1b33"], ["graphite", "Grafito", "#272b30"], ["champagne", "Champagne", "#dbc291"], ["light", "Claro", "#f7f7fa"], ["custom", "Personalizado", "#12101b"]];
const FONT_PRESETS = [["Compacto", 13], ["Normal", 16], ["Grande", 18], ["Muy grande", 21]] as const;
const GLASS_OPTIONS: Array<[GlassIntensity, string]> = [["off", "Desactivado"], ["soft", "Suave"], ["medium", "Medio"], ["intense", "Intenso"]];
type Tab = "themes" | "readability" | "panels" | "advanced";

export default function CentralThemeCustomizer() {
  const { settings, update, reset, effectiveText, effectivePanel } = useCentralTheme();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("themes");
  const rootRef = useRef<HTMLDivElement>(null);
  const ratio = contrastRatio(settings.textColor, effectivePanel);
  const lowContrast = !settings.smartContrast && ratio < 4.5;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside); document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open]);

  const selectPanel = (preset: PanelPreset, color: string) => update({ panelPreset: preset, panelColor: color });
  const restore = () => { if (window.confirm("¿Restaurar toda tu apariencia a Celestial Original?")) { reset(); setTab("themes"); } };

  return <div className={styles.root} ref={rootRef}>
    <button type="button" className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`} onClick={() => setOpen((value) => !value)} aria-label="Abrir centro de personalización visual" aria-expanded={open} aria-haspopup="dialog" title="Personalizar panel"><Settings2 size={19} /></button>
    {open ? <div className={styles.popover} role="dialog" aria-modal="false" aria-label="Centro de personalización visual">
      <header className={styles.popoverHeader}><div className={styles.titleWrap}><span className={styles.titleIcon}><Sparkles size={17} /></span><div><strong>Centro de personalización</strong><small>Apariencia individual · vista previa inmediata</small></div></div><button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Cerrar"><X size={17} /></button></header>
      <div className={styles.demo} style={{ color: effectiveText, background: effectivePanel }}><span className={styles.demoKicker}>VISTA PREVIA</span><strong>Rendimiento</strong><b>184 XP</b><small>Información secundaria y legible</small><button type="button">Botón de ejemplo</button></div>
      <div className={styles.tabs} role="tablist" aria-label="Secciones de personalización">{([['themes','Temas'],['readability','Legibilidad'],['panels','Paneles'],['advanced','Avanzado']] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? styles.tabActive : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
      <div className={styles.scrollArea}>
        {tab === "themes" ? <div className={styles.themeGrid}>{CENTRAL_THEMES.map((theme) => { const active = theme.id === settings.theme; return <button type="button" key={theme.id} className={`${styles.themeCard} ${active ? styles.themeCardActive : ""}`} onClick={() => update({ theme: theme.id })} aria-pressed={active}><span className={styles.themePreview} style={{ background: `linear-gradient(135deg,${theme.colors[0]} 8%,${theme.colors[1]} 65%,${theme.colors[2]})` }}><i /><i /><i />{active ? <em><Check size={12} /></em> : null}</span><span>{theme.name}</span></button>; })}</div> : null}
        {tab === "readability" ? <div className={styles.sectionStack}>
          <section><div className={styles.sectionHeading}><div><strong>Tipografía y legibilidad</strong><small>Color base con jerarquía automática</small></div><ShieldCheck size={17} /></div><div className={styles.swatchGrid}>{TEXT_PRESETS.map(([label,color]) => <button type="button" key={color} className={settings.textColor === color ? styles.choiceActive : ""} onClick={() => update({ textColor: color })}><i style={{ background: color }} />{label}</button>)}</div><label className={styles.colorField}><span>Color personalizado</span><input type="color" value={settings.textColor} onChange={(event) => update({ textColor: event.target.value })} /><code>{settings.textColor.toUpperCase()}</code></label></section>
          <section><label className={styles.switchRow}><span><strong>Contraste inteligente automático</strong><small>Adapta el texto si el fondo pierde legibilidad.</small></span><input type="checkbox" checked={settings.smartContrast} onChange={(event) => update({ smartContrast: event.target.checked })} /></label>{lowContrast ? <div className={styles.warning}><AlertTriangle size={16} /><span><strong>Contraste bajo ({ratio.toFixed(1)}:1)</strong><small>Algunos textos pueden resultar difíciles de leer.</small></span><button type="button" onClick={() => update({ textColor: accessibleText(effectivePanel), smartContrast: true })}>Corregir automáticamente</button></div> : null}</section>
          <section><div className={styles.sectionHeading}><div><strong>Tamaño de interfaz</strong><small>Escala proporcional segura, sin romper jerarquías</small></div><b>{settings.fontSize}px</b></div><div className={styles.segmented}>{FONT_PRESETS.map(([label,size]) => <button type="button" key={label} className={settings.fontSize === size ? styles.choiceActive : ""} onClick={() => update({ fontSize: size })}>{label}</button>)}</div><div className={styles.numberControl}><button type="button" onClick={() => update({ fontSize: settings.fontSize - 1 })} aria-label="Reducir tamaño"><Minus size={16} /></button><input aria-label="Tamaño de fuente" type="number" min="12" max="24" value={settings.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /><button type="button" onClick={() => update({ fontSize: settings.fontSize + 1 })} aria-label="Aumentar tamaño"><Plus size={16} /></button></div></section>
        </div> : null}
        {tab === "panels" ? <div className={styles.sectionStack}>
          <section><div className={styles.sectionHeading}><div><strong>Apariencia de paneles</strong><small>Tarjetas, widgets, tablas y formularios</small></div><Palette size={17} /></div><div className={styles.panelGrid}>{PANEL_PRESETS.map(([key,label,color]) => <button type="button" key={key} className={settings.panelPreset === key ? styles.choiceActive : ""} onClick={() => selectPanel(key,color)}><i style={{ background: color }} />{label}</button>)}</div>{settings.panelPreset === "custom" ? <label className={styles.colorField}><span>Color de panel</span><input type="color" value={settings.panelColor} onChange={(event) => update({ panelColor: event.target.value })} /><code>{settings.panelColor.toUpperCase()}</code></label> : null}</section>
          <section><div className={styles.rangeHeader}><span><strong>Transparencia del panel</strong><small>Opaco → Cristal</small></span><b>{settings.panelOpacity}%</b></div><input className={styles.range} type="range" min="50" max="100" step="1" value={settings.panelOpacity} onChange={(event) => update({ panelOpacity: Number(event.target.value) })} /></section>
          <section><div className={styles.sectionHeading}><div><strong>Intensidad de cristal</strong><small>Desenfoque y profundidad tecnológica controlada</small></div></div><div className={styles.segmented}>{GLASS_OPTIONS.map(([key,label]) => <button type="button" key={key} className={settings.glass === key ? styles.choiceActive : ""} onClick={() => update({ glass: key })}>{label}</button>)}</div></section>
        </div> : null}
        {tab === "advanced" ? <div className={styles.sectionStack}>
          <section><label className={styles.switchRow}><span><strong>Borde luminoso fino</strong><small>Realce holográfico moderado en paneles.</small></span><input type="checkbox" checked={settings.borderGlow} onChange={(event) => update({ borderGlow: event.target.checked })} /></label></section>
          <section><div className={styles.rangeHeader}><span><strong>Profundidad de sombras</strong><small>Controla la separación visual de las capas</small></span><b>{settings.shadowStrength}%</b></div><input className={styles.range} type="range" min="0" max="100" value={settings.shadowStrength} onChange={(event) => update({ shadowStrength: Number(event.target.value) })} /></section>
          <section className={styles.resetZone}><RotateCcw size={20} /><div><strong>Restaurar Celestial Original</strong><small>Restablece tema, texto, tamaño, paneles, contraste y efectos.</small></div><button type="button" onClick={restore}>Restaurar todo</button></section>
        </div> : null}
      </div>
      <footer className={styles.footer}><span><Check size={13} /> Cambios aplicados en tiempo real</span><small>Guardado automático individual</small></footer>
    </div> : null}
  </div>;
}
