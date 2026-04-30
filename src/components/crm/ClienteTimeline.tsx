"use client";

type TimelineItem = {
  id: string;
  type: "note" | "payment" | "client" | "minutes";
  icon: string;
  title: string;
  subtitle?: string;
  body?: string;
  date?: string | null;
  tone?: "gold" | "green" | "blue" | "red" | "muted";
};

type ClienteTimelineProps = {
  cliente?: any;
  pagos?: any[];
  notas?: any[];
  loadingPagos?: boolean;
  loadingNotas?: boolean;
};

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eur(value: any) {
  const n = Number(value) || 0;
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function getPaymentAmount(pago: any) {
  return pago?.importe ?? pago?.amount ?? pago?.total ?? pago?.precio ?? pago?.value ?? 0;
}

function getPaymentStatus(pago: any) {
  return String(pago?.estado || pago?.status || pago?.payment_status || "registrado");
}

function getPaymentDate(pago: any) {
  return pago?.created_at || pago?.fecha || pago?.paid_at || pago?.updated_at || null;
}

function getNoteDate(nota: any) {
  return nota?.created_at || nota?.updated_at || nota?.fecha || null;
}

function toneStyle(tone: TimelineItem["tone"]) {
  if (tone === "green") return { border: "rgba(105,240,177,.24)", bg: "rgba(105,240,177,.08)" };
  if (tone === "blue") return { border: "rgba(122,162,255,.24)", bg: "rgba(122,162,255,.08)" };
  if (tone === "red") return { border: "rgba(255,90,106,.24)", bg: "rgba(255,90,106,.08)" };
  if (tone === "gold") return { border: "rgba(215,181,109,.28)", bg: "rgba(215,181,109,.10)" };
  return { border: "rgba(255,255,255,.12)", bg: "rgba(255,255,255,.035)" };
}

export default function ClienteTimeline({ cliente, pagos = [], notas = [], loadingPagos = false, loadingNotas = false }: ClienteTimelineProps) {
  const items: TimelineItem[] = [];

  if (cliente?.id) {
    items.push({
      id: `client-${cliente.id}`,
      type: "client",
      icon: "👤",
      title: "Ficha abierta en CRM",
      subtitle: [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ") || `Cliente #${cliente.id}`,
      body: cliente?.origen ? `Origen: ${cliente.origen}` : undefined,
      date: cliente?.updated_at || cliente?.created_at || null,
      tone: "blue",
    });
  }

  const free = Number(cliente?.minutos_free_pendientes || 0);
  const normales = Number(cliente?.minutos_normales_pendientes || 0);
  if (free || normales) {
    items.push({
      id: `minutes-${cliente?.id || "active"}`,
      type: "minutes",
      icon: "⏱️",
      title: "Minutos pendientes",
      subtitle: `${free} free · ${normales} normales`,
      body: "Control rápido para decidir si llamar, reservar o derivar a tarotista.",
      date: cliente?.updated_at || null,
      tone: "gold",
    });
  }

  (pagos || []).forEach((pago: any, index: number) => {
    const status = getPaymentStatus(pago);
    const amount = getPaymentAmount(pago);
    const isError = status.toLowerCase().includes("error") || status.toLowerCase().includes("errone");
    items.push({
      id: `payment-${pago?.id || index}`,
      type: "payment",
      icon: isError ? "⚠️" : "💳",
      title: isError ? "Pago marcado como erróneo" : "Pago registrado",
      subtitle: `${eur(amount)} · ${status}`,
      body: pago?.notas || pago?.nota || pago?.referencia_externa || pago?.reference || undefined,
      date: getPaymentDate(pago),
      tone: isError ? "red" : "green",
    });
  });

  (notas || []).forEach((nota: any, index: number) => {
    items.push({
      id: `note-${nota?.id || index}`,
      type: "note",
      icon: nota?.is_pinned ? "📌" : "📝",
      title: nota?.is_pinned ? "Nota anclada" : "Nota CRM",
      subtitle: nota?.author_name || nota?.author_email || "Usuario",
      body: nota?.texto || nota?.text || nota?.nota || "—",
      date: getNoteDate(nota),
      tone: nota?.is_pinned ? "gold" : "muted",
    });
  });

  items.sort((a, b) => {
    const at = a.date ? new Date(a.date).getTime() : 0;
    const bt = b.date ? new Date(b.date).getTime() : 0;
    return bt - at;
  });

  const isLoading = loadingPagos || loadingNotas;

  return (
    <div className="tc-card" style={{ borderRadius: 20, padding: 16, background: "rgba(255,255,255,.03)" }}>
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div className="tc-title" style={{ fontSize: 16 }}>🧭 Timeline operativo</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Pagos, notas, minutos y actividad clave en una sola vista.
          </div>
        </div>
        <span className="tc-chip">{items.length} eventos</span>
      </div>

      <div className="tc-hr" />

      {isLoading ? <div className="tc-sub">Cargando actividad del cliente...</div> : null}

      {!isLoading && items.length === 0 ? (
        <div className="tc-sub">Todavía no hay actividad suficiente para construir el timeline.</div>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        {items.slice(0, 12).map((item) => {
          const style = toneStyle(item.tone);
          return (
            <div
              key={item.id}
              style={{
                display: "grid",
                gridTemplateColumns: "36px 1fr",
                gap: 10,
                border: `1px solid ${style.border}`,
                borderRadius: 16,
                padding: 12,
                background: style.bg,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  display: "grid",
                  placeItems: "center",
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(255,255,255,.10)",
                }}
              >
                {item.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>{item.title}</div>
                  <div className="tc-sub">{formatDate(item.date)}</div>
                </div>
                {item.subtitle ? <div className="tc-sub" style={{ marginTop: 4 }}>{item.subtitle}</div> : null}
                {item.body ? (
                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.45, color: "rgba(255,255,255,.90)" }}>
                    {String(item.body).slice(0, 480)}{String(item.body).length > 480 ? "…" : ""}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
