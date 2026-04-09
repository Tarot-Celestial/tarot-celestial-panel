"use client";

import { Gift, Sparkles } from "lucide-react";

type Recompensa = {
  id: string;
  nombre: string;
  puntos_coste: number;
  minutos_otorgados: number;
  activo?: boolean | null;
};

type Props = {
  puntos: number;
  recompensas: Recompensa[];
  loading: boolean;
  onRedeem: (recompensaId: string) => Promise<void>;
};

export default function CanjePuntos({ puntos, recompensas, loading, onRedeem }: Props) {
  return (
    <div className="tc-card tc-golden-panel" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div className="tc-panel-title">Canjear puntos por minutos</div>
        <div className="tc-panel-sub">Los minutos canjeados se guardan como minutos free pendientes en tu ficha.</div>
      </div>

      <div className="tc-list-card">
        {recompensas.map((item) => {
          const disabled = loading || puntos < Number(item.puntos_coste || 0);
          return (
            <div
              key={item.id}
              className="tc-list-item"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <div className="tc-row" style={{ gap: 8 }}>
                  <Gift size={16} style={{ color: "var(--tc-gold-2)" }} />
                  <div className="tc-list-item-title">{item.nombre}</div>
                </div>
                <div className="tc-list-item-sub">
                  {item.puntos_coste} puntos · {item.minutos_otorgados} minutos free
                </div>
              </div>
              <button className="tc-btn tc-btn-gold" disabled={disabled} onClick={() => onRedeem(item.id)}>
                {disabled && puntos < Number(item.puntos_coste || 0) ? "Puntos insuficientes" : loading ? "Canjeando..." : "Canjear"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="tc-row" style={{ gap: 8, color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
        <Sparkles size={14} style={{ color: "var(--tc-gold-2)" }} /> Tu saldo actual es de <strong>{puntos}</strong> puntos.
      </div>
    </div>
  );
}
