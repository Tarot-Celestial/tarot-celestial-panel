"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, SendHorizontal, WandSparkles, Heart, Coins, MoonStar, Stars } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

const TOPICS = [
  { id: "general", label: "General", icon: Stars },
  { id: "amor", label: "Amor", icon: Heart },
  { id: "dinero", label: "Dinero", icon: Coins },
  { id: "energia", label: "Energía", icon: MoonStar },
];

type Lectura = {
  id?: string;
  tema?: string;
  titulo?: string;
  prediccion?: string;
  energia?: string;
  cierre?: string;
  fecha?: string;
};

type Mensaje = {
  id: string;
  role: "user" | "assistant";
  contenido: string;
  created_at?: string;
};

type Cliente = {
  nombre?: string | null;
  rango_actual?: string | null;
};

export default function ClienteOraculoPage() {
  const [tema, setTema] = useState("general");
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [pregunta, setPregunta] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [cliente, setCliente] = useState<Cliente | null>(null);

  async function withToken<T>(fn: (token: string) => Promise<T>) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/cliente/login";
      throw new Error("NO_AUTH");
    }
    return fn(token);
  }

  async function load(temaId = tema) {
    try {
      setLoading(true);
      setMsg("");
      await withToken(async (token) => {
        const [oracleRes, meRes] = await Promise.all([
          fetch(`/api/cliente/oraculo?tema=${encodeURIComponent(temaId)}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch("/api/cliente/me", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
        ]);

        const oracleJson = await oracleRes.json().catch(() => null);
        const meJson = await meRes.json().catch(() => null);
        if (!oracleJson?.ok) throw new Error(oracleJson?.error || "No hemos podido abrir el oráculo");
        if (meJson?.ok) setCliente(meJson?.cliente || null);
        setLectura(oracleJson?.lectura || null);
        setMensajes(Array.isArray(oracleJson?.mensajes) ? oracleJson.mensajes : []);
      });
    } catch (e: any) {
      if (e?.message !== "NO_AUTH") setMsg(e?.message || "No hemos podido abrir el oráculo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(tema);
  }, [tema]);

  async function sendQuestion() {
    const text = pregunta.trim();
    if (!text) return;
    try {
      setSending(true);
      setMsg("");
      await withToken(async (token) => {
        const res = await fetch("/api/cliente/oraculo", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tema, pregunta: text }),
        });
        const json = await res.json().catch(() => null);
        if (!json?.ok) throw new Error(json?.error || "No hemos podido enviar tu pregunta.");
        setMensajes(Array.isArray(json?.mensajes) ? json.mensajes : []);
        setPregunta("");
      });
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido enviar tu pregunta.");
    } finally {
      setSending(false);
    }
  }

  const topicLabel = useMemo(() => TOPICS.find((item) => item.id === tema)?.label || "General", [tema]);

  return (
    <ClienteLayout
      title="Oráculo diario"
      subtitle="Escoge un tema, recibe una lectura del día y profundiza con tus preguntas dentro de un mini chat espiritual."
      summaryItems={[
        { label: "Tema activo", value: topicLabel, meta: "Puedes cambiarlo cuando quieras" },
        { label: "Tu rango", value: String(cliente?.rango_actual || "Bronce"), meta: "Influye en el tono de la lectura" },
        { label: "Formato", value: "Lectura + chat", meta: "Ideal para volver a llamar con más claridad" },
      ]}
    >
      {msg ? <div className="tc-card tc-golden-panel">{msg}</div> : null}

      <div className="tc-dashboard-grid">
        <div className="tc-stack">
          <section className="tc-card tc-golden-panel" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="tc-panel-title">Selecciona el tema del día</div>
              <div className="tc-panel-sub">Cada tema te abre una lectura distinta para hoy y mantiene el hilo del chat dentro del mismo enfoque.</div>
            </div>
            <div className="tc-topic-grid">
              {TOPICS.map((item) => {
                const Icon = item.icon;
                const active = item.id === tema;
                return (
                  <button
                    key={item.id}
                    className={`tc-topic-card ${active ? "tc-topic-card-active" : ""}`}
                    onClick={() => setTema(item.id)}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="tc-card tc-oracle-stage">
            {loading ? (
              <div className="tc-empty-state">Cargando tu lectura…</div>
            ) : (
              <>
                <div className="tc-oracle-badge"><Sparkles size={14} /> Lectura del día</div>
                <div className="tc-panel-title" style={{ fontSize: 28 }}>{lectura?.titulo || "Tu energía se está alineando"}</div>
                <div className="tc-oracle-reading">{lectura?.prediccion || "No hemos podido recuperar la lectura."}</div>
                <div className="tc-list-card">
                  <div className="tc-list-item">
                    <div className="tc-list-item-title">Clave energética</div>
                    <div className="tc-list-item-sub">{lectura?.energia || "Escucha lo que hoy se repite más de una vez."}</div>
                  </div>
                  <div className="tc-list-item">
                    <div className="tc-list-item-title">Cierre del oráculo</div>
                    <div className="tc-list-item-sub">{lectura?.cierre || "Si deseas una respuesta más precisa, profundiza con una consulta."}</div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="tc-stack">
          <section className="tc-card" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="tc-panel-title">Chat del oráculo</div>
              <div className="tc-panel-sub">Haz una pregunta concreta y el oráculo te responderá dentro del tema que has elegido.</div>
            </div>

            <div className="tc-oracle-chat">
              {mensajes.length === 0 ? <div className="tc-empty-state">Todavía no has hecho ninguna pregunta en este tema.</div> : null}
              {mensajes.map((item) => (
                <div key={item.id} className={`tc-oracle-bubble ${item.role === "user" ? "tc-oracle-bubble-user" : "tc-oracle-bubble-assistant"}`}>
                  {item.role === "assistant" ? <WandSparkles size={15} /> : null}
                  <div>{item.contenido}</div>
                </div>
              ))}
            </div>

            <div className="tc-oracle-compose">
              <textarea
                className="tc-input tc-textarea"
                placeholder={`Ejemplo: ¿Qué debo observar hoy en ${topicLabel.toLowerCase()}?`}
                value={pregunta}
                onChange={(e) => setPregunta(e.target.value)}
              />
              <button className="tc-btn tc-btn-gold" disabled={sending} onClick={sendQuestion}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <SendHorizontal size={16} /> {sending ? "Consultando..." : "Preguntar al oráculo"}
                </span>
              </button>
            </div>
          </section>

          <section className="tc-card tc-golden-panel" style={{ display: "grid", gap: 10 }}>
            <div className="tc-list-item-title">Consejo de uso</div>
            <div className="tc-list-item-sub">
              Usa el oráculo para afinar el tema y después llama con una pregunta más concreta. Eso suele mejorar mucho la calidad de la consulta real.
            </div>
          </section>
        </div>
      </div>
    </ClienteLayout>
  );
}
