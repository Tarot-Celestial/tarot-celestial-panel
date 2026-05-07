"use client";

type OperatorPanelProps = {
  mode: "admin" | "central";
};

/**
 * Parking/SIP management temporarily disabled to stop ps_endpoints writes and
 * Asterisk polling while the panel is stabilized on Supabase Nano.
 */
export default function OperatorPanel({ mode }: OperatorPanelProps) {
  return (
    <section className="tc-card" style={{ padding: 18 }}>
      <div className="tc-title">☎ Telefonía y Parking desactivados</div>
      <p className="tc-sub" style={{ marginTop: 8 }}>
        Se ha inhabilitado temporalmente la gestión SIP, Asterisk Realtime y Parking para estabilizar el panel.
      </p>
      <p className="tc-sub" style={{ marginTop: 8 }}>
        El CRM, reservas, asistencia y funciones principales siguen funcionando. Cuando quieras reactivar telefonía,
        lo hacemos con backoff y sin escrituras constantes a <code>ps_endpoints</code>.
      </p>
    </section>
  );
}
