"use client";

import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import IPPhoneBar from "@/components/phone/IPPhoneBar";

export default function GlobalBottomBar() {
  const { isOpen, setIsOpen } = usePhone();
  const { parking, leads } = useRealtimeCounters();

  return (
    <>
      {/* 📞 SOFTPHONE */}
{isOpen && (
  <div className="fixed bottom-16 right-4 z-50">
    <IPPhoneBar />
  </div>
)}

      {/* 🔻 BARRA */}
      <div className="fixed bottom-0 left-0 w-full h-14 bg-zinc-900 border-t border-zinc-700 flex items-center justify-around z-40 text-white">

        {/* 📞 TELÉFONO */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-col items-center text-xs"
        >
          <span>📞</span>
          <span>Teléfono</span>
        </button>

        {/* 🅿️ PARKING */}
        <button className="flex flex-col items-center text-xs">
          <span>🅿️</span>
          <span>Parking ({parking})</span>
        </button>

        {/* 🔥 LEADS */}
        <button className="flex flex-col items-center text-xs">
          <span>🔥</span>
          <span>Leads ({leads})</span>
        </button>

        {/* 👤 ESTADO */}
        <button className="flex flex-col items-center text-xs">
          <span>🟢</span>
          <span>Disponible</span>
        </button>

      </div>
    </>
  );
}
