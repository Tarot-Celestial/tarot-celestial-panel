"use client";

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
    <div className="tc-card" style={{ display: "grid", gap: 12 }}>
      <div>
        <div className="tc-title" style={{ fontSize: 20 }}>Canjear puntos por minutos</div>
        <div className="tc-muted">Los minutos canjeados se guardan como minutos free pendientes en tu ficha.</div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {recompensas.map((item) => {
          const disabled = loading || puntos < Number(item.puntos_coste || 0);
          return (
            <div
              key={item.id}
              className="tc-card"
              style={{
                padding: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontWeight: 800 }}>{item.nombre}</div>
                <div className="tc-muted">
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
    </div>
  );
}
