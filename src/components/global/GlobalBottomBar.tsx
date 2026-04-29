"use client";

import { useState } from "react";

export default function GlobalBottomBar() {
  const [phoneOpen, setPhoneOpen] = useState(false);

  return (
    <>
      {/* 📞 SOFTPHONE */}
      {phoneOpen && (
        <div className="fixed bottom-16 right-4 z-50 bg-zinc-800 p-4 rounded-xl shadow-lg">
          <div className="text-white">Softphone aquí</div>
        </div>
      )}

      {/* 🔻 BARRA */}
      <div className="fixed bottom-0 left-0 w-full h-14 bg-zinc-900 border-t border-zinc-700 flex items-center justify-around z-40 text-white">

        <button onClick={() => setPhoneOpen(!phoneOpen)}>
          📞 Teléfono
        </button>

        <button>
          🅿️ Parking (0)
        </button>

        <button>
          🔥 Leads (0)
        </button>

        <button>
          🟢 Disponible
        </button>

      </div>
    </>
  );
}
