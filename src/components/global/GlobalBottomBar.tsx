"use client";

import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import IPPhoneBar from "@/components/phone/IPPhoneBar";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function GlobalBottomBar() {
  const { isOpen, setIsOpen } = usePhone();
  const { parking, leads } = useRealtimeCounters();

  const [mounted, setMounted] = useState(false);

  const prevParkingRef = useRef(0);
  const prevLeadsRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  function playSound(type: "parking" | "lead") {
    try {
      const audio = new Audio(
        type === "parking"
          ? "/sounds/parking.mp3"
          : "/sounds/lead.mp3"
      );
      audio.volume = 0.6;
      audio.play().catch(() => {});
    } catch {}
  }

  useEffect(() => {
    if (parking > prevParkingRef.current) playSound("parking");
    if (leads > prevLeadsRef.current) playSound("lead");

    prevParkingRef.current = parking;
    prevLeadsRef.current = leads;
  }, [parking, leads]);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* 📞 Softphone SIEMPRE activo */}
      <IPPhoneBar forcedOpen={isOpen} onOpenChange={setIsOpen} />

      {/* 🔥 DOCK PRO */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[999999] pointer-events-none">
        <div className="
          pointer-events-auto
          flex items-center gap-8 px-8 py-3
          rounded-2xl
          bg-[#0f0f17]/95
          border border-white/10
          backdrop-blur-xl
          shadow-[0_20px_60px_rgba(0,0,0,0.6)]
          transition-all duration-300
        ">

          {/* 📞 TELÉFONO */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex flex-col items-center text-xs hover:scale-110 transition"
          >
            <span className="text-lg">📞</span>
            <span>Teléfono</span>
          </button>

          {/* 🅿️ PARKING */}
          <div className="relative flex flex-col items-center text-xs">
            <span className="text-lg">🅿️</span>
            <span>Parking</span>

            {parking > 0 && (
              <span className="
                absolute -top-2 -right-3
                bg-red-500 text-[10px] px-2 rounded-full
                animate-pulse
              ">
                {parking}
              </span>
            )}
          </div>

          {/* 🔥 LEADS */}
          <div className="relative flex flex-col items-center text-xs">
            <span className="text-lg">🔥</span>
            <span>Leads</span>

            {leads > 0 && (
              <span className="
                absolute -top-2 -right-3
                bg-yellow-400 text-black text-[10px] px-2 rounded-full
                animate-pulse
              ">
                {leads}
              </span>
            )}
          </div>

          {/* 🟢 ESTADO */}
          <div className="flex flex-col items-center text-xs">
            <span className="text-green-400 text-lg">●</span>
            <span>Disponible</span>
          </div>

        </div>
      </div>
    </>,
    document.body
  );
}
