"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Coins, Gift, LockKeyhole, Sparkles, X } from "lucide-react";

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
  const [selected, setSelected] = useState<Recompensa | null>(null);
  const [rewardUnlocked, setRewardUnlocked] = useState<Recompensa | null>(null);

  const recompensasUnicas = useMemo(
    () => Array.from(new Map((recompensas || []).map((item) => [`${item.nombre}::${item.puntos_coste}::${item.minutos_otorgados}`, item])).values()),
    [recompensas]
  );

  async function confirmRedeem() {
    if (!selected || loading) return;
    const redeemed = selected;
    try {
      await onRedeem(redeemed.id);
      setSelected(null);
      setRewardUnlocked(redeemed);
    } catch {
      // El mensaje funcional lo gestiona el dashboard; el modal queda abierto para poder reintentar.
    }
  }

  return (
    <>
      <div className="tc-card tc-golden-panel tc-coins-store" style={{ display: "grid", gap: 16 }}>
        <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div className="tc-panel-title">Canjear Coins por minutos</div>
            <div className="tc-panel-sub">Convierte tu saldo real de Coins en minutos free. El canje utiliza exactamente el sistema actual de recompensas.</div>
          </div>
          <div className="tc-coin-balance-mini"><Coins size={16} /> {puntos.toLocaleString("es-ES")} Coins</div>
        </div>

        <div className="tc-reward-grid">
          {recompensasUnicas.map((item) => {
            const cost = Number(item.puntos_coste || 0);
            const affordable = puntos >= cost;
            const missing = Math.max(0, cost - puntos);
            return (
              <article key={item.id} className={`tc-reward-card ${affordable ? "tc-reward-card-ready" : "tc-reward-card-locked"}`}>
                <div className="tc-reward-card-topline">
                  <span className="tc-reward-kicker"><Gift size={14} /> Recompensa</span>
                  {affordable ? <Sparkles size={16} /> : <LockKeyhole size={16} />}
                </div>
                <div className="tc-reward-minutes">{Number(item.minutos_otorgados || 0)} <span>MINUTOS</span></div>
                <div className="tc-reward-name">{item.nombre}</div>
                <div className="tc-reward-cost"><Coins size={15} /> {cost.toLocaleString("es-ES")} Coins</div>
                {!affordable ? <div className="tc-reward-missing">Te faltan {missing.toLocaleString("es-ES")} Coins</div> : <div className="tc-reward-ready">Disponible para desbloquear</div>}
                <button
                  className="tc-btn tc-btn-gold tc-reward-button"
                  disabled={loading || !affordable}
                  onClick={() => setSelected(item)}
                >
                  {!affordable ? "Bloqueado" : loading ? "Canjeando..." : "Canjear"}
                </button>
              </article>
            );
          })}
        </div>

        <div className="tc-row tc-coins-store-foot" style={{ gap: 8 }}>
          <Coins size={15} /> Tu saldo actual es de <strong>{puntos.toLocaleString("es-ES")}</strong> Coins.
        </div>
      </div>

      {selected ? (
        <div className="tc-redeem-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) setSelected(null); }}>
          <div className="tc-redeem-modal" role="dialog" aria-modal="true" aria-labelledby="tc-redeem-title">
            <button className="tc-redeem-close" aria-label="Cerrar" disabled={loading} onClick={() => setSelected(null)}><X size={18} /></button>
            <div className="tc-redeem-coin"><Coins size={26} /></div>
            <div id="tc-redeem-title" className="tc-redeem-title">Confirmar canje</div>
            <div className="tc-redeem-copy">¿Canjear <strong>{Number(selected.puntos_coste || 0).toLocaleString("es-ES")} Coins</strong> por <strong>{Number(selected.minutos_otorgados || 0)} minutos</strong>?</div>
            <div className="tc-redeem-summary">
              <div><span>Saldo actual</span><strong>{puntos.toLocaleString("es-ES")} Coins</strong></div>
              <div><span>Saldo después</span><strong>{Math.max(0, puntos - Number(selected.puntos_coste || 0)).toLocaleString("es-ES")} Coins</strong></div>
            </div>
            <div className="tc-redeem-actions">
              <button className="tc-btn" disabled={loading} onClick={() => setSelected(null)}>Cancelar</button>
              <button className="tc-btn tc-btn-gold" disabled={loading} onClick={confirmRedeem}>{loading ? "Canjeando..." : "Confirmar canje"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {rewardUnlocked ? (
        <div className="tc-reward-toast" role="status">
          <div className="tc-reward-toast-icon"><CheckCircle2 size={22} /></div>
          <div>
            <strong>RECOMPENSA DESBLOQUEADA</strong>
            <span>+{Number(rewardUnlocked.minutos_otorgados || 0)} minutos · Ya están disponibles.</span>
          </div>
          <button aria-label="Cerrar" onClick={() => setRewardUnlocked(null)}><X size={15} /></button>
        </div>
      ) : null}
    </>
  );
}
