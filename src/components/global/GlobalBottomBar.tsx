"use client";

import { usePhone } from "@/context/PhoneContext";
import { useRealtimeCounters } from "@/hooks/useRealtimeCounters";
import IPPhoneBar from "@/components/phone/IPPhoneBar";

export default function GlobalBottomBar() {
  const { isOpen, setIsOpen } = usePhone();
  const { parking, leads } = useRealtimeCounters();

  return (
    <>
      {/* 📞 Softphone real: siempre montado para no perder registro ni llamadas */}
      <IPPhoneBar forcedOpen={isOpen} onOpenChange={setIsOpen} />

      {/* 🔻 Barra global */}
      <div className="fixed bottom-0 left-0 w-full h-14 bg-zinc-900 border-t border-zinc-700 flex items-center justify-around z-40 text-white">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-col items-center text-xs"
          type="button"
        >
          <span>📞</span>
          <span>Teléfono</span>
        </button>

        <button className="flex flex-col items-center text-xs" type="button">
          <span>🅿️</span>
          <span>Parking ({parking})</span>
        </button>

        <button className="flex flex-col items-center text-xs" type="button">
          <span>🔥</span>
          <span>Leads ({leads})</span>
        </button>

        <button className="flex flex-col items-center text-xs" type="button">
          <span>🟢</span>
          <span>Disponible</span>
        </button>
      </div>
    </>
  );
}
