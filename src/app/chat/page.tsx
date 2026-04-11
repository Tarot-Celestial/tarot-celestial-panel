"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import ClienteLayout from "@/components/cliente/ClienteLayout";

const sb = supabaseBrowser();

function fmt(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function ClienteChatPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [cliente, setCliente] = useState<any>(null);
  const [creditos, setCreditos] = useState(0);
  const [tarotistas, setTarotistas] = useState<any[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [thread, setThread] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);

  const summaryItems = useMemo(() => [
    { label: "Créditos chat", value: String(creditos), meta: "Después de la primera consulta gratis, cada nuevo mensaje del cliente consume 1 crédito" },
    { label: "Tarotistas visibles", value: String(tarotistas.length), meta: "Pulsa en una tarotista para abrir o continuar tu hilo" },
    { label: "Consulta gratis", value: thread?.free_consulta_usada ? "Usada" : "Disponible", meta: thread?.free_consulta_usada ? "Ya has consumido la consulta inicial de este hilo" : "Tu primer mensaje y la primera respuesta son gratis" },
  ], [creditos, tarotistas.length, thread?.free_consulta_usada]);

  const loadTarotistas = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/cliente/login";
      return;
    }

    const res = await fetch("/api/cliente/chat/tarotistas", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "No se pudo cargar el panel de chat.");
      setLoading(false);
      return;
    }
    setCliente(json.cliente || null);
    setCreditos(Number(json.creditos_disponibles || 0));
    setTarotistas(Array.isArray(json.tarotistas) ? json.tarotistas : []);
    if (!selectedWorkerId) {
      const firstActive = (json.tarotistas || []).find((item: any) => item.status_key !== "desconectada");
      if (firstActive?.id) setSelectedWorkerId(String(firstActive.id));
    }
    setLoading(false);
  }, [selectedWorkerId]);

  const loadThread = useCallback(async () => {
    if (!selectedWorkerId) return;
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch(`/api/cliente/chat/thread?worker_id=${encodeURIComponent(selectedWorkerId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "No se pudo abrir el chat.");
      return;
    }
    setThread(json.thread || null);
    setMessages(Array.isArray(json.messages) ? json.messages : []);
    setCreditos(Number(json.creditos_disponibles || 0));
  }, [selectedWorkerId]);

  useEffect(() => {
    loadTarotistas();
  }, [loadTarotistas]);

  useEffect(() => {
    if (!selectedWorkerId) return;
    loadThread();
    const id = window.setInterval(() => loadThread(), 5000);
    return () => window.clearInterval(id);
  }, [selectedWorkerId, loadThread]);

  useEffect(() => {
  const params = new URLSearchParams(window.location.search);

  if (params.get("checkout") === "ok") {
    setMsg("✅ Pago completado. Tus créditos de chat se actualizarán en unos segundos.");
    window.history.replaceState({}, "", "/chat");

    window.setTimeout(() => {
      loadTarotistas();
      loadThread();
    }, 1200);
  }

  if (params.get("checkout") === "cancelled") {
    setMsg("Has cancelado el pago del chat. Puedes volver a intentarlo cuando quieras.");
    window.history.replaceState({}, "", "/chat");
  }
}, [loadTarotistas, loadThread]);

  async function sendMessage() {
    const text = composer.trim();
    if (!text || !selectedWorkerId) return;
    try {
      setSending(true);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/cliente/chat/thread", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ worker_id: selectedWorkerId, thread_id: thread?.id || null, body: text }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 402 || json?.need_payment) {
        setMsg("Ya has usado la consulta gratis. Pide a la tarotista que te envíe un enlace de pago o espera a que admin te cargue créditos.");
        return;
      }
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo enviar el mensaje");
      setComposer("");
      await loadThread();
      await loadTarotistas();
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSending(false);
    }
  }

  const activeTarotista =
  tarotistas.find((item: any) => String(item.id) === String(selectedWorkerId)) || null;

return (
  <ClienteLayout
    title="Consultas por chat"
    eyebrow="Tarot Celestial · Chat"
    subtitle="Elige una tarotista disponible, envía tu primera consulta gratis y continúa la conversación con créditos cuando quieras profundizar."
    summaryItems={summaryItems}
  >
    <div className="tc-grid" style={{ display: "grid", gap: 18 }}>
      {msg ? (
        <div className="tc-card">
          <div className="tc-sub">{msg}</div>
        </div>
      ) : null}

      {/* LISTA TAROTISTAS */}
      <section className="tc-card">
        <div className="tc-title">Tarotistas disponibles</div>

        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {(tarotistas || []).map((worker: any) => (
            <button
              key={worker.id}
              onClick={() => setSelectedWorkerId(String(worker.id))}
              className="tc-card"
            >
              {worker.display_name}
            </button>
          ))}
        </div>
      </section>

      {/* CHAT */}
      <section className="tc-card">
        <div className="tc-title">
          {activeTarotista?.display_name || "Selecciona una tarotista"}
        </div>

        <div style={{ marginTop: 16 }}>
          {(messages || []).map((m: any) => (
            <div key={m.id}>{m.body}</div>
          ))}
        </div>

        <textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
        />

        <button onClick={sendMessage}>
          Enviar
        </button>
      </section>
    </div>
  </ClienteLayout>
);
}
