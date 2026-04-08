"use client";

import { useEffect, useState } from "react";

type Lead = {
  id: string;
  estado: string;
  next_contact_at?: string;
  cliente?: {
    nombre?: string;
    telefono?: string;
  };
};

export default function CaptacionPanel() {
  const [items, setItems] = useState<Lead[]>([]);
  const [view, setView] = useState<"pendientes" | "todos">("pendientes");

  async function load() {
    const res = await fetch(`/api/captacion/list?scope=${view}`, {
      cache: "no-store",
    });
    const json = await res.json();
    if (json.ok) setItems(json.items || []);
  }

  async function act(id: string, action: string) {
    await fetch("/api/captacion/action", {
      method: "POST",
      body: JSON.stringify({ lead_id: id, action }),
      headers: { "Content-Type": "application/json" },
    });

    setItems((prev) => prev.filter((l) => l.id !== id));
  }

  useEffect(() => {
    load();
  }, [view]);

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 28, fontWeight: 800 }}>🔥 Captación</h2>

      {/* FILTROS */}
      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <button
          onClick={() => setView("pendientes")}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: "none",
            background:
              view === "pendientes"
                ? "linear-gradient(135deg,#8b5cf6,#6366f1)"
                : "rgba(255,255,255,0.1)",
            color: "white",
            fontWeight: 600,
          }}
        >
          🔥 Pendientes
        </button>

        <button
          onClick={() => setView("todos")}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: "none",
            background:
              view === "todos"
                ? "linear-gradient(135deg,#8b5cf6,#6366f1)"
                : "rgba(255,255,255,0.1)",
            color: "white",
            fontWeight: 600,
          }}
        >
          📋 Todos
        </button>
      </div>

      {/* LISTA */}
      <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
        {items.map((lead) => {
          const urgent =
            lead.next_contact_at &&
            new Date(lead.next_contact_at).getTime() < Date.now();

          return (
            <div
              key={lead.id}
              style={{
                borderRadius: 16,
                padding: 16,
                background: urgent
                  ? "rgba(255,80,80,0.15)"
                  : "rgba(255,255,255,0.04)",
                border: urgent
                  ? "1px solid rgba(255,80,80,0.4)"
                  : "1px solid rgba(255,255,255,0.08)",
                boxShadow: urgent
                  ? "0 0 20px rgba(255,80,80,0.2)"
                  : "none",
              }}
            >
              {/* INFO */}
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                {lead.cliente?.nombre || "Lead sin nombre"}
              </div>

              <div style={{ opacity: 0.6, marginTop: 4 }}>
                {lead.cliente?.telefono || "Sin teléfono"}
              </div>

              {urgent && (
                <div style={{ color: "#ff6b6b", marginTop: 6 }}>
                  ⚠️ Llamar YA
                </div>
              )}

              {/* BOTONES */}
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => act(lead.id, "contactado")}
                  style={{
                    background: "#22c55e",
                    color: "white",
                    border: "none",
                    padding: "6px 10px",
                    borderRadius: 8,
                  }}
                >
                  ✅ Contactado
                </button>

                <button
                  onClick={() => act(lead.id, "no_responde")}
                  style={{
                    background: "#f59e0b",
                    color: "white",
                    border: "none",
                    padding: "6px 10px",
                    borderRadius: 8,
                  }}
                >
                  📞 No responde
                </button>

                <button
                  onClick={() => act(lead.id, "no_interesado")}
                  style={{
                    background: "#6366f1",
                    color: "white",
                    border: "none",
                    padding: "6px 10px",
                    borderRadius: 8,
                  }}
                >
                  🙅 No interesado
                </button>

                <button
                  onClick={() => act(lead.id, "numero_invalido")}
                  style={{
                    background: "#ef4444",
                    color: "white",
                    border: "none",
                    padding: "6px 10px",
                    borderRadius: 8,
                  }}
                >
                  ❌ Número inválido
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
