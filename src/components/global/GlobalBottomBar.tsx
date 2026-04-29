"use client";

import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import IPPhoneBar from "@/components/phone/IPPhoneBar";

export default function GlobalBottomBar() {
  const { isOpen, setIsOpen } = usePhone();
  const { parking, leads } = useRealtimeCounters();

  const hasParking = parking > 0;
  const hasLeads = leads > 0;

  return (
    <>
      {/* 📞 Softphone SIEMPRE montado */}
      <IPPhoneBar forcedOpen={isOpen} onOpenChange={setIsOpen} />

      {/* 🔥 DOCK FLOTANTE PRO */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <div
          className="
          flex items-center gap-6 px-6 py-3 rounded-2xl
          bg-zinc-900/80 backdrop-blur-xl
          border border-zinc-700
          shadow-2xl text-white

          transition-all duration-300
          hover:scale-105
        "
        >
          {/* 📞 TELÉFONO */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`
              flex items-center gap-2 transition
              ${isOpen ? "text-green-400" : "hover:text-green-400"}
            `}
            type="button"
          >
            <span className="text-lg">📞</span>
            <span className="hidden sm:inline font-semibold">Teléfono</span>
          </button>

          {/* 🅿️ PARKING */}
          <button
            className={`
              relative flex items-center gap-2 transition
              ${hasParking ? "text-yellow-400" : "hover:text-yellow-400"}
            `}
            type="button"
          >
            <span className="text-lg">🅿️</span>
            <span className="font-semibold">{parking}</span>

            {/* 🔥 badge animado */}
            {hasParking && (
              <span className="absolute -top-2 -right-3 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
              </span>
            )}
          </button>

          {/* 🔥 LEADS */}
          <button
            className={`
              relative flex items-center gap-2 transition
              ${hasLeads ? "text-orange-400" : "hover:text-orange-400"}
            `}
            type="button"
          >
            <span className="text-lg">🔥</span>
            <span className="font-semibold">{leads}</span>

            {/* 🔥 badge animado */}
            {hasLeads && (
              <span className="absolute -top-2 -right-3 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
              </span>
            )}
          </button>

          {/* 🟢 ESTADO */}
          <div className="flex items-center gap-2 text-green-400">
            <span className="text-lg">🟢</span>
            <span className="hidden sm:inline font-semibold">Disponible</span>
          </div>
        </div>
      </div>
    </>
  );
}
