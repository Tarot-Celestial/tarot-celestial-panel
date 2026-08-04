"use client";

import { CheckCircle2, Mail, MessageCircle, Phone, RefreshCw, Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./MyClientPreferences.module.css";

type Preferences = {
  preferred_channel: "whatsapp" | "phone" | "email" | "sms";
  likes_follow_up: boolean;
  follow_up_frequency: "daily" | "every_2_days" | "weekly" | "every_15_days" | "monthly" | "purchase_only";
  preferred_time_slot: "morning" | "midday" | "afternoon" | "evening" | "any";
  preferred_days: string[];
  weekly_summary: boolean;
  updated_at?: string | null;
};

type Props = { clientId: string };

const DEFAULTS: Preferences = {
  preferred_channel: "whatsapp",
  likes_follow_up: true,
  follow_up_frequency: "weekly",
  preferred_time_slot: "any",
  preferred_days: [],
  weekly_summary: false,
};

const DAYS = [
  ["monday", "Lunes"],
  ["tuesday", "Martes"],
  ["wednesday", "Miércoles"],
  ["thursday", "Jueves"],
  ["friday", "Viernes"],
  ["saturday", "Sábado"],
  ["sunday", "Domingo"],
] as const;

async function accessToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || null;
}

export default function MyClientPreferences({ clientId }: Props) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPreferences = useRef(preferences);
  const mounted = useRef(true);

  useEffect(() => {
    latestPreferences.current = preferences;
  }, [preferences]);

  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("No se pudo validar la sesión.");
      const response = await fetch(`/api/central/my-clients/preferences?client_id=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudieron cargar las preferencias.");
      if (!mounted.current) return;
      setPreferences({ ...DEFAULTS, ...(payload.preferences || {}), preferred_days: payload.preferences?.preferred_days || [] });
      setDirty(false);
    } catch (loadError: any) {
      if (mounted.current) setError(loadError?.message || "No se pudieron cargar las preferencias.");
    } finally {
      if (showLoader && mounted.current) setLoading(false);
    }
  }, [clientId]);

  const save = useCallback(async (options?: { sync?: boolean; silent?: boolean }) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaving(true);
    setError("");
    if (!options?.silent) setMessage("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("No se pudo validar la sesión.");
      const response = await fetch(`/api/central/my-clients/preferences?client_id=${encodeURIComponent(clientId)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(latestPreferences.current),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudieron guardar las preferencias.");
      if (!mounted.current) return;
      setPreferences({ ...DEFAULTS, ...(payload.preferences || {}), preferred_days: payload.preferences?.preferred_days || [] });
      setDirty(false);
      if (options?.sync) {
        await load(false);
        if (mounted.current) setMessage("Preferencias sincronizadas correctamente.");
      }
    } catch (saveError: any) {
      if (mounted.current) setError(saveError?.message || "No se pudieron guardar las preferencias.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [clientId, load]);

  const update = useCallback(<K extends keyof Preferences,>(key: K, value: Preferences[K]) => {
    setPreferences((current) => {
      const next = { ...current, [key]: value };
      latestPreferences.current = next;
      return next;
    });
    setDirty(true);
    setMessage("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save({ silent: true }), 550);
  }, [save]);

  useEffect(() => {
    mounted.current = true;
    void load(true);
    return () => {
      mounted.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [load]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`client-communication-preferences-${clientId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "crm_client_communication_preferences",
        filter: `client_id=eq.${clientId}`,
      }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void load(false), 180);
      })
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [clientId, load]);

  const disabled = !preferences.likes_follow_up;
  const channelIcon = useMemo(() => ({
    whatsapp: <MessageCircle size={17} />,
    phone: <Phone size={17} />,
    email: <Mail size={17} />,
    sms: <Smartphone size={17} />,
  })[preferences.preferred_channel], [preferences.preferred_channel]);

  const toggleDay = (day: string) => {
    const selected = preferences.preferred_days.includes(day);
    update("preferred_days", selected
      ? preferences.preferred_days.filter((value) => value !== day)
      : [...preferences.preferred_days, day]);
  };

  if (loading) return <section className={styles.stateCard}>Cargando preferencias de comunicación…</section>;

  return (
    <section className={styles.preferencesRoot} aria-labelledby="communication-preferences-title">
      <article className={styles.card}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>PREFERENCIAS DEL CLIENTE</span>
            <h2 id="communication-preferences-title">Preferencias de comunicación</h2>
            <p>Configura cómo y cuándo prefiere recibir contacto y seguimiento.</p>
          </div>
          <button type="button" className={styles.syncButton} disabled={saving} onClick={() => void save({ sync: true })}>
            <RefreshCw size={17} className={saving ? styles.spinning : ""} />
            {saving ? "Sincronizando…" : "Sincronizar"}
          </button>
        </header>

        {(message || error) && (
          <div className={error ? styles.errorMessage : styles.successMessage} role="status" aria-live="polite">
            {!error && <CheckCircle2 size={17} />}
            {error || message}
          </div>
        )}

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Canal preferido</span>
            <div className={styles.selectWrap}>{channelIcon}
              <select value={preferences.preferred_channel} onChange={(event) => update("preferred_channel", event.target.value as Preferences["preferred_channel"])}>
                <option value="whatsapp">WhatsApp</option>
                <option value="phone">Teléfono</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </div>
          </label>

          <div className={styles.switchField}>
            <div><strong>¿Le gusta recibir seguimiento?</strong><small>Activa la planificación periódica de contactos.</small></div>
            <label className={styles.switch}>
              <input type="checkbox" checked={preferences.likes_follow_up} onChange={(event) => update("likes_follow_up", event.target.checked)} />
              <span aria-hidden="true" />
            </label>
          </div>

          <label className={`${styles.field} ${disabled ? styles.disabled : ""}`}>
            <span>Frecuencia de seguimiento</span>
            <select disabled={disabled} value={preferences.follow_up_frequency} onChange={(event) => update("follow_up_frequency", event.target.value as Preferences["follow_up_frequency"])}>
              <option value="daily">Diario</option>
              <option value="every_2_days">Cada 2 días</option>
              <option value="weekly">Semanal</option>
              <option value="every_15_days">Cada 15 días</option>
              <option value="monthly">Mensual</option>
              <option value="purchase_only">Solo cuando compre</option>
            </select>
          </label>

          <label className={`${styles.field} ${disabled ? styles.disabled : ""}`}>
            <span>Horario preferido</span>
            <select disabled={disabled} value={preferences.preferred_time_slot} onChange={(event) => update("preferred_time_slot", event.target.value as Preferences["preferred_time_slot"])}>
              <option value="morning">Mañanas (08:00–12:00)</option>
              <option value="midday">Mediodía (12:00–16:00)</option>
              <option value="afternoon">Tardes (16:00–20:00)</option>
              <option value="evening">Noches (20:00–22:00)</option>
              <option value="any">Indiferente</option>
            </select>
          </label>

          <fieldset className={`${styles.daysField} ${disabled ? styles.disabled : ""}`} disabled={disabled}>
            <legend>Días preferidos</legend>
            <div className={styles.daysGrid}>
              {DAYS.map(([value, label]) => {
                const selected = preferences.preferred_days.includes(value);
                return <button key={value} type="button" className={selected ? styles.daySelected : ""} onClick={() => toggleDay(value)}>{label}</button>;
              })}
            </div>
          </fieldset>

          <div className={`${styles.switchField} ${styles.fullWidth} ${disabled ? styles.disabled : ""}`}>
            <div><strong>Enviar resumen semanal</strong><small>Preparado para futuros resúmenes de seguimiento y actividad.</small></div>
            <label className={styles.switch}>
              <input disabled={disabled} type="checkbox" checked={preferences.weekly_summary} onChange={(event) => update("weekly_summary", event.target.checked)} />
              <span aria-hidden="true" />
            </label>
          </div>
        </div>

        <footer className={styles.footer}>
          <span>{dirty ? "Cambios pendientes de sincronización…" : saving ? "Guardando cambios…" : "Preferencias sincronizadas con Supabase."}</span>
          {preferences.updated_at && <time dateTime={preferences.updated_at}>Última actualización: {new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(preferences.updated_at))}</time>}
        </footer>
      </article>
    </section>
  );
}
