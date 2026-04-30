"use client";

type ClienteSidebarProps = {
  cliente?: any;
  pagos?: any[];
  notas?: any[];
  etiquetas?: string[];
  onCall?: () => void;
  onAutoCall?: () => void;
  onRegisterCall?: () => void;
  onGoToNotes?: () => void;
  onGoToReservation?: () => void;
  dialDisabled?: boolean;
};

function eur(value: any) {
  const n = Number(value) || 0;
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function paymentAmount(pago: any) {
  return Number(pago?.importe ?? pago?.amount ?? pago?.total ?? pago?.precio ?? 0) || 0;
}

function activityScore(cliente: any, pagos: any[], notas: any[]) {
  const total = pagos.reduce((sum, p) => sum + paymentAmount(p), 0);
  const minutes = Number(cliente?.minutos_free_pendientes || 0) + Number(cliente?.minutos_normales_pendientes || 0);
  if (total >= 500 || String(cliente?.rango_actual || "").toLowerCase() === "oro") return { label: "🔥 Cliente caliente", tone: "hot" as const };
  if (total >= 100 || minutes > 0 || notas.length >= 3 || String(cliente?.rango_actual || "").toLowerCase() === "plata") return { label: "🟡 Seguimiento activo", tone: "warm" as const };
  return { label: "❄️ Cliente frío", tone: "cold" as const };
}

function statusStyle(tone: "hot" | "warm" | "cold") {
  if (tone === "hot") return { background: "rgba(255,90,106,.14)", border: "1px solid rgba(255,90,106,.30)", color: "#ffd4d8" };
  if (tone === "warm") return { background: "rgba(215,181,109,.14)", border: "1px solid rgba(215,181,109,.30)", color: "#f7dfab" };
  return { background: "rgba(122,162,255,.12)", border: "1px solid rgba(122,162,255,.24)", color: "#d7e2ff" };
}

export default function ClienteSidebar({
  cliente,
  pagos = [],
  notas = [],
  etiquetas = [],
  onCall,
  onAutoCall,
  onRegisterCall,
  onGoToNotes,
  onGoToReservation,
  dialDisabled = false,
}: ClienteSidebarProps) {
  const totalPagado = pagos.reduce((sum, pago) => sum + paymentAmount(pago), 0);
  const status = activityScore(cliente, pagos, notas);
  const fullName = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ") || "Cliente sin nombre";
  const free = Number(cliente?.minutos_free_pendientes || 0);
  const normales = Number(cliente?.minutos_normales_pendientes || 0);
  const lastNote = notas?.[0]?.created_at || notas?.[0]?.updated_at || null;

  return (
    <div className="tc-card" style={{ borderRadius: 20, padding: 16, background: "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))", position: "sticky", top: 16 }}>
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div className="tc-title" style={{ fontSize: 18 }}>{fullName}</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>{cliente?.telefono || "Sin teléfono"}</div>
        </div>
        <span className="tc-chip" style={statusStyle(status.tone)}>{status.label}</span>
      </div>

      <div className="tc-hr" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
        <MiniMetric label="Pagado" value={eur(totalPagado)} />
        <MiniMetric label="Pagos" value={String(pagos.length)} />
        <MiniMetric label="Min free" value={String(free)} />
        <MiniMetric label="Min normales" value={String(normales)} />
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <InfoRow label="Rango" value={cliente?.rango_actual || "Sin rango"} />
        <InfoRow label="Origen" value={cliente?.origen || "—"} />
        <InfoRow label="Última nota" value={dateLabel(lastNote)} />
        <InfoRow label="Web" value={cliente?.onboarding_completado ? "Activa" : cliente?.total_accesos ? "Pendiente" : "No registrado"} />
      </div>

      {etiquetas.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {etiquetas.slice(0, 8).map((et) => <span key={et} className="tc-chip">{et}</span>)}
        </div>
      ) : null}

      <div className="tc-hr" />

      <div style={{ display: "grid", gap: 8 }}>
        <button className="tc-btn tc-btn-gold" type="button" onClick={onAutoCall} disabled={dialDisabled}>📞 Llamar ahora</button>
        <button className="tc-btn" type="button" onClick={onCall} disabled={dialDisabled}>☎️ Enviar al softphone</button>
        <button className="tc-btn" type="button" onClick={onRegisterCall}>🧾 Registrar llamada</button>
        <button className="tc-btn" type="button" onClick={onGoToReservation}>📅 Crear reserva</button>
        <button className="tc-btn" type="button" onClick={onGoToNotes}>📝 Añadir nota</button>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.10)", borderRadius: 14, padding: 10, background: "rgba(255,255,255,.035)" }}>
      <div className="tc-sub">{label}</div>
      <div style={{ fontWeight: 900, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
      <span className="tc-sub">{label}</span>
      <b style={{ textAlign: "right" }}>{value}</b>
    </div>
  );
}
