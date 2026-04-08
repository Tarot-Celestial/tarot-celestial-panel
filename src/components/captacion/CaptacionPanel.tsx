"use client";

import { useEffect, useState } from "react";

export default function CaptacionPanel() {
  const [items, setItems] = useState<any[]>([]);

  async function load() {
    try {
      const res = await fetch("/api/captacion/list", {
        cache: "no-store",
      });

      const json = await res.json();

      if (json?.ok) {
        setItems(json.items || []);
      }
    } catch (err) {
      console.error("Error cargando captación", err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Captación</h2>

      {!items.length && <p>No hay leads</p>}

      {items.map((lead) => (
        <div key={lead.id} style={{ marginBottom: 10 }}>
          <div>{lead.cliente?.nombre}</div>
          <div>{lead.estado}</div>
        </div>
      ))}
    </div>
  );
}
