"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleDollarSign,
  Heart,
  LockKeyhole,
  MoonStar,
  SendHorizontal,
  Shuffle,
  Sparkles,
  Stars,
  WandSparkles,
} from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./Oracle.module.css";

const sb = supabaseBrowser();

const TOPICS = [
  { id: "general", label: "General", icon: Stars },
  { id: "amor", label: "Amor", icon: Heart },
  { id: "dinero", label: "Dinero", icon: CircleDollarSign },
  { id: "energia", label: "Energía", icon: MoonStar },
] as const;

type TopicId = (typeof TOPICS)[number]["id"];

type Draw = {
  id: string;
  tema: TopicId;
  fecha: string;
  cardId: string;
  cardName: string;
  cardImage: string;
  keyword: string;
  advice: string;
  message: string;
  isFree: boolean;
  revealedAt: string;
  selectedPosition: number;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  contenido: string;
  created_at?: string;
};

type ClientSummary = {
  nombre?: string | null;
  rango_actual?: string | null;
};

type Stage = "intro" | "shuffling" | "select" | "revealed";

export default function ClienteOraculoPage() {
  const [topic, setTopic] = useState<TopicId>("general");
  const [stage, setStage] = useState<Stage>("intro");
  const [draw, setDraw] = useState<Draw | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [freeAvailable, setFreeAvailable] = useState(true);
  const [creditsConfigured, setCreditsConfigured] = useState(false);
  const [shuffleId, setShuffleId] = useState("");
  const [canReveal, setCanReveal] = useState(true);
  const [deckSize, setDeckSize] = useState(22);
  const [message, setMessage] = useState("");
  const [client, setClient] = useState<ClientSummary | null>(null);

  async function withToken<T>(fn: (token: string) => Promise<T>) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/cliente/login";
      throw new Error("NO_AUTH");
    }
    return fn(token);
  }

  async function load() {
    try {
      setLoading(true);
      setMessage("");
      await withToken(async (token) => {
        const [oracleRes, meRes] = await Promise.all([
          fetch("/api/cliente/oraculo", {
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

        if (meJson?.ok) setClient(meJson.cliente || null);
        setFreeAvailable(Boolean(oracleJson.freeAvailable));
        setCreditsConfigured(Boolean(oracleJson.creditsConfigured));
        setDeckSize(Math.max(1, Number(oracleJson.deckSize || 22)));
        setMessages(Array.isArray(oracleJson.mensajes) ? oracleJson.mensajes : []);

        const latest = oracleJson.latestDraw as Draw | null;
        if (latest?.cardId) {
          setDraw(latest);
          setTopic(latest.tema || "general");
          setStage("revealed");
        } else {
          setDraw(null);
          setStage("intro");
        }
      });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "No hemos podido abrir el oráculo.";
      if (text !== "NO_AUTH") setMessage(text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function shuffleCards() {
    try {
      setMessage("");
      setStage("shuffling");
      await withToken(async (token) => {
        const res = await fetch("/api/cliente/oraculo", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "shuffle", tema: topic }),
        });
        const json = await res.json().catch(() => null);
        if (!json?.ok) throw new Error(json?.error || "No hemos podido barajar las cartas.");
        setShuffleId(String(json.shuffleId || ""));
        setCanReveal(Boolean(json.canReveal));
        setFreeAvailable(Boolean(json.freeAvailable));
        setCreditsConfigured(Boolean(json.creditsConfigured));
        setDeckSize(Math.max(1, Number(json.deckSize || 22)));
      });
      window.setTimeout(() => setStage("select"), 1450);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "No hemos podido barajar las cartas.";
      setMessage(text);
      setStage(draw ? "revealed" : "intro");
    }
  }

  async function revealCard(position: number) {
    if (revealing) return;
    if (!canReveal) {
      setMessage(
        creditsConfigured
          ? "Necesitas saldo disponible para realizar una nueva tirada."
          : "Tu primera tirada gratuita ya fue utilizada. Las nuevas tiradas estarán disponibles cuando se active el sistema de créditos del Oráculo.",
      );
      return;
    }

    try {
      setRevealing(true);
      setMessage("");
      await withToken(async (token) => {
        const res = await fetch("/api/cliente/oraculo", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reveal", tema: topic, position, shuffleId }),
        });
        const json = await res.json().catch(() => null);
        if (!json?.ok) throw new Error(json?.message || json?.error || "No hemos podido revelar tu carta.");
        setDraw(json.draw as Draw);
        setFreeAvailable(Boolean(json.freeAvailable));
        setMessages([]);
        setStage("revealed");
      });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "No hemos podido revelar tu carta.");
    } finally {
      setRevealing(false);
    }
  }

  async function sendQuestion() {
    const text = question.trim();
    if (!text || !draw || sending) return;
    try {
      setSending(true);
      setMessage("");
      await withToken(async (token) => {
        const res = await fetch("/api/cliente/oraculo", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "question", pregunta: text }),
        });
        const json = await res.json().catch(() => null);
        if (!json?.ok) throw new Error(json?.error || "No hemos podido enviar tu pregunta.");
        setMessages(Array.isArray(json.mensajes) ? json.mensajes : []);
        setQuestion("");
      });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "No hemos podido enviar tu pregunta.");
    } finally {
      setSending(false);
    }
  }

  const topicLabel = useMemo(() => TOPICS.find((item) => item.id === topic)?.label || "General", [topic]);
  const visibleCards = useMemo(() => Array.from({ length: Math.min(21, Math.max(12, deckSize)) }, (_, index) => index), [deckSize]);

  return (
    <ClienteLayout
      title="Oráculo"
      subtitle="Baraja, elige una carta y deja que el tarot te muestre un mensaje breve para hoy."
      summaryItems={[
        { label: "Tema activo", value: topicLabel, meta: draw ? `Carta: ${draw.cardName}` : "Elige tu enfoque antes de barajar" },
        { label: "Tu rango", value: String(client?.rango_actual || "Bronce"), meta: "Tu rango no altera el resultado de la carta" },
        { label: "Tirada", value: freeAvailable ? "GRATIS" : "Utilizada", meta: freeAvailable ? "Tu primera tirada corre por nuestra cuenta" : "Próximas tiradas: sistema de créditos pendiente" },
      ]}
    >
      <div className={styles.oracleShell}>
        {message ? <div className={styles.errorBox}>{message}</div> : null}

        <section className={`tc-card ${styles.topicPanel}`} style={{ display: "grid", gap: 14 }}>
          <div style={{ position: "relative", display: "grid", gap: 5 }}>
            <div className="tc-panel-title">Elige el enfoque de tu tirada</div>
            <div className="tc-panel-sub">La misma carta puede darte un matiz distinto según aquello que quieras observar hoy.</div>
          </div>
          <div className={styles.topicButtons}>
            {TOPICS.map((item) => {
              const Icon = item.icon;
              const active = item.id === topic;
              return (
                <button
                  key={item.id}
                  className={`${styles.topicButton} ${active ? styles.topicActive : ""}`}
                  onClick={() => setTopic(item.id)}
                  disabled={stage !== "intro" || Boolean(draw)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.oracleStage}>
          {loading ? <div className="tc-empty-state">Preparando el Oráculo…</div> : null}

          {!loading && stage === "intro" ? (
            <div className={styles.introContent}>
              <div className={styles.oracleSigil}><WandSparkles size={37} /></div>
              <div className={freeAvailable ? styles.freeBadge : styles.usedBadge}>
                {freeAvailable ? <Sparkles size={14} /> : <LockKeyhole size={14} />}
                {freeAvailable ? "Primera tirada GRATIS" : "Primera tirada ya utilizada"}
              </div>
              <h1 className={styles.heroTitle}>Tu tirada del día</h1>
              <div className={styles.heroCopy}>Baraja las cartas y deja que el oráculo te muestre el mensaje de hoy. La carta se decide en el servidor cuando eliges una posición.</div>
              <button className={styles.shuffleButton} onClick={shuffleCards}>
                <Shuffle size={18} /> Barajar cartas
              </button>
            </div>
          ) : null}

          {!loading && stage === "shuffling" ? (
            <div className={styles.introContent}>
              <div className={`${styles.shuffleDeck} ${styles.shuffling}`} aria-label="Barajando cartas">
                <div className={styles.shuffleCard} />
                <div className={styles.shuffleCard} />
                <div className={styles.shuffleCard} />
              </div>
              <div className={styles.selectionTitle}>Barajando tu energía…</div>
              <div className={styles.selectionCopy}>Respira un momento y piensa en tu pregunta.</div>
            </div>
          ) : null}

          {!loading && stage === "select" ? (
            <div className={styles.selectionStage}>
              <div className={styles.selectionHeader}>
                <div className={styles.freeBadge}><Sparkles size={14} /> Elige una carta</div>
                <div className={styles.selectionTitle}>¿Cuál te llama hoy?</div>
                <div className={styles.selectionCopy}>No hay una carta preseleccionada: el backend resuelve el resultado cuando eliges una posición.</div>
              </div>
              <div className={styles.cardRail}>
                {visibleCards.map((position) => (
                  <button
                    key={position}
                    className={styles.cardButton}
                    onClick={() => revealCard(position)}
                    disabled={revealing}
                    aria-label={`Elegir carta ${position + 1}`}
                  >
                    <span className={styles.cardBack} />
                  </button>
                ))}
              </div>
              {!canReveal ? (
                <div className={styles.lockMessage}>
                  <LockKeyhole size={14} style={{ verticalAlign: "middle", marginRight: 7 }} />
                  Tu primera tirada gratuita ya fue utilizada. Puedes barajar y explorar la experiencia, pero una nueva revelación quedará disponible cuando se configure el sistema real de créditos del Oráculo.
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && stage === "revealed" && draw ? (
            <div className={styles.revealGrid}>
              <div className={styles.revealedCardWrap}>
                <div className={styles.revealedCardGlow} />
                <div className={styles.revealedCard}>
                  {/* Rider-Waite-Smith, imágenes públicas servidas por Wikimedia Commons */}
                  <img src={draw.cardImage} alt={draw.cardName} loading="eager" referrerPolicy="no-referrer" />
                </div>
              </div>
              <div className={styles.readingPanel}>
                <div className={styles.readingEyebrow}><Sparkles size={13} /> Mensaje del día · {topicLabel}</div>
                <h2 className={styles.cardName}>{draw.cardName}</h2>
                <div className={styles.readingMessage}>{draw.message}</div>
                <div className={styles.insightGrid}>
                  <div className={styles.insightCard}>
                    <div className={styles.insightLabel}>Palabra clave</div>
                    <div className={styles.insightValue}>{draw.keyword}</div>
                  </div>
                  <div className={styles.insightCard}>
                    <div className={styles.insightLabel}>Consejo</div>
                    <div className={styles.insightValue}>{draw.advice}</div>
                  </div>
                </div>
                {!freeAvailable ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <div className={styles.usedBadge}><LockKeyhole size={13} /> Primera tirada gratuita consumida</div>
                    <button className="tc-btn" onClick={shuffleCards}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Shuffle size={15} /> Barajar otra vez</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        {draw ? (
          <section className={`tc-card ${styles.chatPanel}`}>
            <div style={{ display: "grid", gap: 5 }}>
              <div className="tc-panel-title">Pregunta al Oráculo</div>
              <div className="tc-panel-sub">Pregunta algo concreto. La respuesta utilizará tu carta y el tema de esta tirada como contexto.</div>
            </div>
            <div className={styles.chatContext}>
              <WandSparkles size={15} /> Contexto activo: <strong>{draw.cardName}</strong> · {topicLabel}
            </div>
            <div className={styles.chatScroll}>
              {messages.length === 0 ? <div className="tc-empty-state">Todavía no has hecho ninguna pregunta sobre esta carta.</div> : null}
              {messages.map((item) => (
                <div key={item.id} className={`${styles.bubble} ${item.role === "user" ? styles.bubbleUser : styles.bubbleOracle}`}>
                  {item.role === "assistant" ? <WandSparkles size={15} /> : null}
                  <div>{item.contenido}</div>
                </div>
              ))}
            </div>
            <div className={styles.compose}>
              <textarea
                className="tc-input tc-textarea"
                placeholder={`Ejemplo: ¿Qué debería observar ahora en ${topicLabel.toLowerCase()}?`}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={500}
              />
              <button className="tc-btn tc-btn-gold" disabled={sending || !question.trim()} onClick={sendQuestion}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <SendHorizontal size={16} /> {sending ? "Consultando…" : "Preguntar al Oráculo"}
                </span>
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </ClienteLayout>
  );
}
