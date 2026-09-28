"use client";

import { createContext, type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import themeStyles from "./CentralThemes.module.css";
import PanelTheme from "@/components/ui/PanelTheme";
import { panelThemeVariables } from "@/lib/panel-theme";

export const CENTRAL_THEMES = [
  { id: "rango-actual", name: "Cristal · mi rango", family: "rank", colors: ["#090d19", "#27334b", "#e0e8f4"] },
  { id: "celestial-original", name: "Celestial Original", family: "original", colors: ["#08060d", "#6f3ea8", "#d7b56d"] },
  { id: "obsidiana-violeta", name: "Obsidiana Violeta", family: "dark", colors: ["#05050a", "#281535", "#ad78df"] },
  { id: "amatista-nocturna", name: "Amatista Nocturna", family: "dark", colors: ["#100717", "#4b1555", "#dd72da"] },
  { id: "cosmos-indigo", name: "Cosmos Índigo", family: "dark", colors: ["#030712", "#102962", "#7884ff"] },
  { id: "purpura-imperial", name: "Púrpura Imperial", family: "dark", colors: ["#0b0612", "#531288", "#d7b55f"] },
  { id: "ciruela-champagne", name: "Ciruela + Champagne", family: "dark", colors: ["#13090e", "#6a263e", "#e7c888"] },
  { id: "eclipse-celestial", name: "Eclipse Celestial", family: "dark", colors: ["#050408", "#8d0c67", "#f0c95f"] },
  { id: "perla-plata", name: "Perla + Plata", family: "light", colors: ["#f7f8fa", "#c9d0d9", "#637184"] },
  { id: "hielo-grafito", name: "Hielo + Grafito", family: "light", colors: ["#f2f8fb", "#263039", "#32bce7"] },
  { id: "marfil-champagne", name: "Marfil + Champagne", family: "light", colors: ["#fffaf0", "#d9bc8b", "#896331"] },
  { id: "blanco-lavanda", name: "Blanco + Lavanda", family: "light", colors: ["#fbfaff", "#d8ccf3", "#7550c5"] },
  { id: "niebla-purpura", name: "Niebla + Púrpura", family: "light", colors: ["#f1f0f6", "#bba8dc", "#6732c8"] },
  { id: "lunar-monocromo", name: "Lunar Monocromo", family: "light", colors: ["#f6f6f6", "#aeb2b5", "#24282b"] },
] as const;

export type CentralThemeId = (typeof CENTRAL_THEMES)[number]["id"];
export type GlassIntensity = "off" | "soft" | "medium" | "intense";
export type PanelPreset = "theme" | "dark" | "violet" | "blue" | "graphite" | "champagne" | "light" | "custom";
export type VisualSettings = {
  theme: CentralThemeId;
  textColor: string;
  smartContrast: boolean;
  panelPreset: PanelPreset;
  panelColor: string;
  panelOpacity: number;
  glass: GlassIntensity;
  fontSize: number;
  borderGlow: boolean;
  shadowStrength: number;
};

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = { theme: "rango-actual", textColor: "#f1f4fa", smartContrast: true, panelPreset: "theme", panelColor: "#151d2e", panelOpacity: 82, glass: "medium", fontSize: 16, borderGlow: true, shadowStrength: 45 };
const validThemes = new Set<string>(CENTRAL_THEMES.map((theme) => theme.id));
const validGlass = new Set<GlassIntensity>(["off", "soft", "medium", "intense"]);
const validPanels = new Set<PanelPreset>(["theme", "dark", "violet", "blue", "graphite", "champagne", "light", "custom"]);

function clamp(value: unknown, min: number, max: number, fallback: number) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function validHex(value: unknown, fallback: string) { const text = String(value || ""); return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback; }
function rgb(hex: string) { const value = validHex(hex, "#000000").slice(1); return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)); }
function rgba(hex: string, alpha: number) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${alpha})`; }
function luminance(hex: string) { return rgb(hex).map((v) => { const x = v / 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0); }
export function contrastRatio(a: string, b: string) { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + .05) / (low + .05); }
export function accessibleText(background: string) { return contrastRatio("#15121b", background) >= contrastRatio("#fffaf0", background) ? "#15121b" : "#fffaf0"; }
function mix(a: string, b: string, amount: number) { const ar = rgb(a), br = rgb(b); return `#${ar.map((value, i) => Math.round(value + (br[i] - value) * amount).toString(16).padStart(2, "0")).join("")}`; }

function normalize(raw: unknown): VisualSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_VISUAL_SETTINGS;
  const value = raw as Partial<VisualSettings>;
  return {
    theme: validThemes.has(String(value.theme)) ? value.theme as CentralThemeId : DEFAULT_VISUAL_SETTINGS.theme,
    textColor: validHex(value.textColor, DEFAULT_VISUAL_SETTINGS.textColor), smartContrast: value.smartContrast !== false,
    panelPreset: validPanels.has(value.panelPreset as PanelPreset) ? value.panelPreset as PanelPreset : DEFAULT_VISUAL_SETTINGS.panelPreset,
    panelColor: validHex(value.panelColor, DEFAULT_VISUAL_SETTINGS.panelColor), panelOpacity: clamp(value.panelOpacity, 50, 100, 94),
    glass: validGlass.has(value.glass as GlassIntensity) ? value.glass as GlassIntensity : DEFAULT_VISUAL_SETTINGS.glass,
    fontSize: clamp(value.fontSize, 12, 24, 16), borderGlow: value.borderGlow !== false, shadowStrength: clamp(value.shadowStrength, 0, 100, 55),
  };
}

type ThemeContextValue = { settings: VisualSettings; update: (patch: Partial<VisualSettings>) => void; reset: () => void; isLight: boolean; effectiveText: string; effectivePanel: string };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useCentralTheme() { const value = useContext(ThemeContext); if (!value) throw new Error("useCentralTheme debe usarse dentro de CentralThemeProvider"); return value; }

export function CentralThemeProvider({ workerId, rank, children }: { workerId?: string | null; rank?: string | null; children: ReactNode }) {
  const [settings, setSettings] = useState<VisualSettings>(DEFAULT_VISUAL_SETTINGS);
  const storageKey = workerId ? `tc:central-visual:v3:${workerId}` : null;
  const previousKey = workerId ? `tc:central-visual:v2:${workerId}` : null;
  const legacyKey = workerId ? `tc:central-theme:v1:${workerId}` : null;

  useLayoutEffect(() => {
    if (!storageKey) return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setSettings(normalize(JSON.parse(stored)));
      else {
        const previous = previousKey ? window.localStorage.getItem(previousKey) : null;
        if (previous) {
          const value = normalize(JSON.parse(previous));
          // Migrate the former default while retaining deliberately customized themes.
          setSettings(value.theme === "celestial-original" && value.panelPreset === "theme"
            ? { ...value, theme: "rango-actual", panelOpacity: value.panelOpacity === 94 ? 82 : value.panelOpacity }
            : value);
        } else {
          const legacy = legacyKey ? window.localStorage.getItem(legacyKey) : null;
          setSettings(legacy && legacy !== "celestial-original" && validThemes.has(legacy) ? { ...DEFAULT_VISUAL_SETTINGS, theme: legacy as CentralThemeId } : DEFAULT_VISUAL_SETTINGS);
        }
      }
    } catch { setSettings(DEFAULT_VISUAL_SETTINGS); }
  }, [legacyKey, previousKey, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    const timer = window.setTimeout(() => { try { window.localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* La apariencia sigue activa aunque el navegador bloquee el almacenamiento. */ } }, 280);
    return () => window.clearTimeout(timer);
  }, [settings, storageKey]);

  const update = useCallback((patch: Partial<VisualSettings>) => setSettings((current) => normalize({ ...current, ...patch })), []);
  const reset = useCallback(() => setSettings(DEFAULT_VISUAL_SETTINGS), []);
  const themeMeta = CENTRAL_THEMES.find((item) => item.id === settings.theme) || CENTRAL_THEMES[0];
  const themePanel = settings.theme === "rango-actual" ? "#151d2e" : themeMeta.colors[0];
  const effectivePanel = settings.panelPreset === "theme" ? themePanel : settings.panelColor;
  const isLight = luminance(effectivePanel) > .4;
  const rankVariables = panelThemeVariables(rank, isLight);
  const effectiveText = settings.smartContrast && contrastRatio(settings.textColor, effectivePanel) < 4.5 ? accessibleText(effectivePanel) : settings.textColor;
  const blur = { off: 0, soft: 8, medium: 15, intense: 22 }[settings.glass];
  const variables = {
    ...rankVariables,
    "--ct-text": effectiveText, "--ct-heading": effectiveText, "--ct-muted": mix(effectiveText, effectivePanel, .36), "--ct-text-secondary": mix(effectiveText, effectivePanel, .22), "--ct-text-on-accent": accessibleText(themeMeta.colors[2]),
    "--ct-user-surface": rgba(effectivePanel, settings.panelOpacity / 100), "--ct-user-surface-solid": effectivePanel, "--ct-surface-opacity": settings.panelOpacity / 100,
    "--ct-surface-blur": `${blur}px`, "--ct-font-scale": settings.fontSize / 16, "--ct-font-base": `${settings.fontSize}px`, "--ct-shadow-strength": settings.shadowStrength / 100,
    "--ct-glass-border": settings.borderGlow ? `rgba(${settings.theme === "rango-actual" ? rankVariables["--rank-rgb"] : rgb(themeMeta.colors[2]).join(",")},.26)` : "var(--ct-border)",
  } as CSSProperties;
  const context = useMemo(() => ({ settings, update, reset, isLight, effectiveText, effectivePanel }), [settings, update, reset, isLight, effectiveText, effectivePanel]);

  return <ThemeContext.Provider value={context}><PanelTheme rank={rank} className={themeStyles.themeRoot} data-central-theme={settings.theme} data-central-light={isLight ? "true" : "false"} data-glass={settings.glass} style={variables}>{children}</PanelTheme></ThemeContext.Provider>;
}
