"use client";

import { useEffect, useState } from "react";
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

export default function ReservasPanel({ mode = "admin" }: any) {
  const [rows, setRows] = useState<any[]>([]);
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
      setRows((prev) =>
        prev.map((row) =>
          String(row.id) === String(id)
            ? { ...row, estado: "finalizada" }
            : row
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

  const pendientes = rows.filter((r) => r.estado !== "finalizada").length;
  const finalizadas = rows.filter((r) => r.estado === "finalizada").length;

  return (
    <div style={{ padding: 20 }}>
      <h2>Reservas premium</h2>

      <div style={{ marginBottom: 20 }}>
        Pendientes: {pendientes} | Finalizadas: {finalizadas} | Total: {rows.length}
      </div>

      {(rows || []).map((r) => (
        <div key={r.id} style={{ border: "1px solid #444", padding: 12, marginBottom: 10 }}>
          <div><strong>{r.cliente_nombre}</strong></div>
          <div>Estado: {r.estado}</div>

          {r.estado !== "finalizada" && (
            <button onClick={() => finalizarReserva(r.id)}>
              {finalizandoId === r.id ? "Guardando..." : "Finalizar"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
