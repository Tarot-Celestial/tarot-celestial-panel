"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import { useAttendance } from "@/hooks/useAttendance";
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

function playChatSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    gain.connect(ctx.destination);
    [880, 1174].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      const start = ctx.currentTime + index * 0.11;
      oscillator.start(start);
      oscillator.stop(start + 0.12);
    });
    window.setTimeout(() => void ctx.close(), 500);
  } catch {}
}

function shouldShowDock(pathname: string | null) {
  const path = pathname || "";
  if (path === "/admin/cerebro" || path.startsWith("/admin/cerebro/")) return false;
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
  const attendance = useAttendance();

  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatNotice, setChatNotice] = useState<{ name: string; text: string } | null>(null);
  const presence = useMemo(() => presenceFromAttendance(attendance), [attendance.online, attendance.status]);
  const [activeTab, setActiveTab] = useState<string>("");

  const prevParkingRef = useRef(0);
  const prevLeadsRef = useRef(0);
  const hydratedRef = useRef(false);

  const visible = shouldShowDock(pathname);
  const path = pathname || "";
  const parkingActive = activeTab === "panel";
  const captacionActive = activeTab === "captacion";
  const isTarotistaPanel = path.startsWith("/panel-tarotista");

  useEffect(() => {
    if (!visible) return;

    const onActiveTabChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail;
      setActiveTab(String(detail?.tab || ""));
    };

    window.addEventListener(TC_EVENTS.activeTabChanged, onActiveTabChanged as EventListener);
    return () => window.removeEventListener(TC_EVENTS.activeTabChanged, onActiveTabChanged as EventListener);
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

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("tc-chat-unread", { detail: { count: chatUnread } }));
  }, [chatUnread]);

  useEffect(() => {
    if (!visible) return;
    const onIncoming = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; text?: string }>).detail || {};
      setChatNotice({ name: String(detail.name || "Contacto"), text: String(detail.text || "") });
      playChatSound();
      window.setTimeout(() => setChatNotice(null), 6500);
    };
    window.addEventListener("tc-chat-incoming", onIncoming as EventListener);
    return () => window.removeEventListener("tc-chat-incoming", onIncoming as EventListener);
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <IPPhoneBar forcedOpen={isOpen} onOpenChange={setIsOpen} />
      {chatNotice ? (
        <button
          type="button"
          onClick={() => { setChatOpen(true); setChatNotice(null); }}
          style={{ position: "fixed", right: 18, top: 86, zIndex: 230, width: "min(360px,calc(100vw - 28px))", display: "grid", gap: 4, padding: 14, borderRadius: 17, border: "1px solid rgba(229,195,108,.42)", background: "rgba(18,13,27,.97)", color: "#fff", textAlign: "left", boxShadow: "0 22px 70px rgba(0,0,0,.45)", cursor: "pointer" }}
        >
          <b>💬 Nuevo mensaje de {chatNotice.name}</b>
          <span style={{ opacity: .7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chatNotice.text}</span>
        </button>
      ) : null}

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
