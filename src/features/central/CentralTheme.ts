"use client";

import { useCallback, useLayoutEffect, useMemo, useState } from "react";

export const CENTRAL_THEMES = [
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
const validThemes = new Set<string>(CENTRAL_THEMES.map((theme) => theme.id));

export function useCentralTheme(workerId?: string | null) {
  const [theme, setThemeState] = useState<CentralThemeId>("celestial-original");
  const storageKey = workerId ? `tc:central-theme:v1:${workerId}` : null;

  useLayoutEffect(() => {
    if (!storageKey) return;
    const stored = window.localStorage.getItem(storageKey);
    setThemeState(validThemes.has(String(stored)) ? stored as CentralThemeId : "celestial-original");
  }, [storageKey]);

  const setTheme = useCallback((nextTheme: CentralThemeId) => {
    setThemeState(nextTheme);
    if (storageKey) window.localStorage.setItem(storageKey, nextTheme);
  }, [storageKey]);

  const resetTheme = useCallback(() => {
    setThemeState("celestial-original");
    if (storageKey) window.localStorage.removeItem(storageKey);
  }, [storageKey]);

  const isLight = useMemo(() => CENTRAL_THEMES.find((item) => item.id === theme)?.family === "light", [theme]);
  return { theme, isLight, setTheme, resetTheme };
}
