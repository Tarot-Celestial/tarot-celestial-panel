"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import IPPhoneBar from "@/components/phone/IPPhoneBar";

function playNotificationSound(type: "parking" | "lead") {
  try {
    const audio = new Audio(
      type === "parking" ? "/sounds/parking.mp3" : "/sounds/lead.mp3"
    );
    audio.volume = type === "parking" ? 0.7 : 0.55;
    audio.play().catch(() => null);
  } catch {}
}

function shouldShowDock(pathname: string | null) {
  const path = pathname || "";
  return path.startsWith("/admin");
}

export default function GlobalBottomBar() {
  const pathname = usePathname();
  const router = useRouter();

  const { isOpen, setIsOpen } = usePhone();
  const { parking, leads } = useRealtimeCounters();

  const prevParkingRef = useRef(0);
  const prevLeadsRef = useRef(0);
  const hydratedRef = useRef(false);

  const visible = shouldShowDock(pathname);

  useEffect(() => {
    if (!visible) return;

    if (!hydratedRef.current) {
      prevParkingRef.current = parking;
      prevLeadsRef.current = leads;
      hydratedRef.current = true;
      return;
    }

    if (parking > prevParkingRef.current)
      playNotificationSound("parking");

    if (leads > prevLeadsRef.current)
      playNotificationSound("lead");

    prevParkingRef.current = parking;
    prevLeadsRef.current = leads;
  }, [visible, parking, leads]);

  if (!visible) return null;

  return (
    <>
      <IPPhoneBar
        forcedOpen={isOpen}
        onOpenChange={setIsOpen}
      />

      <nav className="tc-ops-dock-root">
        <div className="tc-ops-dock">

          {/* 📞 TELÉFONO */}
          <button
            className={`tc-ops-dock-item ${
              isOpen ? "tc-ops-dock-item-active" : ""
            }`}
            onClick={() => setIsOpen(!isOpen)}
          >
            <span>☎</span>
            <span>Teléfono</span>
          </button>

          {/* 🅿️ PARKING */}
          <button
            className={`tc-ops-dock-item ${
              parking > 0 ? "tc-ops-dock-item-alert" : ""
            }`}
            onClick={() => {
  window.dispatchEvent(new CustomEvent("go-to-parking"));
}}
          >
            <span>🅿️</span>
            <span>Parking</span>

            {parking > 0 && (
              <span className="tc-ops-dock-badge tc-ops-dock-badge-danger">
                {parking}
              </span>
            )}
          </button>

          {/* 🔥 LEADS */}
          <button
            className={`tc-ops-dock-item ${
              leads > 0 ? "tc-ops-dock-item-alert" : ""
            }`}
            onClick={() => {   window.dispatchEvent(new CustomEvent("go-to-captacion")); }}
          >
            <span>🔥</span>
            <span>Leads</span>

            {leads > 0 && (
              <span className="tc-ops-dock-badge tc-ops-dock-badge-gold">
                {leads}
              </span>
            )}
          </button>

          {/* 🟢 ESTADO */}
          <div className="tc-ops-dock-item">
            <span className="tc-ops-status-dot" />
            <span>Disponible</span>
          </div>

        </div>
      </nav>
    </>
  );
}
