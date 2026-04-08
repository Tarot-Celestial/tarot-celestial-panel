"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type LeadItem = {
  id: string;
  cliente_id: string;
  estado: string;
  intento_actual: number;
  max_intentos: number;
  next_contact_at: string | null;
  last_contact_at: string | null;
  created_at: string;
  campaign_name?: string | null;
  form_name?: string | null;
  origen?: string | null;
  cliente?: {
    nombre?: string | null;
    apellido?: string | null;
    telefono?: string | null;
    email?: string | null;
  } | null;
};

function fullName(lead: LeadItem) {
  const n = [lead?.cliente?.nombre, lead?.cliente?.apellido]
    .filter(Boolean)
    .join(" ")
    .trim();
  return n || "Lead sin nombre";
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES");
}

function stateLabel(s: string) {
  const x = String(s || "nuevo").toLowerCase();
  if (x === "nuevo") return "🔥 Nuevo";
  if (x === "reintento_2") return "📞 2º intento";
  if (x === "reintento_3") return "📞 3º intento";
  if (x === "contactado") return "✅ Contactado";
  if (x === "no_interesado") return "🙅 No interesado";
  if (x === "numero_invalido") return "❌ Número inválido";
  if (x === "perdido") return "⌛ Sin respuesta";
  return x;
}

export default function CaptacionPanel({ mode }: { mode: "admin" | "central" }) {
  const [items, setItems] = useState<LeadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"pendientes" | "todos">("pendientes");

  // 🔥 FETCH SIMPLE Y DIRECTO (SIN AUTH, SIN HISTORIAS)
  async function load() {
    try {
      setLoading(true);

      const res = await fetch(
        `https://nextjs-boilerplate-one-azure-28.vercel.app/api/captacion/list?scope=${view}`,
        {
          cache: "no-store",
        }
      );

      const json = await res.json();

      console.log("CAPTACION RESPONSE:", json);

      if (!json?.ok) throw new Error(json?.error || "Error");

      setItems(json.items || []);
    } catch (err) {
      console.error("ERROR CARGANDO CAPTACION:", err);
    } finally {
      setLoading(false);
    }
  }

  // 🔥 carga inicial
  useEffect(() => {
    load();
  }, [view]);

  // 🔥 refresco automático
  useEffect(() => {
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [view]);

  // 🔥 realtime
  useEffect(() => {
    const channel = sb
      .channel("captacion-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "captacion_leads" },
        () => load()
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, []);

  const stats = useMemo(() => {
    return {
      total: items.length,
      nuevos: items.filter((x) => x.estado === "nuevo").length,
    };
  }, [items]);

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Captación</h1>

      <div style={{ marginTop: 10 }}>
        <button onClick={() => setView("pendientes")}>Pendientes</button>
        <button onClick={() => setView("todos")}>Todos</button>
      </div>

      <div style={{ marginTop: 10 }}>
        Total: {stats.total} | Nuevos: {stats.nuevos}
      </div>

      {loading && <p>Cargando...</p>}

      {!loading && !items.length && (
        <p>No hay leads en captación ahora mismo.</p>
      )}

      <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
        {items.map((lead) => (
          <div
            key={lead.id}
            style={{
              border: "1px solid #333",
              borderRadius: 10,
              padding: 10,
            }}
          >
            <b>{fullName(lead)}</b>
            <div>{lead?.cliente?.telefono}</div>
            <div>{lead?.cliente?.email}</div>
            <div>{stateLabel(lead.estado)}</div>
            <div>Intento {lead.intento_actual}</div>
            <div>Próximo: {fmtDate(lead.next_contact_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
