"use client";

import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Gift,
  Mail,
  Megaphone,
  MessageCircle,
  Newspaper,
  Palette,
  Phone,
  Plus,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./MyClientPreferences.module.css";

type CommunicationPreferences = {
  preferred_channel: "whatsapp" | "phone" | "email" | "sms";
  likes_follow_up: boolean;
  follow_up_frequency: "daily" | "every_2_days" | "weekly" | "every_15_days" | "monthly" | "purchase_only";
  preferred_time_slot: "morning" | "midday" | "afternoon" | "evening" | "any";
  preferred_days: string[];
  weekly_summary: boolean;
  updated_at?: string | null;
};

type NotificationTiming =
  | "immediate"
  | "30_minutes_before"
  | "1_hour_before"
  | "24_hours_before"
  | "same_day"
  | "day_before"
  | "according_to_preferences"
  | "morning_0900"
  | "afternoon_1700"
  | "custom";

type NotificationKey =
  | "promotions"
  | "appointment_reminders"
  | "personalized_followups"
  | "new_content"
  | "birthday_offer"
  | "important_updates";

type NotificationSettings = Record<NotificationKey, { enabled: boolean; timing: NotificationTiming }>;

type CustomSchedule = {
  id?: string | null;
  name: string;
  time: string;
  days: string[];
  enabled: boolean;
  color: string;
  updated_at?: string | null;
};

type Props = { clientId: string };

const COMMUNICATION_DEFAULTS: CommunicationPreferences = {
  preferred_channel: "whatsapp",
  likes_follow_up: true,
  follow_up_frequency: "weekly",
  preferred_time_slot: "any",
  preferred_days: [],
  weekly_summary: false,
};

const NOTIFICATION_DEFAULTS: NotificationSettings = {
  promotions: { enabled: false, timing: "according_to_preferences" },
  appointment_reminders: { enabled: true, timing: "24_hours_before" },
  personalized_followups: { enabled: true, timing: "according_to_preferences" },
  new_content: { enabled: false, timing: "according_to_preferences" },
  birthday_offer: { enabled: true, timing: "same_day" },
  important_updates: { enabled: true, timing: "immediate" },
};

const DAYS = [
  ["monday", "Lunes", "L"],
  ["tuesday", "Martes", "M"],
  ["wednesday", "Miércoles", "X"],
  ["thursday", "Jueves", "J"],
  ["friday", "Viernes", "V"],
  ["saturday", "Sábado", "S"],
  ["sunday", "Domingo", "D"],
] as const;

const TIMINGS: Array<[NotificationTiming, string]> = [
  ["immediate", "Inmediato"],
  ["30_minutes_before", "30 minutos antes"],
  ["1_hour_before", "1 hora antes"],
  ["24_hours_before", "24 horas antes"],
  ["same_day", "El mismo día"],
  ["day_before", "El día anterior"],
  ["according_to_preferences", "Según preferencias"],
  ["morning_0900", "Por la mañana (09:00)"],
  ["afternoon_1700", "Por la tarde (17:00)"],
  ["custom", "Personalizado"],
];

const NOTIFICATION_ITEMS: Array<{
  key: NotificationKey;
  title: string;
  description: string;
  icon: typeof Bell;
}> = [
  { key: "promotions", title: "Nuevas promociones", description: "Permite recibir promociones especiales.", icon: Megaphone },
  { key: "appointment_reminders", title: "Recordatorios de cita", description: "Avisos antes de una cita o seguimiento.", icon: CalendarClock },
  { key: "personalized_followups", title: "Seguimientos personalizados", description: "Avisos creados desde la pestaña Seguimientos.", icon: MessageCircle },
  { key: "new_content", title: "Nuevas tiradas o contenidos", description: "Novedades y contenidos de Tarot Celestial.", icon: Newspaper },
  { key: "birthday_offer", title: "Oferta especial de cumpleaños", description: "Preparado para futuras campañas automáticas.", icon: Gift },
  { key: "important_updates", title: "Actualizaciones importantes", description: "Información importante relacionada con el servicio.", icon: Bell },
];

async function accessToken() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || null;
}

function mergeNotifications(payload: any): NotificationSettings {
  const source = payload && typeof payload === "object" ? payload : {};
  return Object.fromEntries(Object.keys(NOTIFICATION_DEFAULTS).map((key) => {
    const notificationKey = key as NotificationKey;
    return [notificationKey, {
      enabled: Boolean(source[notificationKey]?.enabled ?? NOTIFICATION_DEFAULTS[notificationKey].enabled),
      timing: (source[notificationKey]?.timing || NOTIFICATION_DEFAULTS[notificationKey].timing) as NotificationTiming,
    }];
  })) as NotificationSettings;
}

export default function MyClientPreferences({ clientId }: Props) {
  const [preferences, setPreferences] = useState<CommunicationPreferences>(COMMUNICATION_DEFAULTS);
  const [notifications, setNotifications] = useState<NotificationSettings>(NOTIFICATION_DEFAULTS);
  const [customSchedules, setCustomSchedules] = useState<CustomSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingScheduleIndex, setEditingScheduleIndex] = useState<number | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<CustomSchedule>({
    name: "",
    time: "18:30",
    days: ["monday"],
    enabled: true,
    color: "#9b6cff",
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestState = useRef({ preferences, notifications, customSchedules });
  const mounted = useRef(true);

  useEffect(() => {
    latestState.current = { preferences, notifications, customSchedules };
  }, [preferences, notifications, customSchedules]);

  const applyPayload = useCallback((payload: any) => {
    setPreferences({
      ...COMMUNICATION_DEFAULTS,
      ...(payload?.preferences || {}),
      preferred_days: payload?.preferences?.preferred_days || [],
    });
    setNotifications(mergeNotifications(payload?.notifications));
    setCustomSchedules(Array.isArray(payload?.custom_schedules) ? payload.custom_schedules : []);
    setDirty(false);
  }, []);

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
      applyPayload(payload);
    } catch (loadError: any) {
      if (mounted.current) setError(loadError?.message || "No se pudieron cargar las preferencias.");
    } finally {
      if (showLoader && mounted.current) setLoading(false);
    }
  }, [applyPayload, clientId]);

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
      const current = latestState.current;
      const response = await fetch(`/api/central/my-clients/preferences?client_id=${encodeURIComponent(clientId)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...current.preferences,
          notifications: current.notifications,
          custom_schedules: current.customSchedules,
        }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudieron guardar las preferencias.");
      if (!mounted.current) return;
      applyPayload(payload);
      if (options?.sync) {
        await load(false);
        if (mounted.current) setMessage("Preferencias sincronizadas correctamente.");
      }
    } catch (saveError: any) {
      if (mounted.current) setError(saveError?.message || "No se pudieron guardar las preferencias.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [applyPayload, clientId, load]);

  const scheduleSave = useCallback(() => {
    setDirty(true);
    setMessage("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save({ silent: true }), 650);
  }, [save]);

  const updatePreference = useCallback(<K extends keyof CommunicationPreferences,>(key: K, value: CommunicationPreferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    scheduleSave();
  }, [scheduleSave]);

  const updateNotification = useCallback((key: NotificationKey, patch: Partial<NotificationSettings[NotificationKey]>) => {
    setNotifications((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    scheduleSave();
  }, [scheduleSave]);

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
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(false), 180);
    };
    const channel = supabase
      .channel(`client-all-preferences-${clientId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "crm_client_communication_preferences",
        filter: `client_id=eq.${clientId}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "crm_client_notification_preferences",
        filter: `client_id=eq.${clientId}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "crm_client_notification_schedules",
        filter: `client_id=eq.${clientId}`,
      }, refresh)
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

  const togglePreferredDay = (day: string) => {
    const selected = preferences.preferred_days.includes(day);
    updatePreference("preferred_days", selected
      ? preferences.preferred_days.filter((value) => value !== day)
      : [...preferences.preferred_days, day]);
  };

  const openNewSchedule = () => {
    setEditingScheduleIndex(null);
    setScheduleDraft({ name: "", time: "18:30", days: ["monday"], enabled: true, color: "#9b6cff" });
    setScheduleModalOpen(true);
  };

  const openEditSchedule = (index: number) => {
    setEditingScheduleIndex(index);
    setScheduleDraft({ ...customSchedules[index], days: [...customSchedules[index].days] });
    setScheduleModalOpen(true);
  };

  const toggleDraftDay = (day: string) => {
    setScheduleDraft((current) => ({
      ...current,
      days: current.days.includes(day) ? current.days.filter((value) => value !== day) : [...current.days, day],
    }));
  };

  const commitSchedule = () => {
    if (!scheduleDraft.name.trim() || !scheduleDraft.time || scheduleDraft.days.length === 0) {
      setError("El horario necesita nombre, hora y al menos un día.");
      return;
    }
    setCustomSchedules((current) => {
      if (editingScheduleIndex === null) return [...current, { ...scheduleDraft, name: scheduleDraft.name.trim() }];
      return current.map((schedule, index) => index === editingScheduleIndex
        ? { ...schedule, ...scheduleDraft, name: scheduleDraft.name.trim() }
        : schedule);
    });
    setScheduleModalOpen(false);
    scheduleSave();
  };

  const removeSchedule = (index: number) => {
    setCustomSchedules((current) => current.filter((_, currentIndex) => currentIndex !== index));
    scheduleSave();
  };

  const toggleSchedule = (index: number) => {
    setCustomSchedules((current) => current.map((schedule, currentIndex) => currentIndex === index
      ? { ...schedule, enabled: !schedule.enabled }
      : schedule));
    scheduleSave();
  };

  if (loading) return <section className={styles.stateCard}>Cargando preferencias…</section>;

  return (
    <section className={styles.preferencesRoot} aria-label="Preferencias del cliente">
      <div className={styles.pageToolbar}>
        <div>
          <span className={styles.eyebrow}>PREFERENCIAS DEL CLIENTE</span>
          <p>Configuración sincronizada para comunicación y notificaciones.</p>
        </div>
        <button type="button" className={styles.syncButton} disabled={saving} onClick={() => void save({ sync: true })}>
          <RefreshCw size={17} className={saving ? styles.spinning : ""} />
          {saving ? "Sincronizando…" : "Sincronizar"}
        </button>
      </div>

      {(message || error) && (
        <div className={error ? styles.errorMessage : styles.successMessage} role="status" aria-live="polite">
          {!error && <CheckCircle2 size={17} />}
          {error || message}
        </div>
      )}

      <article className={styles.card}>
        <header className={styles.header}>
          <div>
            <h2 id="communication-preferences-title">Preferencias de comunicación</h2>
            <p>Configura cómo y cuándo prefiere recibir contacto y seguimiento.</p>
          </div>
        </header>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Canal preferido</span>
            <div className={styles.selectWrap}>{channelIcon}
              <select value={preferences.preferred_channel} onChange={(event) => updatePreference("preferred_channel", event.target.value as CommunicationPreferences["preferred_channel"])}>
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
              <input type="checkbox" checked={preferences.likes_follow_up} onChange={(event) => updatePreference("likes_follow_up", event.target.checked)} />
              <span aria-hidden="true" />
            </label>
          </div>

          <label className={`${styles.field} ${disabled ? styles.disabled : ""}`}>
            <span>Frecuencia de seguimiento</span>
            <select disabled={disabled} value={preferences.follow_up_frequency} onChange={(event) => updatePreference("follow_up_frequency", event.target.value as CommunicationPreferences["follow_up_frequency"])}>
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
            <select disabled={disabled} value={preferences.preferred_time_slot} onChange={(event) => updatePreference("preferred_time_slot", event.target.value as CommunicationPreferences["preferred_time_slot"])}>
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
                return <button key={value} type="button" className={selected ? styles.daySelected : ""} onClick={() => togglePreferredDay(value)}>{label}</button>;
              })}
            </div>
          </fieldset>

          <div className={`${styles.switchField} ${styles.fullWidth} ${disabled ? styles.disabled : ""}`}>
            <div><strong>Enviar resumen semanal</strong><small>Permite preparar un resumen periódico de actividad y seguimiento.</small></div>
            <label className={styles.switch}>
              <input disabled={disabled} type="checkbox" checked={preferences.weekly_summary} onChange={(event) => updatePreference("weekly_summary", event.target.checked)} />
              <span aria-hidden="true" />
            </label>
          </div>
        </div>
      </article>

      <article className={`${styles.card} ${styles.notificationsCard}`}>
        <header className={styles.header}>
          <div>
            <span className={styles.sectionIcon}><Bell size={18} /></span>
            <h2>Notificaciones</h2>
            <p>Define qué avisos puede recibir la clienta y cuándo deben programarse.</p>
          </div>
          <span className={styles.liveBadge}><Sparkles size={13} /> Tiempo real</span>
        </header>

        <div className={styles.notificationList}>
          {NOTIFICATION_ITEMS.map((item) => {
            const Icon = item.icon;
            const config = notifications[item.key];
            return (
              <section key={item.key} className={`${styles.notificationRow} ${config.enabled ? styles.notificationEnabled : ""}`}>
                <div className={styles.notificationIdentity}>
                  <span className={styles.notificationIcon}><Icon size={18} /></span>
                  <div><strong>{item.title}</strong><small>{item.description}</small></div>
                </div>
                <label className={styles.timingField}>
                  <span>Programación</span>
                  <select disabled={!config.enabled} value={config.timing} onChange={(event) => updateNotification(item.key, { timing: event.target.value as NotificationTiming })}>
                    {TIMINGS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className={styles.switch}>
                  <input type="checkbox" checked={config.enabled} onChange={(event) => updateNotification(item.key, { enabled: event.target.checked })} />
                  <span aria-hidden="true" />
                </label>
              </section>
            );
          })}
        </div>

        <div className={styles.customSchedulesHeader}>
          <div>
            <h3>Horarios personalizados</h3>
            <p>Crea ventanas reutilizables para campañas, seguimientos y eventos futuros.</p>
          </div>
          <button type="button" className={styles.addScheduleButton} onClick={openNewSchedule}><Plus size={16} /> Añadir horario personalizado</button>
        </div>

        {customSchedules.length === 0 ? (
          <div className={styles.emptySchedules}><Clock3 size={22} /><span>No hay horarios personalizados.</span></div>
        ) : (
          <div className={styles.scheduleGrid}>
            {customSchedules.map((schedule, index) => (
              <article key={schedule.id || `${schedule.name}-${index}`} className={styles.scheduleCard} style={{ "--schedule-color": schedule.color } as CSSProperties}>
                <button type="button" className={styles.scheduleMain} onClick={() => openEditSchedule(index)}>
                  <span className={styles.scheduleColor} />
                  <div>
                    <strong>{schedule.name}</strong>
                    <small>{DAYS.filter(([value]) => schedule.days.includes(value)).map(([, label]) => label).join(" · ")}</small>
                  </div>
                  <time>{schedule.time}</time>
                </button>
                <div className={styles.scheduleActions}>
                  <label className={styles.switch}>
                    <input type="checkbox" checked={schedule.enabled} onChange={() => toggleSchedule(index)} />
                    <span aria-hidden="true" />
                  </label>
                  <button type="button" className={styles.deleteScheduleButton} aria-label={`Eliminar ${schedule.name}`} onClick={() => removeSchedule(index)}><Trash2 size={15} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>

      <footer className={styles.footer}>
        <span>{saving ? "Guardando cambios…" : dirty ? "Cambios pendientes de sincronización" : "Datos sincronizados con Supabase"}</span>
        {preferences.updated_at && <time dateTime={preferences.updated_at}>Última actualización: {new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(preferences.updated_at))}</time>}
      </footer>

      {scheduleModalOpen && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setScheduleModalOpen(false); }}>
          <section className={styles.scheduleModal} role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
            <header>
              <div><span className={styles.sectionIcon}><Clock3 size={18} /></span><h2 id="schedule-modal-title">{editingScheduleIndex === null ? "Nuevo horario personalizado" : "Editar horario personalizado"}</h2></div>
              <button type="button" aria-label="Cerrar" onClick={() => setScheduleModalOpen(false)}><X size={19} /></button>
            </header>

            <div className={styles.modalGrid}>
              <label className={`${styles.field} ${styles.fullWidth}`}><span>Nombre del horario</span><input value={scheduleDraft.name} maxLength={80} placeholder="Seguimiento VIP" onChange={(event) => setScheduleDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className={styles.field}><span>Hora</span><div className={styles.nativeTimeWrap}><input type="time" value={scheduleDraft.time} onChange={(event) => setScheduleDraft((current) => ({ ...current, time: event.target.value }))} /></div></label>
              <label className={styles.field}><span>Color identificativo</span><div className={styles.colorInput}><Palette size={16} /><input type="color" value={scheduleDraft.color} onChange={(event) => setScheduleDraft((current) => ({ ...current, color: event.target.value }))} /><code>{scheduleDraft.color.toUpperCase()}</code></div></label>
              <fieldset className={styles.daysField}>
                <legend>Días de la semana</legend>
                <div className={styles.compactDaysGrid}>{DAYS.map(([value, label, short]) => <button key={value} type="button" title={label} className={scheduleDraft.days.includes(value) ? styles.daySelected : ""} onClick={() => toggleDraftDay(value)}>{short}</button>)}</div>
              </fieldset>
              <div className={`${styles.switchField} ${styles.fullWidth}`}><div><strong>Horario activo</strong><small>Podrá utilizarse por futuros motores de avisos y campañas.</small></div><label className={styles.switch}><input type="checkbox" checked={scheduleDraft.enabled} onChange={(event) => setScheduleDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span aria-hidden="true" /></label></div>
            </div>

            <footer><button type="button" className={styles.cancelButton} onClick={() => setScheduleModalOpen(false)}>Cancelar</button><button type="button" className={styles.saveScheduleButton} onClick={commitSchedule}><CheckCircle2 size={16} /> Guardar horario</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}
