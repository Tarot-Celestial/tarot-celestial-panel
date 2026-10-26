"use client";

import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { AdminTabKey } from "./admin-navigation";

export function useAdminNavigation(initialTab: AdminTabKey = "dashboard") {
  const [tab, setCurrentTab] = useState<AdminTabKey>(initialTab);
  const currentTab = useRef(initialTab);
  const whatsappDirty = useRef(false);

  const setWhatsAppDirty = useCallback((dirty: boolean) => {
    whatsappDirty.current = dirty;
  }, []);

  // A stable callback also protects navigation from long-lived event listeners.
  const setTab = useCallback((next: SetStateAction<AdminTabKey>) => {
    const target = typeof next === "function" ? next(currentTab.current) : next;
    if (target === currentTab.current) return;
    if (currentTab.current === "whatsapp") {
      if (whatsappDirty.current && !window.confirm("Tienes cambios sin guardar en WhatsApp. ¿Quieres salir y descartar esos cambios?")) return;
      whatsappDirty.current = false;
    }
    currentTab.current = target;
    setCurrentTab(target);
  }, []);

  return { tab, setTab, setWhatsAppDirty };
}
