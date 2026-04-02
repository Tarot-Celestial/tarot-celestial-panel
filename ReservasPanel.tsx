(use client)

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

export default function ReservasPanel({ mode = "admin", embedded = false }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
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

  async function loadReservas() {
    const token = await getTokenOrLogin();
    if (!token) return;

    const r = await fetch("/api/crm/reservas/listar", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const j = await safeJson(r);
    setRows(j.reservas || []);
  }

  async function finalizarReserva(id: string) {
    setFinalizandoId(id);

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

    if (j.ok) {
      // 🔥 FIX REAL
      setRows((prev) =>
        prev.map((r) =>
          String(r.id) === String(id)
            ? { ...r, estado: "finalizada" }
            : r
        )
      );

      tcToast({ title: "Reserva finalizada", tone: "success" });

      await loadReservas();
    }

    setFinalizandoId("");
  }

  useEffect(() => {
    loadReservas();
  }, []);

  return (
    <div>
      {rows.map((r) => (
        <div key={r.id}>
          <div>{r.cliente_nombre}</div>
          <div>{r.estado}</div>

          {r.estado !== "finalizada" && (
            <button onClick={() => finalizarReserva(r.id)}>
              {finalizandoId === r.id ? "..." : "Finalizar"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
