"use client";

import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import IPPhoneBar from "@/components/phone/IPPhoneBar";
import { useEffect, useRef } from "react";

export default function GlobalBottomBar() {
  const { isOpen, setIsOpen } = usePhone();
  const { parking, leads } = useRealtimeCounters();

  const prevParkingRef = useRef(0);
  const prevLeadsRef = useRef(0);

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

  return (
    <>
      {/* 🔴 IMPORTANTE: EL SOFTPHONE SIEMPRE */}
      <IPPhoneBar forcedOpen={isOpen} onOpenChange={setIsOpen} />

      {/* 🔥 DOCK PRO */}
      <div className="fixed inset-x-0 bottom-6 z-[999999] flex justify-center pointer-events-none">
        <div className="
          pointer-events-auto
          flex items-center gap-10 px-10 py-4
          rounded-3xl
          bg-gradient-to-b from-white/10 to-white/5
          border border-white/10
          backdrop-blur-2xl
          shadow-[0_30px_80px_rgba(0,0,0,0.7)]
          relative
        ">

          {/* glow fondo */}
          <div className="absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_center,rgba(215,181,109,0.15),transparent_70%)] pointer-events-none" />

          {/* 📞 TELÉFONO */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex flex-col items-center text-xs gap-1 hover:scale-110 transition"
          >
            <span className="text-xl">📞</span>
            <span className="opacity-80">Teléfono</span>
          </button>

          {/* 🅿️ PARKING */}
          <div className="relative flex flex-col items-center text-xs gap-1">
            <span className="text-xl">🅿️</span>
            <span className="opacity-80">Parking</span>

            {parking > 0 && (
              <span className="
                absolute -top-3 -right-3
                bg-red-500 text-[11px] px-2 py-0.5
                rounded-full
                animate-pulse
                shadow-lg
              ">
                {parking}
              </span>
            )}
          </div>

          {/* 🔥 LEADS */}
          <div className="relative flex flex-col items-center text-xs gap-1">
            <span className="text-xl">🔥</span>
            <span className="opacity-80">Leads</span>

            {leads > 0 && (
              <span className="
                absolute -top-3 -right-3
                bg-yellow-400 text-black text-[11px] px-2 py-0.5
                rounded-full
                animate-pulse
                shadow-lg
              ">
                {leads}
              </span>
            )}
          </div>

          {/* 🟢 ESTADO */}
          <div className="flex flex-col items-center text-xs gap-1">
            <span className="text-green-400 text-xl animate-pulse">●</span>
            <span className="opacity-80">Disponible</span>
          </div>

        </div>
      </div>
    </>
  );
}
