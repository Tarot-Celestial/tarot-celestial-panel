"use client";

import { Gift } from "lucide-react";

type Props = {
  open: boolean;
  minutes?: number;
  onClose: () => void;
};

export default function BonusBienvenidaModal({ open, minutes = 10, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5,8,18,.72)",
        display: "grid",
        placeItems: "center",
        zIndex: 90,
        padding: 16,
      }}
    >
      <div
        className="tc-card"
        style={{
          width: "min(560px, 100%)",
          display: "grid",
          gap: 18,
          padding: 24,
          textAlign: "center",
          background:
            "radial-gradient(circle at top, rgba(215,181,109,.22), transparent 28%), linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04))",
          border: "1px solid rgba(215,181,109,.28)",
          boxShadow: "0 26px 80px rgba(0,0,0,.48)",
        }}
      >
        <div
          style={{
            width: 74,
            height: 74,
            margin: "0 auto",
            borderRadius: 24,
            display: "grid",
            placeItems: "center",
            background: "rgba(215,181,109,.18)",
            border: "1px solid rgba(215,181,109,.28)",
          }}
        >
          <Gift size={34} />
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="tc-title" style={{ fontSize: 30 }}>Felicidades</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Acabas de ganar {minutes} minutos gratis de consulta.</div>
          <div className="tc-muted">
            Ya los hemos añadido a tus minutos free pendientes para que puedas disfrutarlos en tu próxima consulta.
          </div>
        </div>
        <div className="tc-row" style={{ justifyContent: "center" }}>
          <button className="tc-btn tc-btn-gold" onClick={onClose}>¡Qué bien!</button>
        </div>
      </div>
    </div>
  );
}
