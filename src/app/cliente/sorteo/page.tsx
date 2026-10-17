"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import ClientRaffleView from "@/components/cliente/ClientRaffleView";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import RaffleWinners from "@/components/cliente/RaffleWinners";

const sb = supabaseClienteBrowser();

type NumberEntry = { id: string; number: number; assigned_at: string };

export default function ClienteSorteoPage() {
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [raffleTitle, setRaffleTitle] = useState("Sorteo actual");
  const [raffleId, setRaffleId] = useState("");
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const loadSequence = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async (quiet = false) => {
    const sequence = ++loadSequence.current;
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
      if (!mounted.current || sequence !== loadSequence.current) return;
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
      setRaffleId(String(json.raffle?.id || ""));
      setRaffleTitle(String(json.raffle?.title || "Sorteo actual"));
      setNumbers(Array.isArray(json.numbers) ? json.numbers : []);
    } catch (error: any) {
      if (mounted.current && sequence === loadSequence.current) setMessage(error?.message || "No se pudo cargar tu sorteo.");
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void load(true); }, 250);
    };
    void load();
    // Clients cannot subscribe to the staff-only raffles table. Recheck only while visible.
    const activeRaffleCheck = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      loadSequence.current++;
      clearInterval(activeRaffleCheck);
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

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
      eyebrow="Tarot Celestial · Halloween"
      subtitle="Consulta aquí los números que te ha asignado tu central."
    >
      <ClientRaffleView numbers={numbers} title={raffleTitle} loading={loading} message={message} onRefresh={() => void load()}>
        <RaffleWinners key={raffleId} />
      </ClientRaffleView>
    </ClienteLayout>
  );
}
