"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import RunesComingSoon from "@/components/cliente/RunesComingSoon";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { CLIENT_RUNES_CHANGED } from "@/lib/client-runes-sync";
import styles from "@/components/cliente/RunesComingSoon.module.css";

type Auth = { userId: string; token: string };
type Rune = { title: string; benefit: string; updated_at: string };
type Snapshot = { owner: string; rune: Rune | null };

export default function ClientRunesPage() {
  const router = useRouter();
  const [auth, setAuth] = useState<Auth | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const sb = supabaseClienteBrowser();
    let active = true;
    let authChanged = false;
    const acceptSession = (session: { user: { id: string }; access_token: string } | null) => {
      if (!active) return;
      setAuth(previous => session
        ? previous?.userId === session.user.id && previous.token === session.access_token
          ? previous : { userId: session.user.id, token: session.access_token }
        : null);
      if (!session) {
        request.current?.abort();
        setSnapshot(null);
        router.replace("/cliente/login?next=runas");
      }
    };
    const { data: subscription } = sb.auth.onAuthStateChange((_event, session) => {
      authChanged = true;
      acceptSession(session);
    });
    void sb.auth.getSession().then(({ data }) => {
      if (!authChanged) acceptSession(data.session);
    }).catch(() => { if (!authChanged) acceptSession(null); });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [router]);

  const load = useCallback(async () => {
    if (!auth) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try {
      const response = await fetch("/api/cliente/runas", {
        headers: { Authorization: `Bearer ${auth.token}` }, cache: "no-store", signal: controller.signal,
      });
      if (response.status === 401) {
        setSnapshot(null);
        const refreshed = await supabaseClienteBrowser().auth.refreshSession();
        if (refreshed.error || !refreshed.data.session) router.replace("/cliente/login?next=runas");
        throw new Error("Estamos comprobando tu sesión. Pulsa Actualizar si no se recupera.");
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo consultar tu runa.");
      if (controller.signal.aborted) return;
      setSnapshot({ owner: auth.userId, rune: result.rune || null });
      setUpdated(new Date());
      setError("");
    } catch (cause) {
      if (request.current !== controller || controller.signal.aborted && !timedOut) return;
      setSnapshot(null);
      setError(timedOut ? "La consulta está tardando más de lo esperado. Vuelve a intentarlo."
        : cause instanceof Error ? cause.message : "No se pudo consultar tu runa.");
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }, [auth, router]);

  useEffect(() => {
    setSnapshot(null); setError(""); setUpdated(null);
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const onStorage = (event: StorageEvent) => { if (event.key === CLIENT_RUNES_CHANGED) refresh(); };
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener(CLIENT_RUNES_CHANGED, refresh);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      request.current?.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener(CLIENT_RUNES_CHANGED, refresh);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  if (!auth) return <p role="status" style={{ padding: "2rem", color: "#fff1d8" }}>Preparando tu espacio…</p>;
  const current = snapshot?.owner === auth.userId ? snapshot : null;

  return <ClienteLayout title="Runas" subtitle="Tu colección y las ventajas que tienes asignadas.">
    <div className={styles.refreshBar}>
      <span>{updated && current ? `Actualizado a las ${updated.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "Tu espacio personal"}</span>
      <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>
        <RefreshCw size={15} aria-hidden="true" />{loading ? "Actualizando…" : "Actualizar"}
      </button>
    </div>
    {error ? <div className={`${styles.statusPanel} ${styles.errorPanel}`} role="alert">
      <p>{error}</p>
      <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>Reintentar</button>
    </div> : !current ? <div className={styles.statusPanel} role="status">Consultando tu colección…</div>
      : <RunesComingSoon rune={current.rune} />}
  </ClienteLayout>;
}
