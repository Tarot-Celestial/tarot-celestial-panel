"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import IPPhoneBar from "@/components/phone/IPPhoneBar";

function playNotificationSound(type: "parking" | "lead") {
  try {
    const audio = new Audio(type === "parking" ? "/sounds/parking.mp3" : "/sounds/lead.mp3");
    audio.volume = type === "parking" ? 0.7 : 0.55;
    audio.play().catch(() => null);
  } catch {
    // El navegador puede bloquear audio hasta la primera interacción del usuario.
  }
}

function shouldShowDock(pathname: string | null) {
  const path = pathname || "";
  if (!path) return false;

  // Solo panel interno. Evita que aparezca en login, panel de cliente, checkout, chat público, etc.
  return path === "/admin" || path.startsWith("/admin/") || path === "/panel-central" || path === "/panel-tarotista";
}

export default function GlobalBottomBar() {
  const pathname = usePathname();
  const { isOpen, setIsOpen } = usePhone();
  const { parking, leads } = useRealtimeCounters();

  const prevParkingRef = useRef(0);
  const prevLeadsRef = useRef(0);
  const hydratedRef = useRef(false);

  const visible = shouldShowDock(pathname);
  const hasParking = parking > 0;
  const hasLeads = leads > 0;

  useEffect(() => {
    if (!visible) return;

    // Evita reproducir sonido con los contadores iniciales al cargar la página.
    if (!hydratedRef.current) {
      prevParkingRef.current = parking;
      prevLeadsRef.current = leads;
      hydratedRef.current = true;
      return;
    }

    if (parking > prevParkingRef.current) playNotificationSound("parking");
    if (leads > prevLeadsRef.current) playNotificationSound("lead");

    prevParkingRef.current = parking;
    prevLeadsRef.current = leads;
  }, [visible, parking, leads]);

  if (!visible) return null;

  return (
    <>
      <IPPhoneBar forcedOpen={isOpen} onOpenChange={setIsOpen} />

      <nav className="tc-ops-dock-root" aria-label="Acciones rápidas de centralita">
        <div className="tc-ops-dock" role="toolbar" aria-label="Centralita">
          <button
            type="button"
            className={`tc-ops-dock-item ${isOpen ? "tc-ops-dock-item-active" : ""}`}
            onClick={() => setIsOpen(!isOpen)}
            aria-pressed={isOpen}
          >
            <span className="tc-ops-dock-icon tc-ops-dock-icon-phone">☎</span>
            <span className="tc-ops-dock-label">Teléfono</span>
          </button>

          <button type="button" className={`tc-ops-dock-item ${hasParking ? "tc-ops-dock-item-alert" : ""}`}>
            <span className="tc-ops-dock-icon">🅿️</span>
            <span className="tc-ops-dock-label">Parking</span>
            {hasParking ? <span className="tc-ops-dock-badge tc-ops-dock-badge-danger">{parking}</span> : null}
          </button>

          <button type="button" className={`tc-ops-dock-item ${hasLeads ? "tc-ops-dock-item-alert" : ""}`}>
            <span className="tc-ops-dock-icon">🔥</span>
            <span className="tc-ops-dock-label">Leads</span>
            {hasLeads ? <span className="tc-ops-dock-badge tc-ops-dock-badge-gold">{leads}</span> : null}
          </button>

          <div className="tc-ops-dock-item tc-ops-dock-status" aria-label="Estado disponible">
            <span className="tc-ops-status-dot" />
            <span className="tc-ops-dock-label">Disponible</span>
          </div>
        </div>
      </nav>
    </>
  );
}
