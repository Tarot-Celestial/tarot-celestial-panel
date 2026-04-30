"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import IPPhoneBar from "@/components/phone/IPPhoneBar";
import DockChatWidget from "@/components/global/DockChatWidget";
import { TC_EVENTS, emitDockOpenCaptacion, emitDockOpenParking } from "@/lib/tc-events";

type DockPresence = {
  online: boolean;
  status: string;
  label: string;
  tone: "online" | "break" | "offline";
};

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
  return path.startsWith("/admin") || path.startsWith("/panel-central") || path.startsWith("/panel-tarotista");
}


function openParkingFromDock(pathname: string | null) {
  const path = pathname || "";

  emitDockOpenParking({ source: "global-dock" });

  // Si el dock se usa fuera de admin/central, caemos a una ruta segura.
  if (!path.startsWith("/admin") && !path.startsWith("/panel-central")) {
    window.location.href = "/admin?tab=parking";
  }
}

function openCaptacionFromDock(pathname: string | null) {
  const path = pathname || "";

  emitDockOpenCaptacion({ source: "global-dock" });

  if (!path.startsWith("/admin") && !path.startsWith("/panel-central")) {
    window.location.href = "/admin?tab=captacion";
  }
}

function presenceFromAttendance(payload: any): DockPresence {
  const online = payload?.online === true;
  const status = String(payload?.status || (online ? "working" : "offline")).toLowerCase();

  if (!online || status === "offline") {
    return { online: false, status: "offline", label: "Desconectado", tone: "offline" };
  }

  if (status === "break" || status === "bathroom" || status === "paused") {
    return {
      online: true,
      status,
      label: status === "bathroom" ? "Baño" : "Descanso",
      tone: "break",
    };
  }

  return { online: true, status: "working", label: "Disponible", tone: "online" };
}

export default function GlobalBottomBar() {
  const pathname = usePathname();
  const { isOpen, setIsOpen } = usePhone();
  const { parking, leads } = useRealtimeCounters();

  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [presence, setPresence] = useState<DockPresence>({
    online: false,
    status: "offline",
    label: "Desconectado",
    tone: "offline",
  });
  const [activeTab, setActiveTab] = useState<string>("");

  const prevParkingRef = useRef(0);
  const prevLeadsRef = useRef(0);
  const hydratedRef = useRef(false);

  const visible = shouldShowDock(pathname);
  const path = pathname || "";
  const parkingActive = activeTab === "panel";
  const captacionActive = activeTab === "captacion";
  const isTarotistaPanel = path.startsWith("/panel-tarotista");

  async function refreshPresence() {
    try {
      const sb = supabaseBrowser();
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token || "";

      if (!token) {
        setPresence({ online: false, status: "offline", label: "Desconectado", tone: "offline" });
        return;
      }

      const res = await fetch(`/api/attendance/me?t=${Date.now()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setPresence({ online: false, status: "offline", label: "Desconectado", tone: "offline" });
        return;
      }

      setPresence(presenceFromAttendance(json));
    } catch {
      setPresence({ online: false, status: "offline", label: "Desconectado", tone: "offline" });
    }
  }

  useEffect(() => {
    if (!visible) return;

    const onActiveTabChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail;
      setActiveTab(String(detail?.tab || ""));
    };

    window.addEventListener(TC_EVENTS.activeTabChanged, onActiveTabChanged as EventListener);
    return () => window.removeEventListener(TC_EVENTS.activeTabChanged, onActiveTabChanged as EventListener);
  }, [visible]);

  // Estado real del operador: viene de attendance_state vía /api/attendance/me.
  // No depende solo de que exista sesión Supabase.
  useEffect(() => {
    if (!visible) return;

    const sb = supabaseBrowser();
    void refreshPresence();

    const interval = window.setInterval(() => void refreshPresence(), 5000);
    const onFocus = () => void refreshPresence();
    const onAttendanceChanged = () => void refreshPresence();

    window.addEventListener("focus", onFocus);
    window.addEventListener(TC_EVENTS.attendanceChanged, onAttendanceChanged as EventListener);

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange(() => {
      void refreshPresence();
    });

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(TC_EVENTS.attendanceChanged, onAttendanceChanged as EventListener);
      subscription.unsubscribe();
    };
  }, [visible]);

  // Sonidos de parking/leads, evitando sonar en la primera carga.
  useEffect(() => {
    if (!visible) return;

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

          {!isTarotistaPanel ? (
            <button
              type="button"
              className={`tc-ops-dock-item ${parkingActive ? "tc-ops-dock-item-active" : ""} ${parking > 0 ? "tc-ops-dock-item-alert" : ""}`}
              onClick={() => openParkingFromDock(pathname)}
            >
              <span className="tc-ops-dock-icon">🅿️</span>
              <span className="tc-ops-dock-label">Parking</span>
              {parking > 0 ? <span className="tc-ops-dock-badge tc-ops-dock-badge-danger">{parking}</span> : null}
            </button>
          ) : null}

          {!isTarotistaPanel ? (
            <button
              type="button"
              className={`tc-ops-dock-item ${captacionActive ? "tc-ops-dock-item-active" : ""} ${leads > 0 ? "tc-ops-dock-item-alert" : ""}`}
              onClick={() => openCaptacionFromDock(pathname)}
            >
              <span className="tc-ops-dock-icon">🔥</span>
              <span className="tc-ops-dock-label">Leads</span>
              {leads > 0 ? <span className="tc-ops-dock-badge tc-ops-dock-badge-gold">{leads}</span> : null}
            </button>
          ) : null}

          <button
            type="button"
            className={`tc-ops-dock-item ${chatOpen ? "tc-ops-dock-item-active" : ""} ${chatUnread > 0 ? "tc-ops-dock-item-alert" : ""}`}
            onClick={() => setChatOpen((v) => !v)}
            aria-pressed={chatOpen}
          >
            <span className="tc-ops-dock-icon">💬</span>
            <span className="tc-ops-dock-label">Chat</span>
            {chatUnread > 0 ? <span className="tc-ops-dock-badge tc-ops-dock-badge-gold">{chatUnread}</span> : null}
          </button>

          {!isTarotistaPanel ? (
            <div
              className={`tc-ops-dock-item tc-ops-dock-status tc-ops-dock-status-${presence.tone}`}
              aria-label={`Estado: ${presence.label}`}
              title={`Estado: ${presence.label}`}
            >
              <span className="tc-ops-status-dot" />
              <span className="tc-ops-dock-label">{presence.label}</span>
            </div>
          ) : null}
        </div>
      </nav>

      <DockChatWidget open={chatOpen} onClose={() => setChatOpen(false)} onUnreadChange={setChatUnread} />
    </>
  );
}
