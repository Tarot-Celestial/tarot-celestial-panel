"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, KeyRound, LoaderCircle, RefreshCw, Sparkles, TicketCheck } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./sorteo.module.css";

const sb = supabaseClienteBrowser();

type NumberEntry = { id: string; number: number; assigned_at: string };

export default function ClienteSorteoPage() {
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [raffleTitle, setRaffleTitle] = useState("Sorteo actual");
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setMessage("");
    try {
      const session = await sb.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        window.location.href = "/cliente/login";
        return;
      }
      const response = await fetch("/api/cliente/raffle", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (response.status === 401 || json?.error === "SESSION_EXPIRED") {
        window.location.href = "/cliente/login";
        return;
      }
      if (!response.ok || !json?.ok) {
        const errorMessage = json?.error === "CLIENT_NOT_LINKED"
          ? "Tu acceso existe, pero no está vinculado a una ficha de cliente."
          : json?.error || "No se pudo cargar tu sorteo.";
        throw new Error(errorMessage);
      }
      setClientId(String(json.client_id || ""));
      setRaffleTitle(String(json.raffle?.title || "Sorteo actual"));
      setNumbers(Array.isArray(json.numbers) ? json.numbers : []);
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar tu sorteo.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!clientId) return;
    const channel = sb
      .channel(`cliente:${clientId}:sorteo`)
      .on("postgres_changes", { event: "*", schema: "public", table: "raffle_entries", filter: `client_id=eq.${clientId}` }, () => {
        void load(true);
      })
      .subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [clientId, load]);

  return (
    <ClienteLayout
      title="Sorteo"
      subtitle="Consulta aquí el número que te ha asignado tu central."
      summaryItems={[{ label: "Números asignados", value: String(numbers.length), meta: raffleTitle, tone: "points" }]}
    >
      <section className={styles.root}>
        <header className={styles.header}>
          <div className={styles.icon}><Gift /></div>
          <div><span>NOVEDAD CELESTIAL</span><h2>{raffleTitle}</h2><p>Tu participación se sincroniza automáticamente cuando la central te asigna un número.</p></div>
          <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? styles.spin : undefined} /> Actualizar</button>
        </header>

        <article className={styles.secret}>
          <div className={styles.secretIcon}><Sparkles /></div>
          <div className={styles.secretContent}>
            <span className={styles.secretEyebrow}>SECRETO CELESTIAL</span>
            <h3>EL SECRETO CELESTIAL HA DESPERTADO</h3>
            <p className={styles.secretLead}>Tu premio está escondido en algún lugar de tu panel... 👀</p>
            <div className={styles.clue}>
              <strong>PISTA:</strong>
              <span>“No necesitas gastar para encontrarme. Pregunta al destino, donde una respuesta puede llegar sin pagar.” 🔮</span>
            </div>
            <p className={styles.secretFind}>Encuentra el símbolo celestial <span className={styles.secretKey} aria-label="llave dorada"><KeyRound /></span> y tócalo.</p>
            <p className={styles.secretPrize}>Tu premio sigue siendo un secreto... 🎁</p>
          </div>
        </article>

        {message ? <div className={styles.message} role="alert">{message}</div> : null}
        {loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} /> Consultando tu número…</div> : numbers.length ? (
          <div className={styles.ticketGrid}>
            {numbers.map((entry) => (
              <article key={entry.id} className={styles.ticket}>
                <div className={styles.ticketTop}><TicketCheck /><span>TU NÚMERO DE SORTEO</span></div>
                <strong>{entry.number}</strong>
                <p>Asignado el {new Date(entry.assigned_at).toLocaleString("es-ES")}</p>
                <div><Sparkles /> Participación confirmada</div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <Gift />
            <h3>Aún no tienes un número asignado</h3>
            <p>Cuando tu central te añada al sorteo, tu número aparecerá aquí automáticamente.</p>
          </div>
        )}
      </section>
    </ClienteLayout>
  );
}
