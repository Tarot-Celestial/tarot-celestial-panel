"use client";

import { useEffect, useState } from "react";

type Lead = {
  id: string;
  estado: string;
  cliente?: {
    nombre?: string;
    telefono?: string;
  };
};

export default function CaptacionPanel({ mode }: { mode?: string }) {
  const [items, setItems] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"pendientes" | "todos">("pendientes");

  async function load() {
    try {
      setLoading(true);

      const res = await fetch(`/api/captacion/list?scope=${view}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (json.ok) {
        setItems(json.items || []);
      }
    } catch (e) {
      console.error("Error captación", e);
    } finally {
      setLoading(false);
    }
  }

  async function act(id: string, action: string) {
    try {
      await fetch("/api/captacion/action", {
        method: "POST",
        body: JSON.stringify({ lead_id: id, action }),
        headers: { "Content-Type": "application/json" },
      });

      // 🔥 desaparecer instantáneo
      setItems((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      console.error("Error acción", e);
    }
  }

  useEffect(() => {
    load();
  }, [view]);

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ fontSize: 24, fontWeight: "bold" }}>Captación</h2>

      {/* 🔥 FILTROS */}
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button
          onClick={() => setView("pendientes")}
          style={{
            fontWeight: view === "pendientes" ? "bold" : "normal",
          }}
        >
          🔥 Pendientes
        </button>

        <button
          onClick={() => setView("todos")}
          style={{
            fontWeight: view === "todos" ? "bold" : "normal",
          }}
        >
          📋 Todos
        </button>
      </div>

      {loading && <p>Cargando...</p>}

      {!loading && !items.length && (
        <p style={{ opacity: 0.6, marginTop: 10 }}>
          No hay leads en esta vista
        </p>
      )}

      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {items.map((lead) => (
          <div
            key={lead.id}
            style={{
              border: "1px solid rgba(255,255,255,0.1)",
              padding: 16,
              borderRadius: 12,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div style={{ fontWeight: "bold", fontSize: 16 }}>
              {lead.cliente?.nombre || "Lead sin nombre"}
            </div>

            <div style={{ opacity: 0.7, marginTop: 4 }}>
              {lead.cliente?.telefono || "Sin teléfono"}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => act(lead.id, "contactado")}>
                ✅ Contactado
              </button>

              <button onClick={() => act(lead.id, "no_responde")}>
                📞 No responde
              </button>

              <button onClick={() => act(lead.id, "no_interesado")}>
                🙅 No interesado
              </button>

              <button onClick={() => act(lead.id, "numero_invalido")}>
                ❌ Número inválido
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
