"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { tcToast } from "@/lib/tc-toast";

const sb = supabaseBrowser();

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

type ReservasPanelProps = {
  mode?: "admin" | "central";
  embedded?: boolean;
};

function estadoLabel(v: any) {
  return String(v || "") === "finalizada" ? "✅ Finalizada" : "⏳ Pendiente";
}

function estadoStyles(v: any) {
  if (String(v || "") === "finalizada") {
    return {
      border: "1px solid rgba(120,255,190,.20)",
      background: "linear-gradient(180deg, rgba(120,255,190,.06), rgba(255,255,255,.02))",
      boxShadow: "0 12px 32px rgba(0,0,0,.18)",
      chipBg: "rgba(120,255,190,.10)",
      chipBorder: "1px solid rgba(120,255,190,.22)",
    };
  }

  return {
    border: "1px solid rgba(215,181,109,.22)",
    background: "linear-gradient(180deg, rgba(215,181,109,.08), rgba(255,255,255,.02))",
    boxShadow: "0 14px 36px rgba(0,0,0,.22), 0 0 0 1px rgba(215,181,109,.06) inset",
    chipBg: "rgba(215,181,109,.12)",
    chipBorder: "1px solid rgba(215,181,109,.24)",
  };
}

function formatFecha(value: any) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("es-ES");
  } catch {
    return String(value);
  }
}

export default function ReservasPanel({
  mode = "admin",
  embedded = false,
}: ReservasPanelProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"proximas" | "hoy" | "todas" | "finalizadas">("proximas");
  const [finalizandoId, setFinalizandoId] = useState("");

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function loadReservas(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
        setMsg("");
      }

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/reservas/listar", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      setRows(Array.isArray(j.reservas) ? j.reservas : []);
      if (!silent) {
        setMsg(`✅ Reservas cargadas: ${Array.isArray(j.reservas) ? j.reservas.length : 0}`);
      }
    } catch (e: any) {
      if (!silent) setMsg(`❌ ${e?.message || "Error cargando reservas"}`);
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function finalizarReserva(id: string) {
    if (!id) return;

    try {
      setFinalizandoId(id);
      setMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/reservas/finalizar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      // 🔥 UPDATE INSTANTÁNEO
      setRows((prev) =>
        prev.map((row) =>
          String(row.id) === String(id)
            ? { ...row, estado: "finalizada" }
            : row
        )
      );

      setMsg("✅ Reserva finalizada");
      tcToast({title:"Reserva finalizada",description:"Todo correcto",tone:"success"});

      // 🔄 refresco real
      await loadReservas(false);

    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error finalizando reserva"}`);
    } finally {
      setFinalizandoId("");
    }
  }

  useEffect(() => {
    loadReservas(false);
    const t = setInterval(() => loadReservas(true), 15000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    let list = [...(rows || [])];

    list.sort((a: any, b: any) => {
      const ae = String(a?.estado || "") === "finalizada" ? 1 : 0;
      const be = String(b?.estado || "") === "finalizada" ? 1 : 0;
      if (ae !== be) return ae - be;

      const at = a?.fecha_reserva ? new Date(a.fecha_reserva).getTime() : 0;
      const bt = b?.fecha_reserva ? new Date(b.fecha_reserva).getTime() : 0;

      return at - bt;
    });

    return list;
  }, [rows]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {filtered.map((r: any) => (
        <div key={r.id}>
          <div>{r.cliente_nombre}</div>
          <div>{r.estado}</div>

          {String(r.estado) !== "finalizada" && (
            <button onClick={() => finalizarReserva(String(r.id))}>
              {finalizandoId === String(r.id) ? "Guardando..." : "Finalizar"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

