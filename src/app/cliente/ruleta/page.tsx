import { Gift } from "lucide-react";
import PurchaseRoulette from "@/components/cliente/PurchaseRoulette";
import PanelShell from "@/components/cliente/PanelShell";
import { requireClienteProfile } from "@/lib/server/require-cliente-profile";
import { panelThemeVars } from "@/lib/panel-theme";

export const dynamic = "force-dynamic";

export default async function ClienteRuletaPage() {
  const profile = await requireClienteProfile();
  return (
    <PanelShell>
      <section style={{ ...panelThemeVars(profile.rango_actual || profile.rango, true), display: "grid", gap: 18 }}>
        <div className="tc-card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Gift size={18} />
            <strong>Ruletas clientes</strong>
          </div>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Compra, gana giros y descubre premios reales. Si eres cliente Diamante, además disfrutas de la
            Ruleta Diamante: un beneficio premium con 1 giro por cada compra válida.
          </p>
        </div>
        <PurchaseRoulette />
      </section>
    </PanelShell>
  );
}
